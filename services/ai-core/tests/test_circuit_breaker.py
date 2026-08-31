"""S2-A-02 — Circuit breaker automático del Gemini adapter.

Política:
  - Sliding window de 5 min: si >3 fallos consecutivos → `degraded`.
  - En `degraded`, todas las calls levantan AIProviderError sin tocar la API
    durante 2 min.
  - Tras 2 min, transicionamos a `half_open`: la próxima call llega al API.
    Si OK → `healthy`. Si falla → vuelve a `degraded` con reloj reiniciado.

Estos tests NO levantan la API real — mockean el cliente SDK Vertex
(`genai_client.aio.models.generate_content`) para inducir fallos y verifican
que el adapter respete el estado del breaker.
"""
from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from src.budget.domain.exceptions import AIProviderError
from src.budget.infrastructure.adapters.ai.gemini_adapter import (
    CIRCUIT_DEGRADED,
    CIRCUIT_HALF_OPEN,
    CIRCUIT_HEALTHY,
    GoogleGenerativeAIAdapter,
    _CircuitBreaker,
    _reset_circuit_for_tests,
    get_circuit_breaker,
)


class _MiniSchema(BaseModel):
    value: int


class _FakeAPIError(genai_errors.APIError):
    """APIError mínima con un `.code` controlable (evita el constructor real)."""

    def __init__(self, code: int):
        self.code = code
        self.message = f"fake {code}"
        self.status = "ERROR"
        self.details = None

    def __str__(self) -> str:
        return self.message


def _ok_response(value: int):
    """Respuesta con la forma del SDK google-genai (Vertex)."""
    return SimpleNamespace(
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(parts=[SimpleNamespace(text=f'{{"value": {value}}}')]),
                finish_reason=SimpleNamespace(name="STOP"),
            )
        ],
        usage_metadata=SimpleNamespace(
            prompt_token_count=1, candidates_token_count=1, total_token_count=2
        ),
    )


def _install(adapter: GoogleGenerativeAIAdapter, side_effect):
    """Reemplaza `adapter.genai_client` por un fake y cuenta invocaciones.

    `side_effect(**kwargs)` devuelve una respuesta o lanza.
    """
    calls: list[int] = []

    async def _gen(**kwargs):
        calls.append(1)
        return side_effect(**kwargs)

    adapter.genai_client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=_gen))
    )
    return calls


@pytest.fixture(autouse=True)
def reset_breaker_and_env(monkeypatch):
    """Cada test arranca con breaker fresco y project dummy (Vertex)."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    _reset_circuit_for_tests()
    yield
    _reset_circuit_for_tests()


# ---- Pure breaker unit tests ----------------------------------------------


def test_breaker_initial_state_is_healthy():
    cb = _CircuitBreaker()
    assert cb.state == CIRCUIT_HEALTHY
    assert cb.should_allow_call() is True


def test_breaker_opens_after_3_failures():
    """Tres fallos consecutivos abren el circuit."""
    cb = _CircuitBreaker()
    cb.record_failure()
    assert cb.state == CIRCUIT_HEALTHY
    cb.record_failure()
    assert cb.state == CIRCUIT_HEALTHY
    cb.record_failure()
    # 3º fallo → degraded.
    assert cb.state == CIRCUIT_DEGRADED
    assert cb.should_allow_call() is False


def test_breaker_success_resets_counter():
    """Un éxito reinicia el contador en healthy."""
    cb = _CircuitBreaker()
    cb.record_failure()
    cb.record_failure()
    cb.record_success()
    # Tras success, otro fallo NO debe abrir el circuit aún.
    cb.record_failure()
    cb.record_failure()
    assert cb.state == CIRCUIT_HEALTHY


def test_breaker_transitions_to_half_open_after_open_duration(monkeypatch):
    """Tras 2 min en degraded, la próxima call activa half_open."""
    cb = _CircuitBreaker()
    cb.record_failure()
    cb.record_failure()
    cb.record_failure()
    assert cb.state == CIRCUIT_DEGRADED

    # Simulamos paso de 121 segundos.
    cb.opened_at = time.monotonic() - 121.0
    # Próxima llamada permite el call (half-open).
    assert cb.should_allow_call() is True
    assert cb.state == CIRCUIT_HALF_OPEN


def test_breaker_half_open_success_returns_to_healthy():
    """Si la call de prueba en half_open funciona, volvemos a healthy."""
    cb = _CircuitBreaker()
    cb.state = CIRCUIT_HALF_OPEN
    cb.record_success()
    assert cb.state == CIRCUIT_HEALTHY
    assert cb.should_allow_call() is True


def test_breaker_half_open_failure_returns_to_degraded():
    """Si la call de prueba en half_open falla, volvemos a degraded."""
    cb = _CircuitBreaker()
    cb.state = CIRCUIT_HALF_OPEN
    # Pre-cargamos failures pasados (dentro de la ventana).
    cb.failure_timestamps.extend([time.monotonic() - 1.0] * 2)
    cb.record_failure()
    # 3 failures totales en ventana → abre.
    assert cb.state == CIRCUIT_DEGRADED


def test_breaker_failures_outside_window_dont_count():
    """Fallos antiguos (>5 min) NO cuentan para abrir el circuit."""
    cb = _CircuitBreaker()
    # Empujamos 2 fallos "antiguos" (en el ts pero >5 min atrás).
    old = time.monotonic() - 600.0  # 10 min atrás
    cb.failure_timestamps.extend([old, old])
    # Añadimos UN fallo nuevo. Debe limpiar los antiguos antes de añadir y
    # NO abrir el circuit (sólo 1 fallo en la ventana).
    cb.record_failure()
    assert cb.state == CIRCUIT_HEALTHY
    assert len(cb.failure_timestamps) == 1  # solo el nuevo


# ---- Integration: adapter respects the breaker (SDK Vertex) ----------------


@pytest.mark.asyncio
async def test_adapter_record_success_on_ok(monkeypatch):
    """Una respuesta OK al adapter llama a `record_success`."""
    adapter = GoogleGenerativeAIAdapter(model_name="gemini-2.5-flash")
    _install(adapter, lambda **kw: _ok_response(42))

    result, _ = await adapter.generate_structured(
        system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
    )
    assert result.value == 42
    assert get_circuit_breaker().state == CIRCUIT_HEALTHY


@pytest.mark.asyncio
async def test_adapter_record_failure_after_retries_exhausted(monkeypatch):
    """Tras agotar retries con fallos, el breaker registra un failure."""
    monkeypatch.setenv("LLM_CALL_MAX_RETRIES", "2")
    adapter = GoogleGenerativeAIAdapter(
        model_name="gemini-2.5-flash", max_retries=2, base_delay=0.0,
    )

    def _fail(**kw):
        raise RuntimeError("simulated network down")

    _install(adapter, _fail)

    with pytest.raises(AIProviderError):
        await adapter.generate_structured(
            system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
        )

    cb = get_circuit_breaker()
    assert len(cb.failure_timestamps) == 1


@pytest.mark.asyncio
async def test_adapter_blocks_calls_when_circuit_degraded(monkeypatch):
    """Con el circuit en degraded, el adapter levanta AIProviderError sin
    llamar al API.
    """
    monkeypatch.setenv("LLM_CALL_MAX_RETRIES", "1")
    adapter = GoogleGenerativeAIAdapter(
        model_name="gemini-2.5-flash", max_retries=1, base_delay=0.0,
    )

    # Forzamos el breaker a degraded directamente.
    cb = get_circuit_breaker()
    cb.failure_timestamps.extend([time.monotonic()] * 3)
    cb.state = CIRCUIT_DEGRADED
    cb.opened_at = time.monotonic()

    calls = _install(adapter, lambda **kw: _ok_response(1))

    with pytest.raises(AIProviderError) as exc_info:
        await adapter.generate_structured(
            system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
        )

    # La llamada NO debió llegar al API.
    assert calls == [], f"El breaker no bloqueó: {len(calls)} llamadas"
    assert "circuit_breaker" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_adapter_probes_after_2_min_in_degraded(monkeypatch):
    """Tras 2 min en degraded, una llamada nueva pasa a half_open y llega al API.
    Si funciona, vuelve a healthy.
    """
    monkeypatch.setenv("LLM_CALL_MAX_RETRIES", "1")
    adapter = GoogleGenerativeAIAdapter(
        model_name="gemini-2.5-flash", max_retries=1, base_delay=0.0,
    )

    # Forzamos breaker a degraded con `opened_at` hace 121s (>2 min).
    cb = get_circuit_breaker()
    cb.failure_timestamps.extend([time.monotonic()] * 3)
    cb.state = CIRCUIT_DEGRADED
    cb.opened_at = time.monotonic() - 121.0

    calls = _install(adapter, lambda **kw: _ok_response(7))

    result, _ = await adapter.generate_structured(
        system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
    )

    # La call DID reach the API.
    assert len(calls) == 1
    assert result.value == 7
    # Tras success, el breaker está healthy.
    assert cb.state == CIRCUIT_HEALTHY


@pytest.mark.asyncio
async def test_adapter_4xx_terminal_error_records_failure(monkeypatch):
    """Un 4xx terminal cuenta como fallo para el breaker."""
    monkeypatch.setenv("LLM_CALL_MAX_RETRIES", "1")
    adapter = GoogleGenerativeAIAdapter(
        model_name="gemini-2.5-flash", max_retries=1, base_delay=0.0,
    )

    def _raise_403(**kw):
        raise _FakeAPIError(403)

    _install(adapter, _raise_403)

    with pytest.raises(AIProviderError):
        await adapter.generate_structured(
            system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
        )

    cb = get_circuit_breaker()
    # El 4xx terminal registra fallo.
    assert len(cb.failure_timestamps) >= 1


@pytest.mark.asyncio
async def test_adapter_after_3_failures_blocks_4th_call(monkeypatch):
    """Tras 3 fallos reales (no manual), la 4ª call se bloquea sin tocar API."""
    monkeypatch.setenv("LLM_CALL_MAX_RETRIES", "1")
    adapter = GoogleGenerativeAIAdapter(
        model_name="gemini-2.5-flash", max_retries=1, base_delay=0.0,
    )

    def _fail(**kw):
        raise RuntimeError("down")

    calls = _install(adapter, _fail)

    # 3 calls fallidas.
    for _ in range(3):
        with pytest.raises(AIProviderError):
            await adapter.generate_structured(
                system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
            )

    # Verificamos breaker abierto.
    cb = get_circuit_breaker()
    assert cb.state == CIRCUIT_DEGRADED

    # 4ª call: NO debe llegar al API.
    before = len(calls)
    with pytest.raises(AIProviderError) as exc_info:
        await adapter.generate_structured(
            system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
        )
    # El mock NO se invocó.
    assert len(calls) == before
    assert "circuit_breaker" in str(exc_info.value).lower()

"""S2-A-02 — Circuit breaker automático del Gemini adapter.

Política:
  - Sliding window de 5 min: si >3 fallos consecutivos → `degraded`.
  - En `degraded`, todas las calls levantan AIProviderError sin tocar la API
    durante 2 min.
  - Tras 2 min, transicionamos a `half_open`: la próxima call llega al API.
    Si OK → `healthy`. Si falla → vuelve a `degraded` con reloj reiniciado.

Estos tests NO levantan la API real — mockean `httpx.AsyncClient.post` para
inducir fallos y verifican que el adapter respete el estado del breaker.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

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
from pydantic import BaseModel


class _MiniSchema(BaseModel):
    value: int


@pytest.fixture(autouse=True)
def reset_breaker_and_env(monkeypatch):
    """Cada test arranca con breaker fresco y API key dummy."""
    monkeypatch.setenv("GOOGLE_GENAI_API_KEY", "dummy-test-key")
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


# ---- Integration: adapter respects the breaker -----------------------------


@pytest.mark.asyncio
async def test_adapter_record_success_on_ok(monkeypatch):
    """Una respuesta OK al adapter llama a `record_success`."""
    adapter = GoogleGenerativeAIAdapter(model_name="gemini-2.5-flash")

    # Mock de httpx que devuelve un JSON válido para _MiniSchema.
    async def _mock_post(self, *args, **kwargs):
        class _R:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {
                    "candidates": [{"content": {"parts": [{"text": '{"value": 42}'}]}, "finishReason": "STOP"}],
                    "usageMetadata": {"promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2},
                }
        return _R()

    with patch("httpx.AsyncClient.post", _mock_post):
        result, _ = await adapter.generate_structured(
            system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
        )
    assert result.value == 42
    assert get_circuit_breaker().state == CIRCUIT_HEALTHY


@pytest.mark.asyncio
async def test_adapter_record_failure_after_retries_exhausted(monkeypatch):
    """Tras agotar retries con fallos, el breaker registra un failure."""
    # Reducimos retries y delay para que el test no tarde.
    monkeypatch.setenv("LLM_CALL_MAX_RETRIES", "2")
    adapter = GoogleGenerativeAIAdapter(
        model_name="gemini-2.5-flash",
        max_retries=2,
        base_delay=0.0,  # sin sleeps
    )

    # Mock httpx que siempre lanza error.
    async def _mock_fail(self, *args, **kwargs):
        raise httpx.HTTPError("simulated network down")

    with patch("httpx.AsyncClient.post", _mock_fail):
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
        model_name="gemini-2.5-flash",
        max_retries=1,
        base_delay=0.0,
    )

    # Forzamos el breaker a degraded directamente.
    cb = get_circuit_breaker()
    cb.failure_timestamps.extend([time.monotonic()] * 3)
    cb.state = CIRCUIT_DEGRADED
    cb.opened_at = time.monotonic()

    # Mock que cuenta calls. Si el breaker funciona, NO debe llegar.
    calls = []

    async def _mock_post(self, *args, **kwargs):
        calls.append(1)
        class _R:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"candidates": [{"content": {"parts": [{"text": '{"value": 1}'}]}, "finishReason": "STOP"}],
                        "usageMetadata": {}}
        return _R()

    with patch("httpx.AsyncClient.post", _mock_post):
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
        model_name="gemini-2.5-flash",
        max_retries=1,
        base_delay=0.0,
    )

    # Forzamos breaker a degraded con `opened_at` hace 121s (>2 min).
    cb = get_circuit_breaker()
    cb.failure_timestamps.extend([time.monotonic()] * 3)
    cb.state = CIRCUIT_DEGRADED
    cb.opened_at = time.monotonic() - 121.0

    calls = []

    async def _mock_post(self, *args, **kwargs):
        calls.append(1)
        class _R:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"candidates": [{"content": {"parts": [{"text": '{"value": 7}'}]}, "finishReason": "STOP"}],
                        "usageMetadata": {}}
        return _R()

    with patch("httpx.AsyncClient.post", _mock_post):
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
        model_name="gemini-2.5-flash",
        max_retries=1,
        base_delay=0.0,
    )

    async def _mock_403(self, *args, **kwargs):
        class _R:
            status_code = 403
            text = "Forbidden"
            def raise_for_status(self):
                raise httpx.HTTPStatusError("403", request=None, response=None)
        return _R()

    with patch("httpx.AsyncClient.post", _mock_403):
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
        model_name="gemini-2.5-flash",
        max_retries=1,
        base_delay=0.0,
    )

    call_counter = []

    async def _mock_post(self, *args, **kwargs):
        call_counter.append(1)
        raise httpx.HTTPError("down")

    with patch("httpx.AsyncClient.post", _mock_post):
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
    before = len(call_counter)
    with patch("httpx.AsyncClient.post", _mock_post):
        with pytest.raises(AIProviderError) as exc_info:
            await adapter.generate_structured(
                system_prompt="s", user_prompt="u", response_schema=_MiniSchema,
            )
    # El mock NO se invocó.
    assert len(call_counter) == before
    assert "circuit_breaker" in str(exc_info.value).lower()

"""S1-A-06 — per-call LLM timeout en `GoogleGenerativeAIAdapter`.

Antes del Sprint 1, `gemini_adapter` solo tenía `httpx timeout=300s` total
para todos los retries. Un retry colgado bloqueaba un slot del semaphore
del swarm indefinidamente (incidente 2026-05-18).

Este módulo verifica:
  1. El env var `LLM_CALL_TIMEOUT_SECONDS` es leído al construir el adapter.
  2. El env var `LLM_CALL_MAX_RETRIES` es leído al construir el adapter.
  3. Defaults aplican cuando no están set (60s, 2 retries).
  4. Una llamada que tarda > timeout se cancela vía `asyncio.TimeoutError`.
  5. El loop de retries cuenta el timeout y reintenta hasta agotarlos.

La llamada al LLM ahora usa el SDK Vertex (`genai_client.aio.models.generate_content`);
los tests lo mockean directamente en la instancia del adapter.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from src.budget.domain.exceptions import AIProviderError
from src.budget.infrastructure.adapters.ai.gemini_adapter import (
    GoogleGenerativeAIAdapter,
    _DEFAULT_LLM_CALL_MAX_RETRIES,
    _DEFAULT_LLM_CALL_TIMEOUT_SECONDS,
    _read_llm_call_max_retries,
    _read_llm_call_timeout_seconds,
)


def _install_generate(adapter: GoogleGenerativeAIAdapter, coro_fn):
    """Reemplaza `adapter.genai_client.aio.models.generate_content` por `coro_fn`."""
    adapter.genai_client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=coro_fn))
    )


def _ok_response(text: str):
    return SimpleNamespace(
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(parts=[SimpleNamespace(text=text)]),
                finish_reason=SimpleNamespace(name="STOP"),
            )
        ],
        usage_metadata=SimpleNamespace(
            prompt_token_count=1, candidates_token_count=1, total_token_count=2
        ),
    )


# ---- Pure helpers: env-var parsing ----------------------------------------


def test_read_timeout_default_when_env_unset(monkeypatch):
    monkeypatch.delenv("LLM_CALL_TIMEOUT_SECONDS", raising=False)
    assert _read_llm_call_timeout_seconds() == _DEFAULT_LLM_CALL_TIMEOUT_SECONDS


def test_read_timeout_parses_valid_float(monkeypatch):
    monkeypatch.setenv("LLM_CALL_TIMEOUT_SECONDS", "30")
    assert _read_llm_call_timeout_seconds() == 30.0
    monkeypatch.setenv("LLM_CALL_TIMEOUT_SECONDS", "12.5")
    assert _read_llm_call_timeout_seconds() == 12.5


def test_read_timeout_falls_back_to_default_on_invalid(monkeypatch):
    """Valores absurdos (≤0, >600) o no-numéricos caen al default."""
    for bad in ["0", "-5", "601", "abc", "  "]:
        monkeypatch.setenv("LLM_CALL_TIMEOUT_SECONDS", bad)
        assert _read_llm_call_timeout_seconds() == _DEFAULT_LLM_CALL_TIMEOUT_SECONDS


def test_read_max_retries_default_when_env_unset(monkeypatch):
    monkeypatch.delenv("LLM_CALL_MAX_RETRIES", raising=False)
    assert _read_llm_call_max_retries() == _DEFAULT_LLM_CALL_MAX_RETRIES


def test_read_max_retries_parses_valid_int(monkeypatch):
    monkeypatch.setenv("LLM_CALL_MAX_RETRIES", "5")
    assert _read_llm_call_max_retries() == 5


def test_read_max_retries_falls_back_on_invalid(monkeypatch):
    for bad in ["0", "-1", "11", "abc", ""]:
        monkeypatch.setenv("LLM_CALL_MAX_RETRIES", bad)
        assert _read_llm_call_max_retries() == _DEFAULT_LLM_CALL_MAX_RETRIES


# ---- Adapter construction picks up env vars -------------------------------


def test_adapter_init_reads_env_vars(monkeypatch):
    """Sin args explícitos, init lee de env vars."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("LLM_CALL_TIMEOUT_SECONDS", "45")
    monkeypatch.setenv("LLM_CALL_MAX_RETRIES", "3")
    adapter = GoogleGenerativeAIAdapter()
    assert adapter.per_call_timeout_seconds == 45.0
    assert adapter.max_retries == 3


def test_adapter_init_explicit_overrides_win(monkeypatch):
    """Args explícitos ganan sobre env vars."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("LLM_CALL_TIMEOUT_SECONDS", "45")
    adapter = GoogleGenerativeAIAdapter(
        per_call_timeout_seconds=10.0,
        max_retries=4,
    )
    assert adapter.per_call_timeout_seconds == 10.0
    assert adapter.max_retries == 4


# ---- Per-call timeout cancels stuck SDK call ------------------------------


class _DummySchema(BaseModel):
    ok: bool = True


@pytest.mark.asyncio
async def test_generate_structured_times_out_when_call_exceeds_budget(monkeypatch):
    """Si la llamada al SDK tarda > timeout, se cancela vía asyncio.wait_for
    y el loop reintenta. Tras agotar retries levanta `AIProviderError`.
    """
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    adapter = GoogleGenerativeAIAdapter(
        per_call_timeout_seconds=0.05,  # 50ms — muy corto
        max_retries=2,
        base_delay=0.001,  # evita backoff lento en tests
    )

    async def _slow(**kwargs):
        await asyncio.sleep(1.0)  # > timeout
        return _ok_response("{}")

    _install_generate(adapter, _slow)

    with pytest.raises(AIProviderError):
        await adapter.generate_structured(
            system_prompt="sys",
            user_prompt="user",
            response_schema=_DummySchema,
            temperature=0.0,
            model="gemini-2.5-flash",
        )


@pytest.mark.asyncio
async def test_generate_structured_succeeds_when_call_within_budget(monkeypatch):
    """Sanity check: una llamada rápida no se afecta por el timeout wrapper."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    adapter = GoogleGenerativeAIAdapter(
        per_call_timeout_seconds=5.0,
        max_retries=2,
        base_delay=0.001,
    )

    async def _fast(**kwargs):
        await asyncio.sleep(0.01)  # bien dentro del budget
        return _ok_response('{"ok": true}')

    _install_generate(adapter, _fast)

    parsed, usage = await adapter.generate_structured(
        system_prompt="sys",
        user_prompt="user",
        response_schema=_DummySchema,
        temperature=0.0,
        model="gemini-2.5-flash",
    )
    assert parsed.ok is True
    assert usage.get("totalTokenCount") == 2

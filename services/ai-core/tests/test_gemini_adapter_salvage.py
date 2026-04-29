"""Tests del helper _salvage_truncated_json y de su integración en el adapter.

Escenario dominante de producción: Gemini trunca JSON en páginas densas. El salvage
rescata los objetos cerrados del array `items` antes del corte, permitiendo que el
pipeline continúe sin agotar los 5 retries del backoff.
"""

from __future__ import annotations

from typing import List, Optional
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import BaseModel

from src.budget.infrastructure.adapters.ai.gemini_adapter import (
    GoogleGenerativeAIAdapter,
    _salvage_truncated_json,
)


class _Item(BaseModel):
    code: str
    description: str
    quantity: float = 1.0


class _WrapperSchema(BaseModel):
    items: List[_Item]
    has_more_items: bool = False
    last_extracted_code: str = ""


def test_salvage_recovers_items_before_truncation_point():
    """3 items completos + 1 truncado en string → rescata los 3 primeros."""
    raw = (
        '{"items": ['
        '{"code": "1.1", "description": "Picado", "quantity": 10},'
        '{"code": "1.2", "description": "Alisado", "quantity": 5},'
        '{"code": "1.3", "description": "Solado", "quantity": 12},'
        '{"code": "1.4", "description": "Fábrica de arcilla semidura, con'  # ← truncado aquí
    )
    parsed, recovered = _salvage_truncated_json(raw, _WrapperSchema)
    assert parsed is not None
    assert recovered == 3
    assert len(parsed.items) == 3
    assert parsed.items[0].code == "1.1"
    assert parsed.items[2].description == "Solado"


def test_salvage_returns_none_when_no_items_closed():
    """Input truncado dentro del primer objeto → nada rescatable."""
    raw = '{"items": [{"code": "1.1", "description": "a medias'
    parsed, recovered = _salvage_truncated_json(raw, _WrapperSchema)
    assert parsed is None
    assert recovered == 0


def test_salvage_handles_escaped_quotes_inside_strings():
    """Descripciones con comillas escapadas no deben confundir al balance de strings."""
    raw = (
        '{"items": ['
        '{"code": "A", "description": "pared de \\"cal\\" con ladrillo", "quantity": 1},'
        '{"code": "B", "description": "otro", "quantity": 2},'
        '{"code": "C", "description": "truncado en el medio'  # ← sin cerrar
    )
    parsed, recovered = _salvage_truncated_json(raw, _WrapperSchema)
    assert parsed is not None
    assert recovered == 2
    assert parsed.items[0].description.startswith("pared de")


def test_salvage_handles_json_fully_closed_without_issues():
    """Si el JSON está completo (no truncado), salvage devuelve el array completo."""
    raw = (
        '{"items": ['
        '{"code": "1", "description": "ok", "quantity": 3},'
        '{"code": "2", "description": "ok2", "quantity": 5}'
        ']}'
    )
    parsed, recovered = _salvage_truncated_json(raw, _WrapperSchema)
    # Como está cerrado, paramos en el `]`. Cuando llegamos allí, `last_close` apunta
    # al último `}` top-level — rescatamos los 2 items.
    assert parsed is not None
    assert recovered == 2


def test_salvage_returns_none_when_not_json_object():
    """Input que no empieza por `{` → None (evita crash ante strings vacíos o basura)."""
    parsed, recovered = _salvage_truncated_json("", _WrapperSchema)
    assert parsed is None and recovered == 0

    parsed, recovered = _salvage_truncated_json("[1,2,3]", _WrapperSchema)
    assert parsed is None and recovered == 0


def test_salvage_returns_none_when_no_array_field_matches():
    """Si el schema no tiene un array field reconocible al principio del raw → None."""
    raw = '{"total": 42, "code": "X"}'
    parsed, recovered = _salvage_truncated_json(raw, _WrapperSchema)
    assert parsed is None and recovered == 0


# ---------- Integración del salvage dentro del adapter ----------


class _FakeAsyncClient:
    """Sustituto mínimo de httpx.AsyncClient que devuelve una respuesta canned."""

    def __init__(self, payload_text: str):
        self._payload_text = payload_text
        self.call_count = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, json=None, headers=None):
        self.call_count += 1

        class _Resp:
            def __init__(self, text):
                self._text = text
                self.status_code = 200

            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "candidates": [{
                        "content": {"parts": [{"text": self._text}]},
                    }],
                    "usageMetadata": {
                        "promptTokenCount": 100,
                        "candidatesTokenCount": 500,
                        "totalTokenCount": 600,
                    },
                }

        return _Resp(self._payload_text)


def test_adapter_uses_salvage_before_retry(monkeypatch):
    """Ante JSON truncado, el adapter NO agota los 5 retries: devuelve items rescatados en el primer intento."""
    import asyncio
    monkeypatch.setenv("GOOGLE_GENAI_API_KEY", "dummy")

    truncated_raw = (
        '{"items": ['
        '{"code": "A.1", "description": "Uno", "quantity": 10},'
        '{"code": "A.2", "description": "Dos", "quantity": 20},'
        '{"code": "A.3", "description": "truncado'  # ← EOF en medio de string
    )
    client = _FakeAsyncClient(payload_text=truncated_raw)

    adapter = GoogleGenerativeAIAdapter(max_retries=5, base_delay=0.01)

    with patch("httpx.AsyncClient", return_value=client):
        parsed, usage = asyncio.run(adapter.generate_structured(
            system_prompt="",
            user_prompt="x",
            response_schema=_WrapperSchema,
        ))

    assert parsed is not None
    assert len(parsed.items) == 2
    assert client.call_count == 1  # ¡no hizo retries!
    assert usage.get("_salvaged") is True
    assert usage.get("_items_recovered") == 2


def test_adapter_retries_on_non_validation_errors(monkeypatch):
    """Errores HTTP no son truncamiento; el adapter debe seguir el camino de retry normal."""
    import asyncio
    import httpx
    monkeypatch.setenv("GOOGLE_GENAI_API_KEY", "dummy")

    call_count = {"n": 0}

    class _ErrorClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json=None, headers=None):
            call_count["n"] += 1
            raise httpx.ConnectError("connection refused")

    adapter = GoogleGenerativeAIAdapter(max_retries=2, base_delay=0.001)

    from src.budget.domain.exceptions import AIProviderError

    with patch("httpx.AsyncClient", return_value=_ErrorClient()):
        with pytest.raises(AIProviderError):
            asyncio.run(adapter.generate_structured(
                system_prompt="",
                user_prompt="x",
                response_schema=_WrapperSchema,
            ))

    assert call_count["n"] == 2  # respetó max_retries

"""Tests del boundary DTO (`RestructuredItem`) → Domain (`OriginalItem`) en el
Swarm Pricing.

Motivo: `RestructuredItem` declara `code`, `unit` y `chapter` como `Optional[str]`
(Gemini puede emitirlos como `null` en partidas ambiguas). `OriginalItem` los
exige `str`. Sin saneamiento explícito en el boundary, un único item con
`unit=None` aborta el job entero y pierde las 70+ partidas ya resueltas.

Los tests cubren dos invariantes:
  1. El patrón `or default` del boundary produce un `OriginalItem` válido aun
     cuando todos los Optional del DTO vienen `None`.
  2. Ante una excepción al ensamblar una partida concreta, el bucle continúa
     procesando las demás y emite un evento `item_skipped`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest
from pydantic import ValidationError

from src.budget.application.ports.ports import IGenerationEmitter
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.domain.entities import OriginalItem


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({"budget_id": budget_id, "type": event_type, "data": data})


# -------- Test 1: contrato Pydantic --------------------------------------------------


def test_sanitized_values_produce_valid_original_item_when_all_optionals_are_null():
    """
    Simula la salida de Gemini cuando una partida ambigua llega con code/unit/chapter
    en null. El patrón de saneamiento del boundary debe producir un OriginalItem válido.
    """
    ri = RestructuredItem(
        code=None,
        description="Cableado eléctrico sin unidad clara",
        quantity=1.0,
        unit=None,
        chapter=None,
    )

    # Replicamos el patrón exacto de swarm_pricing_service.py:235
    safe_code = ri.code or ""
    safe_description = ri.description or ""
    safe_quantity = ri.quantity if ri.quantity is not None else 0.0
    safe_unit = ri.unit or "ud"
    safe_chapter = ri.chapter or "Sin Capítulo"

    oi = OriginalItem(
        code=safe_code,
        description=safe_description,
        quantity=safe_quantity,
        unit=safe_unit,
        chapter=safe_chapter,
        raw_table_data="Basis Swarm AI Extracted",
    )

    assert oi.code == ""
    assert oi.unit == "ud"
    assert oi.chapter == "Sin Capítulo"
    assert oi.quantity == 1.0


def test_original_item_without_sanitization_rejects_null_unit():
    """Guarda-raíl: sin saneamiento explícito, `OriginalItem(unit=None)` debe fallar.
    Si este test deja de pasar significa que alguien relajó el schema de dominio —
    decisión consciente, pero que invalida la razón de existir del saneamiento.
    """
    with pytest.raises(ValidationError):
        OriginalItem(
            code="X.1",
            description="Partida",
            quantity=1.0,
            unit=None,  # type: ignore[arg-type]
            chapter="Sin Capítulo",
        )


# -------- Test 2: skip-per-item en evaluate_batch ------------------------------------


def test_evaluate_batch_skips_corrupt_item_and_emits_event(monkeypatch):
    """Un item que revienta al construir `OriginalItem` NO aborta el batch.
    Los demás items se resuelven normalmente; se emite `item_skipped` para el malo.
    """
    import asyncio

    from src.budget.application.services import swarm_pricing_service as sps_mod
    from src.budget.application.services.swarm_pricing_service import (
        BatchPricedItemV3,
        BatchPricingEvaluatorResultV3,
        PricingFinalResultDB,
        SwarmPricingService,
    )
    from src.budget.application.ports.ports import ILLMProvider, IVectorSearch

    # --- Mocks mínimos de colaboradores ----------------------------------------------

    class _FakeLLM(ILLMProvider):
        """Devuelve respuestas canónicas para cada fase del swarm."""

        async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=False, queries=["q"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                # Con CHUNK_SIZE=1 (v005), cada chunk contiene exactamente una
                # partida — detectamos cuál por su code aparece en el user_prompt
                # y devolvemos solo esa valoración.
                all_valuations = {
                    "OK.1": BatchPricedItemV3(
                        item_code="OK.1",
                        valuation=PricingFinalResultDB(
                            pensamiento_calculista="razón OK",
                            calculated_unit_price=100.0,
                            needs_human_review=False,
                            match_kind="1:1",
                        ),
                    ),
                    "CORRUPT.1": BatchPricedItemV3(
                        item_code="CORRUPT.1",
                        valuation=PricingFinalResultDB(
                            pensamiento_calculista="razón CORRUPT",
                            calculated_unit_price=200.0,
                            needs_human_review=False,
                            match_kind="1:1",
                        ),
                    ),
                }
                # Match por presencia del code como substring en el user_prompt.
                # Con CHUNK_SIZE=1, cada chunk trae solo un code; filtramos
                # para devolver solo la valoración correspondiente.
                results = [
                    item for code, item in all_valuations.items()
                    if code in user_prompt
                ]
                return BatchPricingEvaluatorResultV3(results=results), {}
            raise AssertionError(f"Schema inesperado en el mock: {name}")

        async def get_embedding(self, text: str):
            return [0.0] * 768

    class _FakeVectorSearch(IVectorSearch):
        def search_similar_items(
            self, query_vector, query_text, limit=4, **kwargs
        ):
            return [
                {
                    "id": "cand-1",
                    "description": "Candidato",
                    "priceTotal": 50.0,
                    "unit": "ud",
                    "matchScore": 0.9,
                }
            ]

    # Patch de OriginalItem dentro del módulo: revienta SOLO cuando code == 'CORRUPT.1'.
    real_OriginalItem = sps_mod.OriginalItem

    def fake_OriginalItem(**kwargs):
        if kwargs.get("code") == "CORRUPT.1":
            raise ValueError("Simulated domain validation failure")
        return real_OriginalItem(**kwargs)

    monkeypatch.setattr(sps_mod, "OriginalItem", fake_OriginalItem)

    # --- Ejecución ------------------------------------------------------------------

    # `_load_prompt` lee del disco: monkeypatch para evitar I/O en el test.
    # Devolvemos los `batch_items` en el user_prompt para que el mock LLM
    # pueda filtrar por el code de la partida del chunk actual (CHUNK_SIZE=1).
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_FakeLLM(),
        vector_search=_FakeVectorSearch(),
        emitter=emitter,
    )

    items = [
        RestructuredItem(code="OK.1", description="Item válido", quantity=2.0, unit="m2", chapter="A"),
        RestructuredItem(code="CORRUPT.1", description="Item que revienta", quantity=1.0, unit="ud", chapter="A"),
    ]

    metrics: Dict[str, float] = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-1", metrics=metrics))

    # Assertions: 1 partida resuelta + 1 evento item_skipped con el código correcto.
    assert len(priced) == 1
    assert priced[0].code == "OK.1"

    skipped_events = [e for e in emitter.events if e["type"] == "item_skipped"]
    assert len(skipped_events) == 1
    assert skipped_events[0]["data"]["code"] == "CORRUPT.1"
    assert "Simulated" in skipped_events[0]["data"]["reason"]

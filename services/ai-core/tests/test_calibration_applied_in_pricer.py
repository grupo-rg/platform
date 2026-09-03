"""Calibración aplicada en el pricer (swarm boundary).

Verifica que ``_evaluate_batch_inner`` aplica el factor de calibración al PEM,
escala el breakdown por el mismo factor, excluye ``from_scratch`` y BC3
active-source, y puebla los campos nuevos de ``AIResolution``.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from src.budget.application.ports.ports import (
    IGenerationEmitter,
    ILLMProvider,
    IVectorSearch,
)
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.calibration_service import (
    CalibrationTable,
    ChapterCalibration,
)
from src.budget.application.services.swarm_pricing_service import (
    BatchPricedItemV3,
    BatchPricingEvaluatorResultV3,
    BreakdownComponentSchema,
    PricingFinalResultDB,
    SwarmPricingService,
)


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({"budget_id": budget_id, "type": event_type, "data": data})


class _FakeVectorSearch(IVectorSearch):
    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return [
            {
                "id": "cand-1",
                "description": "Candidato catálogo",
                "priceTotal": 100.0,
                "unit": "m2",
                "matchScore": 0.9,
            }
        ]


def _make_llm(valuations: Dict[str, PricingFinalResultDB]) -> ILLMProvider:
    """LLM fake que devuelve la valuación asociada a cada código presente en el
    prompt del batch (los códigos aparecen literalmente en `user_prompt`)."""

    class _FakeLLM(ILLMProvider):
        async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=False, queries=["q"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                results = [
                    BatchPricedItemV3(item_code=code, valuation=val)
                    for code, val in valuations.items()
                    if code in user_prompt
                ]
                return BatchPricingEvaluatorResultV3(results=results), {}
            raise AssertionError(f"Schema inesperado: {name}")

        async def get_embedding(self, text: str):
            return [0.0] * 768

    return _FakeLLM()


def _table_demoliciones_142() -> CalibrationTable:
    return CalibrationTable(
        global_factor=1.36,
        guard_min_samples=8,
        clamp_min=0.8,
        clamp_max=2.6,
        chapters={
            "DEMOLICIONES": ChapterCalibration(
                factor=1.42, source="seed", sample_count=0, manual_factor=1.42,
            ),
        },
    )


class _FakeCalibrationService:
    def __init__(self, table: CalibrationTable):
        self._table = table

    async def load(self) -> CalibrationTable:
        return self._table


def _run(svc: SwarmPricingService, items, budget_id="b-cal"):
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    return asyncio.run(svc.evaluate_batch(items, budget_id=budget_id, metrics=metrics))


def _patch_prompt(monkeypatch):
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )


# --------------------------------------------------------------------------- #
# 1. Factor aplicado al PEM + campos de AIResolution                          #
# --------------------------------------------------------------------------- #
def test_factor_applied_at_pem_and_ai_resolution_fields(monkeypatch):
    _patch_prompt(monkeypatch)
    valuations = {
        "DEM.1": PricingFinalResultDB(
            pensamiento_calculista="match 1:1",
            calculated_unit_price=100.0,
            needs_human_review=False,
            match_kind="1:1",
        ),
    }
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_make_llm(valuations),
        vector_search=_FakeVectorSearch(),
        emitter=emitter,
        calibration_service=_FakeCalibrationService(_table_demoliciones_142()),
    )
    items = [RestructuredItem(code="DEM.1", description="Demolición tabique", quantity=10.0,
                             unit="m2", chapter="DEMOLICIONES")]
    priced = _run(svc, items)
    p = priced[0]

    # PEM calibrado: 100 × 1.42 = 142.
    assert p.ai_unit_price == 142.0
    assert p.unitPrice == 142.0            # active source == ai
    assert p.totalPrice == 142.0 * 10.0
    ar = p.ai_resolution
    assert ar.calculated_unit_price == 142.0
    assert ar.pre_calibration_unit_price == 100.0
    assert ar.applied_calibration_factor == 1.42

    cal_events = [e for e in emitter.events if e["type"] == "calibration_applied"]
    assert len(cal_events) == 1
    d = cal_events[0]["data"]
    assert d["chapter"] == "DEMOLICIONES"
    assert d["factor"] == 1.42
    assert d["source"] == "seed"
    assert d["price_before"] == 100.0
    assert d["price_after"] == 142.0


# --------------------------------------------------------------------------- #
# 2. Breakdown escalado por el mismo factor (sin divergencia falsa)           #
# --------------------------------------------------------------------------- #
def test_breakdown_scaled_by_factor(monkeypatch):
    _patch_prompt(monkeypatch)
    valuations = {
        "DEM.2": PricingFinalResultDB(
            pensamiento_calculista="1:1 con descompuesto",
            calculated_unit_price=100.0,
            needs_human_review=False,
            match_kind="1:1",
            breakdown=[
                BreakdownComponentSchema(code="mo", concept="Mano de obra", type="LABOR",
                                         price=60.0, **{"yield": 1.0}, total=60.0),
                BreakdownComponentSchema(code="mat", concept="Material", type="MATERIAL",
                                         price=40.0, **{"yield": 1.0}, total=40.0),
            ],
        ),
    }
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_make_llm(valuations),
        vector_search=_FakeVectorSearch(),
        emitter=emitter,
        calibration_service=_FakeCalibrationService(_table_demoliciones_142()),
    )
    items = [RestructuredItem(code="DEM.2", description="Demolición con descompuesto",
                             quantity=1.0, unit="m2", chapter="DEMOLICIONES")]
    p = _run(svc, items)[0]

    assert p.ai_unit_price == 142.0
    # Breakdown escalado 60→85.2, 40→56.8; suma ≈ 142 = final calibrado.
    totals = sorted(round(b.total, 2) for b in p.breakdown)
    assert totals == [56.8, 85.2]
    assert round(sum(b.total for b in p.breakdown), 2) == 142.0
    # La reconciliación NO debe marcar divergencia falsa (ambos escalados igual).
    assert not p.needs_reconciliation
    assert not any(e["type"] == "partida_needs_reconciliation" for e in emitter.events)


# --------------------------------------------------------------------------- #
# 3. from_scratch excluido (factor 1.0, campos registrados)                   #
# --------------------------------------------------------------------------- #
def test_from_scratch_excluded_from_calibration(monkeypatch):
    _patch_prompt(monkeypatch)
    valuations = {
        "FS.1": PricingFinalResultDB(
            pensamiento_calculista="compuesto desde cero",
            calculated_unit_price=100.0,
            needs_human_review=True,
            match_kind="from_scratch",
        ),
    }
    emitter = _SpyEmitter()
    # Sin compositor inyectado → final_price se mantiene = precio LLM.
    svc = SwarmPricingService(
        llm_provider=_make_llm(valuations),
        vector_search=_FakeVectorSearch(),
        emitter=emitter,
        calibration_service=_FakeCalibrationService(_table_demoliciones_142()),
    )
    items = [RestructuredItem(code="FS.1", description="Partida sin catálogo", quantity=1.0,
                             unit="m2", chapter="DEMOLICIONES")]
    p = _run(svc, items)[0]

    assert p.ai_unit_price == 100.0  # NO calibrado
    ar = p.ai_resolution
    assert ar.applied_calibration_factor == 1.0
    assert ar.pre_calibration_unit_price == 100.0
    assert not any(e["type"] == "calibration_applied" for e in emitter.events)


# --------------------------------------------------------------------------- #
# 4. BC3 active-source excluido                                               #
# --------------------------------------------------------------------------- #
def test_bc3_active_source_excluded_from_calibration(monkeypatch):
    _patch_prompt(monkeypatch)
    valuations = {
        "BC3.1": PricingFinalResultDB(
            pensamiento_calculista="1:1 pero la partida trae precio BC3",
            calculated_unit_price=100.0,
            needs_human_review=False,
            match_kind="1:1",
        ),
    }
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_make_llm(valuations),
        vector_search=_FakeVectorSearch(),
        emitter=emitter,
        calibration_service=_FakeCalibrationService(_table_demoliciones_142()),
    )
    items = [RestructuredItem(code="BC3.1", description="Partida BC3 con precio propio",
                             quantity=2.0, unit="m2", chapter="DEMOLICIONES",
                             bc3_unit_price=50.0)]
    p = _run(svc, items)[0]

    assert p.active_price_source == "bc3"
    assert p.unitPrice == 50.0              # precio activo = BC3, intacto
    assert p.ai_unit_price == 100.0         # estimación IA NO calibrada
    ar = p.ai_resolution
    assert ar.applied_calibration_factor == 1.0
    assert not any(e["type"] == "calibration_applied" for e in emitter.events)


# --------------------------------------------------------------------------- #
# 5. Capítulo poco fiable → factor global                                     #
# --------------------------------------------------------------------------- #
def test_low_confidence_chapter_uses_global_factor(monkeypatch):
    _patch_prompt(monkeypatch)
    valuations = {
        "V.1": PricingFinalResultDB(
            pensamiento_calculista="1:1",
            calculated_unit_price=100.0,
            needs_human_review=False,
            match_kind="1:1",
        ),
    }
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_make_llm(valuations),
        vector_search=_FakeVectorSearch(),
        emitter=emitter,
        calibration_service=_FakeCalibrationService(_table_demoliciones_142()),
    )
    items = [RestructuredItem(code="V.1", description="Partida varios", quantity=1.0,
                             unit="m2", chapter="VARIOS")]
    p = _run(svc, items)[0]

    # VARIOS es low-confidence → global 1.36 (no la entrada DEMOLICIONES).
    assert p.ai_unit_price == 136.0
    assert p.ai_resolution.applied_calibration_factor == 1.36
    assert p.ai_resolution.pre_calibration_unit_price == 100.0


# --------------------------------------------------------------------------- #
# 6. Sin calibration_service → no-op (backward-compat)                        #
# --------------------------------------------------------------------------- #
def test_no_calibration_service_is_noop(monkeypatch):
    _patch_prompt(monkeypatch)
    valuations = {
        "N.1": PricingFinalResultDB(
            pensamiento_calculista="1:1",
            calculated_unit_price=100.0,
            needs_human_review=False,
            match_kind="1:1",
        ),
    }
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_make_llm(valuations),
        vector_search=_FakeVectorSearch(),
        emitter=emitter,
        # calibration_service ausente
    )
    items = [RestructuredItem(code="N.1", description="Demolición", quantity=1.0,
                             unit="m2", chapter="DEMOLICIONES")]
    p = _run(svc, items)[0]

    assert p.ai_unit_price == 100.0  # sin calibrar
    assert p.ai_resolution.applied_calibration_factor == 1.0
    assert p.ai_resolution.pre_calibration_unit_price == 100.0
    assert not any(e["type"] == "calibration_applied" for e in emitter.events)

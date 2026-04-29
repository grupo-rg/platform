"""Fase 11.A — el boundary DTO→Domain escala el `breakdown[]` cuando el Judge
aplicó una `unit_conversion_applied` y se olvidó de escalar los componentes.

Bug observado (eval 2026-04-27, partida 01.03 Reparación de canto de forjado):
  - Catalog item m² 165.46 €/m².
  - Partida en ml con cross-section 0.25 m²/ml.
  - Judge emite `calculated_unit_price = 41.37 €/ml` correctamente,
    pero `breakdown[]` con price=100 / total=165.46 (en base m², sin escalar).
  - Resultado: UI suma componentes y ve 165.46 €/u; partida total usa 41.37 €/ml.
  - Ratio 165.46 / 41.37 = exactamente 4.0 → "Divergencia de sumatorios".

Invariantes de 11.A:
  1. Si `unit_conversion_applied` está presente Y `sum(breakdown.total) / unit_price`
     se sale del rango [0.95, 1.05], escalar cada `price` y `total` por
     `factor = result / value`. Emitir evento `breakdown_scaled_defensive`.
  2. Si `unit_conversion_applied` es None pero el breakdown diverge fuerte
     (ratio > 1.5), emitir `breakdown_sum_divergence` warning sin escalar.
  3. Comportamiento sin conversión y con sumatorio coherente: literal.
  4. Idempotencia: si el LLM YA escaló, no escalar otra vez.
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
from src.budget.application.services.swarm_pricing_service import (
    BatchPricedItemV3,
    BatchPricingEvaluatorResultV3,
    BreakdownComponentSchema,
    PricingFinalResultDB,
    SwarmPricingService,
    UnitConversionRecord,
)


class _SpyEmitter(IGenerationEmitter):
    def __init__(self) -> None:
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({"budget_id": budget_id, "type": event_type, "data": data})


class _FakeVectorSearch(IVectorSearch):
    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return [
            {
                "id": "cand-1",
                "description": "Candidato m2",
                "priceTotal": 165.46,
                "unit": "m2",
                "matchScore": 0.92,
            }
        ]


def _make_llm_with_valuation(target_code: str, valuation: PricingFinalResultDB) -> ILLMProvider:
    """Construye un fake LLM que devuelve la `valuation` proporcionada para `target_code`.
    Para el resto de schemas (DeconstructResult, etc.) responde lo mínimo viable.
    """

    class _FakeLLM(ILLMProvider):
        async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=False, queries=["q"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                if target_code in user_prompt:
                    return (
                        BatchPricingEvaluatorResultV3(
                            results=[BatchPricedItemV3(item_code=target_code, valuation=valuation)]
                        ),
                        {},
                    )
                return BatchPricingEvaluatorResultV3(results=[]), {}
            raise AssertionError(f"Schema inesperado: {name}")

        async def get_embedding(self, text: str):
            return [0.0] * 768

    return _FakeLLM()


def _build_service(monkeypatch, llm: ILLMProvider, emitter: _SpyEmitter) -> SwarmPricingService:
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    return SwarmPricingService(
        llm_provider=llm,
        vector_search=_FakeVectorSearch(),
        emitter=emitter,
    )


def _build_partida() -> RestructuredItem:
    return RestructuredItem(
        code="01.03",
        description="Reparación de canto de forjado/pórticos",
        quantity=76.5,
        unit="ml",
        chapter="DEFICIENCIAS IEE",
    )


# -------- Test 1: con unit_conversion + breakdown sin escalar → boundary escala --


def test_breakdown_scaled_when_unit_conversion_applied(monkeypatch) -> None:
    """Caso real del bug 01.03: catalog 165.46€/m² + factor 0.25 → unit_price 41.37€/ml.
    LLM emite breakdown sin escalar (price=100, total=165.46). Boundary debe escalar.
    """
    val = PricingFinalResultDB(
        pensamiento_calculista="canto forjado: 1 ml ≈ 0.25 m² → 165.46 × 0.25 = 41.37",
        calculated_unit_price=41.37,
        needs_human_review=False,
        match_kind="1:1",
        unit_conversion_applied=UnitConversionRecord(
            value=1.0,
            from_unit="ml",
            to_unit="m2",
            bridge={"section_m2_per_ml": 0.25},
            result=0.25,
        ),
        breakdown=[
            BreakdownComponentSchema(
                code="mt-grout",
                concept="Mortero de reparación R4",
                price=100.0,
                **{"yield": 1.0},
                total=100.0,
            ),
            BreakdownComponentSchema(
                code="mo-of1",
                concept="Oficial 1ª albañil",
                price=65.46,
                **{"yield": 1.0},
                total=65.46,
            ),
        ],
    )
    emitter = _SpyEmitter()
    svc = _build_service(monkeypatch, _make_llm_with_valuation("01.03", val), emitter)
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch([_build_partida()], budget_id="b-1", metrics=metrics))

    p = priced[0]
    assert p.breakdown is not None and len(p.breakdown) == 2
    assert p.breakdown[0].price == 25.0  # 100 * 0.25
    assert p.breakdown[0].total == 25.0  # 100 * 0.25
    assert abs(p.breakdown[1].price - 16.365) < 0.01  # 65.46 * 0.25
    sum_total = sum((b.total or 0) for b in p.breakdown)
    assert abs(sum_total - 41.37) < 0.5  # ≈ unit_price (tolerancia parsing)

    scaled_events = [e for e in emitter.events if e["type"] == "breakdown_scaled_defensive"]
    assert len(scaled_events) == 1
    assert scaled_events[0]["data"]["code"] == "01.03"
    assert abs(scaled_events[0]["data"]["factor"] - 0.25) < 0.001


# -------- Test 2: sin unit_conversion + sumatorio coherente → literal -----------


def test_breakdown_unchanged_without_unit_conversion(monkeypatch) -> None:
    """Sin conversión y con sumatorio coherente → boundary copia literal sin tocar."""
    val = PricingFinalResultDB(
        pensamiento_calculista="match directo 1:1",
        calculated_unit_price=10.0,
        needs_human_review=False,
        match_kind="1:1",
        unit_conversion_applied=None,
        breakdown=[
            BreakdownComponentSchema(
                code="mo-of2",
                concept="Oficial 2ª",
                price=10.0,
                **{"yield": 1.0},
                total=10.0,
            ),
        ],
    )
    emitter = _SpyEmitter()
    svc = _build_service(monkeypatch, _make_llm_with_valuation("01.03", val), emitter)
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch([_build_partida()], budget_id="b-2", metrics=metrics))

    p = priced[0]
    assert p.breakdown is not None and len(p.breakdown) == 1
    assert p.breakdown[0].price == 10.0  # literal, no escala
    assert p.breakdown[0].total == 10.0
    scaled = [e for e in emitter.events if e["type"] in {"breakdown_scaled_defensive", "breakdown_sum_divergence"}]
    assert scaled == []  # ningún evento de divergencia/escalado


# -------- Test 3: sin unit_conversion pero sumatorio diverge fuerte → warning ---


def test_breakdown_anomaly_event_emitted_when_sum_diverges(monkeypatch) -> None:
    """Caso patológico sin conversión declarada: ratio > 1.5 → warning informativo."""
    val = PricingFinalResultDB(
        pensamiento_calculista="match dudoso",
        calculated_unit_price=41.37,
        needs_human_review=False,
        match_kind="1:1",
        unit_conversion_applied=None,
        breakdown=[
            BreakdownComponentSchema(
                code="mt-grout",
                concept="Mortero R4",
                price=100.0,
                **{"yield": 1.0},
                total=100.0,
            ),
            BreakdownComponentSchema(
                code="mo-of1",
                concept="Oficial 1ª",
                price=65.46,
                **{"yield": 1.0},
                total=65.46,
            ),
        ],
    )
    emitter = _SpyEmitter()
    svc = _build_service(monkeypatch, _make_llm_with_valuation("01.03", val), emitter)
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch([_build_partida()], budget_id="b-3", metrics=metrics))

    p = priced[0]
    # Sin conversión declarada NO escalamos — sólo señalamos.
    assert p.breakdown[0].total == 100.0
    assert p.breakdown[1].total == 65.46
    div_events = [e for e in emitter.events if e["type"] == "breakdown_sum_divergence"]
    assert len(div_events) == 1
    assert div_events[0]["data"]["code"] == "01.03"
    assert div_events[0]["data"]["ratio"] >= 3.9  # 165.46 / 41.37 ≈ 4.0


# -------- Test 3b: divergencia bidireccional — sum_below sin conversión --------


def test_breakdown_anomaly_emitted_when_sum_diverges_below(monkeypatch) -> None:
    """Caso 01.06 del eval (Fase 13.B): Judge emite unit_price=73.80 (calculado
    9 m² × 6.40 + 16.20 vía DIMENSIONAMIENTO OCULTO) pero breakdown almacena
    los precios del catálogo SIN escalar (DRT020.price=6.40 + GRA010.price=36.01
    = 42.41). Ratio = 0.57 < 0.7 → emitir warning bidireccional sin escalar
    (no hay datos de conversión declarados).
    """
    val = PricingFinalResultDB(
        pensamiento_calculista="DIMENSIONAMIENTO OCULTO: 9 m² × 6.40 + 16.20 = 73.80",
        calculated_unit_price=73.80,
        needs_human_review=False,
        match_kind="1:N",
        unit_conversion_applied=None,  # Judge compuso manualmente sin emitir conversión
        breakdown=[
            BreakdownComponentSchema(
                code="DRT020",
                concept="Demolición de falso techo",
                price=6.40,
                **{"yield": 1.0},
                total=6.40,
            ),
            BreakdownComponentSchema(
                code="GRA010",
                concept="Transporte de residuos",
                price=36.01,
                **{"yield": 1.0},
                total=36.01,
            ),
        ],
    )
    emitter = _SpyEmitter()
    svc = _build_service(monkeypatch, _make_llm_with_valuation("01.03", val), emitter)
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch([_build_partida()], budget_id="b-13b", metrics=metrics))

    p = priced[0]
    # Sin conversión declarada → no escalamos. Componentes copiados literal.
    assert p.breakdown[0].total == 6.40
    assert p.breakdown[1].total == 36.01
    # Pero emitimos un warning de divergencia con dirección 'sum_below'.
    div_events = [e for e in emitter.events if e["type"] == "breakdown_sum_divergence"]
    assert len(div_events) == 1
    assert div_events[0]["data"]["ratio"] < 0.7
    assert div_events[0]["data"]["direction"] == "sum_below"


# -------- Test 4: idempotencia — LLM ya escaló, no escalar otra vez -------------


def test_breakdown_scaling_idempotent_when_llm_already_scaled(monkeypatch) -> None:
    """Si el LLM ya emitió breakdown coherente con unit_price (regla 14b respetada),
    el guard NO debe escalar otra vez (de lo contrario los precios saldrían ÷factor²).
    """
    val = PricingFinalResultDB(
        pensamiento_calculista="LLM bien comportado: ya escalé el breakdown.",
        calculated_unit_price=41.37,
        needs_human_review=False,
        match_kind="1:1",
        unit_conversion_applied=UnitConversionRecord(
            value=1.0,
            from_unit="ml",
            to_unit="m2",
            bridge={"section_m2_per_ml": 0.25},
            result=0.25,
        ),
        breakdown=[
            BreakdownComponentSchema(
                code="mt-grout",
                concept="Mortero R4",
                price=25.0,
                **{"yield": 1.0},
                total=25.0,
            ),
            BreakdownComponentSchema(
                code="mo-of1",
                concept="Oficial 1ª",
                price=16.37,
                **{"yield": 1.0},
                total=16.37,
            ),
        ],
    )
    emitter = _SpyEmitter()
    svc = _build_service(monkeypatch, _make_llm_with_valuation("01.03", val), emitter)
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch([_build_partida()], budget_id="b-4", metrics=metrics))

    p = priced[0]
    # No tocamos: ya estaba bien.
    assert p.breakdown[0].price == 25.0
    assert p.breakdown[0].total == 25.0
    assert abs(p.breakdown[1].price - 16.37) < 0.01
    scaled = [e for e in emitter.events if e["type"] == "breakdown_scaled_defensive"]
    assert scaled == []

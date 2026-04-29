"""Fase 5.G — test canónico del caso "1.1 Ud Acondicionamiento del solar".

**ESTRELLA DEL NORTE DEL SPRINT.** Escrito en Fase 1 como placeholder con
`@pytest.mark.skip`, ahora (Fase 5.G) se desbloquea y debe quedar verde con
el stack v005 completo detrás: `SwarmPricingService` + `catalog_lookup` +
prompts con normas + `match_kind` + `unit_conversion_applied` + boundary
DTO→Domain (Fase 5.E).

Este test combina en UNA SOLA partida los tres riesgos que el pipeline
v004 no resolvía:

  1. **Jerga de unidad declarada**: "Ud" con `unit_normalized="ud"` pero
     interior compuesto (1:N).
  2. **Descomposición 1:N**: "Incluye" con tres sub-actividades.
  3. **Conversión matemática**: libro en m³, medición en `50 m² × 10 cm = 5 m³`,
     bridge `thickness_m` aportado como hint por el extractor.

Input (tal como llega del Extractor INLINE tras 5.B):

  RestructuredItem(
    code="1.1", unit="Ud", unit_normalized="ud", unit_dimension="discreto",
    unit_conversion_hints={"thickness_m": 0.10},
    description="Acondicionamiento de la entrada del solar para camiones.
                 Incluye: - Limpiar superficie - Meter 10cm de grava,
                 40-60mm, 50m2 - Compactar grava",
    quantity=1.0, chapter="MOVIMIENTO DE TIERRAS",
  )

Salida esperada del Swarm (tras Fase 5.E):

  BudgetPartida(
    match_kind="1:N",
    unit_conversion_applied={"value":50, "from_unit":"m2", "to_unit":"m3",
                              "bridge":{"thickness_m":0.10}, "result":5.0},
    breakdown=[<3 BudgetBreakdownComponent>: limpieza, grava, compactado],
    totalPrice>0, needs_human_review=False,
  )

Mocks: LLM + vector_search son deterministas. El propósito es verificar
**el contrato de extremo a extremo** del pipeline — no la calidad del LLM
real, que se valida en la eval de Fase 5.H contra PDFs golden.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Type

import pytest
from pydantic import BaseModel

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
from src.budget.catalog.application.services.catalog_lookup_service import (
    CatalogLookupService,
)
from src.budget.catalog.domain.measurement import Measurement
from src.budget.catalog.infrastructure.adapters.in_memory_catalog_repository import (
    InMemoryCatalogRepository,
)


# -------- Mocks deterministas del Swarm --------------------------------------


class _SpyEmitter(IGenerationEmitter):
    def __init__(self) -> None:
        self.events: List[Dict[str, Any]] = []

    def emit_event(
        self, budget_id: str, event_type: str, data: Dict[str, Any]
    ) -> None:
        self.events.append({"budget_id": budget_id, "type": event_type, "data": data})


class _CanonicalJudgeLLM(ILLMProvider):
    """Simula el Pro del Swarm. Para el caso canónico devuelve un 1:N con
    conversión m²→m³ aplicada a la sub-partida de grava."""

    async def generate_structured(
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: Type[BaseModel],
        **kwargs: Any,
    ) -> tuple[BaseModel, Dict[str, int]]:
        name = response_schema.__name__
        usage: Dict[str, int] = {
            "promptTokenCount": 0,
            "candidatesTokenCount": 0,
            "totalTokenCount": 0,
        }

        if name == "DeconstructResult":
            return (
                response_schema(
                    is_complex=True,
                    queries=[
                        "limpieza superficie solar",
                        "grava 40 60 mm m3",
                        "compactado grava",
                    ],
                ),
                usage,
            )

        if name == "BatchPricingEvaluatorResultV3":
            # CHUNK_SIZE=1 → el Pro ve una sola partida por prompt. El user_prompt
            # incluye `batch_items` con el code "1.1". Devolvemos el dictamen 1:N.
            if "1.1" not in user_prompt:
                return BatchPricingEvaluatorResultV3(results=[]), usage

            valuation = PricingFinalResultDB(
                pensamiento_calculista=(
                    "Partida 1:N compuesta. Tres sub-actividades: limpieza superficial, "
                    "extendido de grava 40-60 mm y compactado. La medición de grava "
                    "viene en m² (50 m²) con espesor 10 cm explícito en la descripción, "
                    "y el candidato del libro se cobra por m³. Aplico conversión: "
                    "50 m² × 0.10 m = 5 m³. Sumo sub-totales: 60 + 140 + 40 = 240 €."
                ),
                calculated_unit_price=240.0,
                breakdown=[
                    BreakdownComponentSchema(
                        code="MT-LIMP-01",
                        concept="Limpieza y preparación de superficie (50 m²)",
                        type="LABOR",
                        price=1.2,
                        total=60.0,
                    ),
                    BreakdownComponentSchema(
                        code="MT-GRAV-4060",
                        concept=(
                            "Grava 40-60 mm, extendido 10 cm sobre explanada "
                            "(5 m³ tras conversión desde 50 m²)"
                        ),
                        type="MATERIAL",
                        price=28.0,
                        total=140.0,
                    ),
                    BreakdownComponentSchema(
                        code="MT-COMP-01",
                        concept="Compactado mecánico de grava (50 m²)",
                        type="MACHINERY",
                        price=0.8,
                        total=40.0,
                    ),
                ],
                selected_candidate=None,  # 1:N → no hay un "ganador" plano
                needs_human_review=False,
                match_kind="1:N",
                unit_conversion_applied=UnitConversionRecord(
                    value=50.0,
                    from_unit="m2",
                    to_unit="m3",
                    bridge={"thickness_m": 0.10},
                    result=5.0,
                ),
            )
            return (
                BatchPricingEvaluatorResultV3(
                    results=[BatchPricedItemV3(item_code="1.1", valuation=valuation)]
                ),
                usage,
            )

        raise AssertionError(f"Schema inesperado en el Judge mock: {name}")

    async def get_embedding(self, text: str) -> List[float]:
        return [0.0] * 768


class _CanonicalVectorSearch(IVectorSearch):
    """Mock del vector_search: devuelve candidatos plausibles para cada query."""

    def search_similar_items(
        self,
        query_vector: List[float],
        query_text: str,
        limit: int = 4,
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        q = query_text.lower()
        if "grava" in q:
            return [
                {
                    "id": "MT-GRAV-4060",
                    "code": "MT-GRAV-4060",
                    "description": "Grava silícea 40-60 mm, suministrada y extendida",
                    "priceTotal": 28.0,
                    "unit": "m3",
                    "kind": "item",
                    "matchScore": 0.94,
                }
            ]
        if "compact" in q:
            return [
                {
                    "id": "MT-COMP-01",
                    "code": "MT-COMP-01",
                    "description": "Compactado mecánico con bandeja vibrante",
                    "priceTotal": 0.8,
                    "unit": "m2",
                    "kind": "breakdown",
                    "matchScore": 0.88,
                }
            ]
        return [
            {
                "id": "MT-LIMP-01",
                "code": "MT-LIMP-01",
                "description": "Limpieza y retirada de tierra vegetal",
                "priceTotal": 1.2,
                "unit": "m2",
                "kind": "breakdown",
                "matchScore": 0.85,
            }
        ]


# -------- Test canónico -------------------------------------------------------


def test_acondicionamiento_solar_camiones_1_to_n_with_unit_conversion(monkeypatch):
    """Caso canónico end-to-end: 1:N + jerga Ud + conversión m²→m³.

    Este test era la "estrella del norte" del Sprint. Pasa verde cuando el
    Swarm v005 acepta `catalog_lookup`, el Judge emite `match_kind` +
    `unit_conversion_applied`, y el boundary (Fase 5.E) los persiste al
    `BudgetPartida` final.
    """
    # Evitamos I/O: `_load_prompt` devuelve el batch_items como user_prompt
    # para que el mock del Judge detecte el code de la partida del chunk.
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    # Catalog lookup real con repo in-memory (vacío — no necesitamos tarifas
    # para este test porque el Judge mockeado devuelve precios hardcoded; lo
    # que sí validamos es que el boundary del Swarm acepta catalog_lookup).
    catalog = CatalogLookupService(repo=InMemoryCatalogRepository())

    # El extractor INLINE (5.B) ya habría rellenado `unit_normalized`,
    # `unit_dimension` y `unit_conversion_hints`. Los inyectamos directos
    # porque aquí testeamos la etapa del Swarm, no la del extractor.
    partida_input = RestructuredItem(
        code="1.1",
        description=(
            "Acondicionamiento de la entrada del solar para camiones.\n"
            "Incluye:\n"
            "- Limpiar superficie\n"
            "- Meter 10cm de grava, 40-60mm, 50m2\n"
            "- Compactar grava"
        ),
        quantity=1.0,
        unit="Ud",
        unit_normalized="ud",
        unit_dimension="discreto",
        chapter="MOVIMIENTO DE TIERRAS",
        unit_conversion_hints={"thickness_m": 0.10},
    )

    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_CanonicalJudgeLLM(),
        vector_search=_CanonicalVectorSearch(),
        emitter=emitter,
        catalog_lookup=catalog,
    )

    metrics: Dict[str, float] = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(
        svc.evaluate_batch([partida_input], budget_id="canonical-acond", metrics=metrics)
    )

    # --- 1. El Swarm resolvió exactamente 1 partida sin abortar ---
    assert len(priced) == 1, "el pipeline no debe perder la partida canónica"
    partida = priced[0]
    assert partida.code == "1.1"

    # --- 2. `match_kind` llegó al BudgetPartida final (Fase 5.E) ---
    assert partida.match_kind == "1:N", (
        "la partida combina 3 sub-actividades; el Judge debe marcar 1:N"
    )

    # --- 3. Conversión m²→m³ auditable en el campo plano ---
    conv = partida.unit_conversion_applied
    assert conv is not None, "el Judge aplicó conversión de unidad; debe persistirse"
    assert isinstance(conv, dict), "serializable como dict plano para Firestore/UI"
    assert conv["from_unit"] == "m2"
    assert conv["to_unit"] == "m3"
    assert conv["bridge"] == {"thickness_m": 0.10}
    assert conv["result"] == pytest.approx(5.0)

    # --- 4. El breakdown 1:N contiene los 3 ingredientes ---
    assert partida.breakdown is not None, "1:N debe tener breakdown no-nulo"
    assert len(partida.breakdown) == 3
    concepts = [b.concept.lower() for b in partida.breakdown]
    assert any("limp" in c for c in concepts), "falta la sub-partida de limpieza"
    assert any("grava" in c for c in concepts), "falta la sub-partida de grava"
    assert any("compact" in c for c in concepts), "falta la sub-partida de compactado"

    # --- 5. El precio total es plausible y no necesita revisión humana ---
    assert partida.totalPrice > 0
    assert partida.ai_resolution is not None
    assert partida.ai_resolution.needs_human_review is False

    # --- 6. Verificador de puerta: los helpers atómicos siguen respondiendo ---
    # (Si rompes esto, se rompe la base del canónico — se duplica el check del
    # test de abajo para dejar la garantía end-to-end visible en una sola suite.)
    result_conv = catalog.convert_measurement(
        value=50.0, from_unit="m2", to_unit="m3", bridge={"thickness_m": 0.10}
    )
    assert result_conv is not None
    assert result_conv.value == pytest.approx(5.0)


def test_canonical_case_components_are_ready_at_this_sprint_phase():
    """Verificador de puerta: los bloques que Fase 1 DEBE entregar ya funcionan.

    Si este test falla, algo de Fase 1-1.5 se rompió. Es una puerta para
    garantizar que la "infraestructura atómica" del caso canónico está lista.
    """
    svc = CatalogLookupService(repo=InMemoryCatalogRepository())
    result = svc.convert_measurement(
        value=50.0,
        from_unit="m2",
        to_unit="m3",
        bridge={"thickness_m": 0.10},
    )
    assert result is not None
    assert result.unit == "m3"
    assert result.value == pytest.approx(5.0)

    from src.budget.catalog.domain.unit import Unit

    assert Unit.normalize("Ud") == "ud"
    assert Unit.dimension_of("Ud") == "discreto"
    assert Unit.same_dimension("ud", "m2") is False

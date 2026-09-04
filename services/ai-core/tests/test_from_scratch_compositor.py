"""Tests del `FromScratchCompositor`.

El LLM SOLO descompone (mock devuelve un CompositionPlan); la valoración es
determinista contra tablas mockeadas (labor_rates + material_catalog). Verifica
que el precio unitario y el breakdown se arman con precios reales, el %aux se
aplica sobre los directos, y los recursos no encontrados marcan review.
"""
from __future__ import annotations

import pytest

from src.budget.application.services.from_scratch_compositor import (
    CompositionPlan,
    FromScratchCompositor,
    LaborNeed,
    MaterialNeed,
    MachineryNeed,
)
from src.budget.catalog.domain.entities import LaborRate, MachineryRate


class _FakeLLM:
    def __init__(self, plan: CompositionPlan):
        self._plan = plan

    async def generate_structured(self, **kwargs):
        return self._plan, {"totalTokenCount": 10}


class _FakeCatalog:
    def __init__(self, rates: dict, machinery: dict | None = None):
        self._rates = rates  # query.lower() -> LaborRate | None
        self._machinery = machinery or {}  # query.lower() -> MachineryRate | None

    async def get_labor_rate(self, query: str, trade=None):
        return self._rates.get(query.lower())

    async def get_machinery_rate(self, query: str, category=None):
        return self._machinery.get(query.lower())


class _FakeMaterials:
    def __init__(self, by_kw: dict):
        self._by_kw = by_kw  # substring -> candidate dict

    def search_materials(self, query_vector, query_text="", limit=5, category_filter=None):
        for kw, cand in self._by_kw.items():
            if kw in (query_text or "").lower():
                return [cand]
        return []


async def _embed(_text: str):
    return [0.0] * 768


def _rate(cat, label, eur):
    return LaborRate(id=f"labor-{cat}", category=cat, label_es=label,
                     rate_eur_hour=eur, source_book="COAATMCA_2025", source_page=10)


def _mrate(id, label, eur=None, is_placeholder=False):
    return MachineryRate(id=id, category="excavacion", label_es=label,
                         rate_eur_hour=eur, is_placeholder=is_placeholder)


@pytest.mark.asyncio
async def test_composes_labor_material_and_aux():
    plan = CompositionPlan(
        main_task="Acondicionar acceso",
        labor=[LaborNeed(role="Peón", hours=0.5)],
        materials=[MaterialNeed(query="grava caliza", quantity=0.1, unit="m3")],
        aux_pct=2.0,
    )
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan),
        embed_fn=_embed,
        catalog_lookup=_FakeCatalog({"peón": _rate("peon_ordinario", "Peón Suelto", 23.01)}),
        material_search=_FakeMaterials({"grava": {"sku": "S1", "name": "Grava caliza", "price": 42.0, "unit": "m3", "_cosine": 0.8}}),
    )
    res = await comp.compose(description="Acceso", unit="ud")

    # labor 23.01*0.5=11.505 ; material 42*0.1=4.2 ; directos≈15.705 ; aux 2%≈0.314
    assert res.unit_price == pytest.approx(16.02, abs=0.02)
    assert len(res.breakdown) == 3  # labor + material + aux
    assert res.needs_human_review is False
    aux = res.breakdown[-1]
    assert aux["type"] == "OTHER" and aux["unit"] == "%" and aux["quantity"] == 2.0
    assert aux["total"] == pytest.approx(0.31, abs=0.02)


@pytest.mark.asyncio
async def test_missing_labor_and_material_mark_review():
    plan = CompositionPlan(
        main_task="X",
        labor=[LaborNeed(role="Buzo profesional", hours=1.0)],   # no existe
        materials=[MaterialNeed(query="material rarísimo", quantity=1.0)],  # no existe
        aux_pct=0.0,
    )
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed,
        catalog_lookup=_FakeCatalog({}),  # nada matchea
        material_search=_FakeMaterials({}),
    )
    res = await comp.compose(description="X", unit="ud")
    assert res.needs_human_review is True
    assert res.unit_price == 0.0
    assert len(res.notes) == 2  # labor + material sin precio


@pytest.mark.asyncio
async def test_machinery_valued_from_rental_rate():
    # Maquinaria se valora con la tarifa de ALQUILER (€/h) × horas, determinista
    # contra machinery_rates — NO con el precio de compra del material_catalog.
    # (Se añade algo de mano de obra para que la máquina no sea el 100% del
    # directo y no dispare el safety-net de dominancia #1, ajeno a este caso.)
    plan = CompositionPlan(
        main_task="Excavar",
        labor=[LaborNeed(role="Peón", hours=1.0)],
        machinery=[MachineryNeed(query="retroexcavadora", hours=2.0)],
        aux_pct=0.0,
    )
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed,
        catalog_lookup=_FakeCatalog(
            {"peón": _rate("peon_ordinario", "Peón Suelto", 23.01)},
            machinery={"retroexcavadora": _mrate("mq-retro", "Retroexcavadora", eur=45.0)},
        ),
        # Aunque el material_catalog tuviera un match de COMPRA carísimo, NO debe usarse.
        material_search=_FakeMaterials({"retro": {"sku": "M1", "name": "Retroexcavadora COMPRA", "price": 55000.0, "unit": "ud", "_cosine": 0.9}}),
    )
    res = await comp.compose(description="Excavar", unit="m3")
    # labor 23.01 + maquinaria 45 €/h * 2h = 90 → directo 113.01
    assert res.unit_price == pytest.approx(113.01, abs=0.01)
    assert res.needs_human_review is False
    mach = next(r for r in res.breakdown if r["type"] == "MACHINERY")
    assert mach["price"] == pytest.approx(45.0, abs=0.01)  # €/h de alquiler
    assert mach["total"] == pytest.approx(90.0, abs=0.01)  # 45 * 2h
    assert mach["concept"] == "Retroexcavadora"
    assert mach["code"] == "mq-retro"


@pytest.mark.asyncio
async def test_machinery_without_rate_flags_review_never_purchase_price():
    # Sin tarifa de alquiler: aunque el material_catalog matchee un precio de
    # COMPRA, el compositor NO lo usa — marca review y deja precio 0.
    plan = CompositionPlan(
        main_task="Excavar",
        machinery=[MachineryNeed(query="retroexcavadora", hours=2.0)],
        aux_pct=0.0,
    )
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed,
        catalog_lookup=_FakeCatalog({}, machinery={}),  # sin tarifa de alquiler
        material_search=_FakeMaterials({"retro": {"sku": "M1", "name": "Retroexcavadora", "price": 55.0, "unit": "h", "_cosine": 0.9}}),
    )
    res = await comp.compose(description="Excavar", unit="m3")
    assert res.needs_human_review is True
    assert res.unit_price == 0.0  # NO se usa el precio de compra (55*2=110)
    assert res.breakdown[0]["type"] == "MACHINERY"
    assert res.breakdown[0]["total"] == 0.0
    assert any("precio de compra" in n for n in res.notes)


@pytest.mark.asyncio
async def test_machinery_placeholder_rate_flags_review():
    # Tarifa placeholder (rate=None, is_placeholder=True) → review, precio 0.
    plan = CompositionPlan(
        main_task="Excavar",
        machinery=[MachineryNeed(query="retroexcavadora", hours=2.0)],
        aux_pct=0.0,
    )
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed,
        catalog_lookup=_FakeCatalog(
            {},
            machinery={"retroexcavadora": _mrate("mq-retro", "Retroexcavadora", eur=None, is_placeholder=True)},
        ),
        material_search=_FakeMaterials({}),
    )
    res = await comp.compose(description="Excavar", unit="m3")
    assert res.needs_human_review is True
    assert res.breakdown[0]["total"] == 0.0
    assert any("placeholder" in n.lower() for n in res.notes)


@pytest.mark.asyncio
async def test_low_cosine_material_is_gated_and_marks_review():
    # #2 — el mejor material tiene coseno 0.4 (< 0.6) → NO se usa (evita el
    # material equivocado), price 0 y needs_review.
    plan = CompositionPlan(main_task="X", materials=[MaterialNeed(query="equipo raro", quantity=1.0)], aux_pct=0.0)
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed, catalog_lookup=_FakeCatalog({}),
        material_search=_FakeMaterials({"equipo": {"sku": "W", "name": "Match equivocado", "price": 79.0, "_cosine": 0.4}}),
    )
    res = await comp.compose(description="X", unit="ud")
    assert res.needs_human_review is True
    assert res.breakdown[0]["total"] == 0.0          # no se valoró con el material malo
    assert any("coseno 0.40" in n for n in res.notes)


@pytest.mark.asyncio
async def test_hallucinated_quantity_flags_review():
    # #1 — cantidad enorme (350) → flag de review aunque el material matchee bien.
    plan = CompositionPlan(main_task="X", materials=[MaterialNeed(query="cable", quantity=350.0)], aux_pct=0.0)
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed, catalog_lookup=_FakeCatalog({}),
        material_search=_FakeMaterials({"cable": {"sku": "C", "name": "Cable", "price": 9.6, "_cosine": 0.8}}),
    )
    res = await comp.compose(description="X", unit="ud")
    assert res.needs_human_review is True
    assert any("Revisar cantidad" in n for n in res.notes)


# ---- P1: guard de plausibilidad de precio unitario ----------------------
_PRICE_WARN_PREFIX = "⚠️ Precio compuesto atípico"


@pytest.mark.asyncio
async def test_atypical_unit_price_flags_and_keeps_price():
    # Caso real: impermeabilización a ~535 €/m² (techo area = 400). Se añade
    # mano de obra para que el material NO domine el directo (>85%) y así el
    # aviso venga del guard de PRECIO (P1), no del safety-net de cantidad (#1).
    plan = CompositionPlan(
        main_task="Impermeabilización de suelo de baño",
        labor=[LaborNeed(role="Oficial 1ª", hours=5.0)],       # 5*23.01 = 115.05
        materials=[MaterialNeed(query="lámina impermeabilizante", quantity=1.2, unit="m2")],
        aux_pct=0.0,
    )
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed,
        catalog_lookup=_FakeCatalog({"oficial 1ª": _rate("oficial_1a", "Oficial 1ª", 23.01)}),
        material_search=_FakeMaterials({"lámina": {"sku": "IMP", "name": "Lámina EPDM", "price": 350.0, "unit": "m2", "_cosine": 0.8}}),
    )
    res = await comp.compose(description="Impermeabilización", unit="m²")
    # material 350*1.2=420 ; labor 115.05 ; directo=535.05. share material=78.5% (<85% → sin #1).
    assert res.unit_price == pytest.approx(535.05, abs=0.02)   # precio NO alterado (no hay cap)
    assert res.needs_human_review is True
    warn = [n for n in res.notes if n.startswith(_PRICE_WARN_PREFIX)]
    assert len(warn) == 1
    assert "535.05" in warn[0] and "m²" in warn[0]
    assert not any("Revisar cantidad" in n for n in res.notes)  # fue el guard de precio, no #1


@pytest.mark.asyncio
async def test_normal_unit_price_not_flagged():
    # ~78 €/m² es un precio normalísimo por m² → el guard NO debe marcarlo.
    plan = CompositionPlan(
        main_task="Alicatado",
        labor=[LaborNeed(role="Oficial 1ª", hours=1.0)],       # 23.01
        materials=[MaterialNeed(query="azulejo", quantity=1.1, unit="m2")],  # 50*1.1=55
        aux_pct=0.0,
    )
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed,
        catalog_lookup=_FakeCatalog({"oficial 1ª": _rate("oficial_1a", "Oficial 1ª", 23.01)}),
        material_search=_FakeMaterials({"azulejo": {"sku": "AZ", "name": "Azulejo", "price": 50.0, "unit": "m2", "_cosine": 0.85}}),
    )
    res = await comp.compose(description="Alicatado", unit="m²")
    assert res.unit_price == pytest.approx(78.01, abs=0.02)
    assert res.needs_human_review is False
    assert not any(n.startswith(_PRICE_WARN_PREFIX) for n in res.notes)


@pytest.mark.asyncio
async def test_equipment_supply_high_price_is_exempt():
    # Suministro de equipo: un material caro (la bomba que se compra entera)
    # domina el precio por DISEÑO → NO debe disparar el guard de precio (P1),
    # aunque sea miles de €/ud. (El review por otras vías queda intacto.)
    plan = CompositionPlan(
        main_task="Suministro de bomba de calor",
        is_equipment_supply=True,
        labor=[LaborNeed(role="Oficial 1ª", hours=4.0)],
        materials=[MaterialNeed(query="bomba de calor", quantity=1.0, unit="ud")],
        aux_pct=0.0,
    )
    comp = FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed,
        catalog_lookup=_FakeCatalog({"oficial 1ª": _rate("oficial_1a", "Oficial 1ª", 23.01)}),
        material_search=_FakeMaterials({"bomba": {"sku": "BC", "name": "Bomba de calor 12kW", "price": 3500.0, "unit": "ud", "_cosine": 0.9}}),
    )
    res = await comp.compose(description="Suministro de bomba", unit="ud")
    assert res.unit_price == pytest.approx(3592.04, abs=0.02)
    assert not any(n.startswith(_PRICE_WARN_PREFIX) for n in res.notes)


from src.budget.application.services.from_scratch_compositor import _material_fidelity_conflict


def test_material_fidelity_haya_vs_sapelly_conflicto():
    # haya (madera) vs sapelly (madera, otra especie) -> conflicto
    assert _material_fidelity_conflict("puerta de madera de haya", "PUERTA BLINDADA SAPELLY/BLANCA") is True


def test_material_fidelity_pizarra_sin_piedra_conflicto():
    assert _material_fidelity_conflict("revestimiento de piedra de pizarra", "MORTERO ADHESIVO PARA BLOQUE") is True


def test_material_fidelity_granito_vs_piedra_generica_ok():
    # granito (piedra) vs candidato con el genérico "piedra" -> aceptable
    assert _material_fidelity_conflict("encimera de granito negro", "ENCIMERA PIEDRA 80cm Negro") is False


def test_material_fidelity_especie_exacta_ok():
    assert _material_fidelity_conflict("tarima de roble macizo", "Tarima flotante de roble natural") is False


def test_material_fidelity_haya_vs_madera_generica_ok():
    assert _material_fidelity_conflict("puerta de madera de haya", "Puerta de paso de madera maciza") is False


def test_material_fidelity_sin_familia_conocida_no_interviene():
    # resina no está en las familias madera/piedra -> no opina (False)
    assert _material_fidelity_conflict("plato de ducha de resina", "Plato de ducha acrílico") is False

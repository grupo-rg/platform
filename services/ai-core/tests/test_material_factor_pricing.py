"""Wiring del ajuste de precio de material por % en el `FromScratchCompositor`.

Verifica el CABLEADO de la Fase 1 (capa NO destructiva): cuando se le pasan
reglas activas, el compositor resuelve el factor por material ("más específico
gana": budget>client>material>category>global) y lo aplica al precio del
catálogo — UNA sola vez, en el punto que materializa ese precio en el breakdown.

Cubre:
  - con una regla de category +10% → material sale a precio_base × 1.10;
  - sin reglas (o lista vacía) → precio IDÉNTICO al de hoy (no-op);
  - "más específico gana" en la composición (material > category, budget > all);
  - el precio BASE del candidato del catálogo NO se muta (regla no destructiva);
  - el reader se consume vía `list_active()` (fake, sin Firestore).

El reader se mockea con `_FakeRulesReader.list_active()` — el orquestador carga
esa lista UNA vez por batch y la pasa a `compose(material_price_rules=...)`, que
es exactamente lo que estos tests ejercen.
"""
from __future__ import annotations

import pytest

from src.budget.application.services.from_scratch_compositor import (
    CompositionPlan,
    FromScratchCompositor,
    LaborNeed,
    MaterialNeed,
)
from src.budget.catalog.domain.entities import LaborRate
from src.budget.catalog.domain.material_price_rule import (
    MaterialPriceRule,
    MaterialPriceRuleTarget,
)


# --------------------------------------------------------------------------
# Fakes (sin Firestore ni LLM real)
# --------------------------------------------------------------------------
class _FakeLLM:
    def __init__(self, plan: CompositionPlan):
        self._plan = plan

    async def generate_structured(self, **kwargs):
        return self._plan, {"totalTokenCount": 10}


class _FakeCatalog:
    def __init__(self, rates: dict):
        self._rates = rates  # query.lower() -> LaborRate | None

    async def get_labor_rate(self, query: str, trade=None):
        return self._rates.get(query.lower())

    async def get_machinery_rate(self, query: str, category=None):
        return None


class _FakeMaterials:
    def __init__(self, by_kw: dict):
        self._by_kw = by_kw  # substring -> candidate dict

    def search_materials(self, query_vector, query_text="", limit=5, category_filter=None):
        for kw, cand in self._by_kw.items():
            if kw in (query_text or "").lower():
                return [cand]
        return []


class _FakeRulesReader:
    """Mock del `FirestoreMaterialPriceRulesReader`: `list_active()` sin Firestore.

    El orquestador llama `list_active()` UNA vez por batch; el test replica ese
    consumo y pasa el resultado a `compose(material_price_rules=...)`.
    """

    def __init__(self, rules):
        self._rules = list(rules)
        self.calls = 0

    def list_active(self):
        self.calls += 1
        return list(self._rules)


async def _embed(_text: str):
    return [0.0] * 768


def _rate(cat, label, eur):
    return LaborRate(id=f"labor-{cat}", category=cat, label_es=label,
                     rate_eur_hour=eur, source_book="COAATMCA_2025", source_page=10)


def _rule(id, scope, adjustment_pct, *, active=True,
          category=None, sku=None, lead_id=None, budget_id=None):
    return MaterialPriceRule(
        id=id, scope=scope,
        target=MaterialPriceRuleTarget(
            category=category, sku=sku, leadId=lead_id, budgetId=budget_id
        ),
        adjustmentPct=adjustment_pct, active=active,
        createdBy="tester", createdAt="2026-01-01T00:00:00Z",
        updatedBy="tester", updatedAt="2026-01-01T00:00:00Z",
    )


# Candidato de material del catálogo. `sku` + `category` alimentan la resolución
# de la regla; `price` es el precio BASE (nunca se muta). Con Oficial 1ª (1 h)
# el material NO domina el directo (>85%), así el safety-net de dominancia (#1)
# no interfiere en las aserciones de precio.
def _azulejo_candidate():
    return {
        "sku": "AZ",
        "name": "Azulejo cerámico",
        "price": 50.0,
        "unit": "m2",
        "category": "Materiales de construcción > Cerámica",
        "_cosine": 0.85,
    }


def _compositor(plan: CompositionPlan, candidate: dict) -> FromScratchCompositor:
    return FromScratchCompositor(
        llm=_FakeLLM(plan), embed_fn=_embed,
        catalog_lookup=_FakeCatalog({"oficial 1ª": _rate("oficial_1a", "Oficial 1ª", 23.01)}),
        material_search=_FakeMaterials({"azulejo": candidate}),
    )


def _base_plan() -> CompositionPlan:
    return CompositionPlan(
        main_task="Alicatado",
        labor=[LaborNeed(role="Oficial 1ª", hours=1.0)],  # 23.01
        materials=[MaterialNeed(query="azulejo", quantity=1.0, unit="m2")],
        aux_pct=0.0,
    )


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_category_rule_applies_10pct_to_material():
    cand = _azulejo_candidate()
    comp = _compositor(_base_plan(), cand)
    reader = _FakeRulesReader([_rule("r_cat", "category", 10.0,
                                     category="Materiales de construcción")])

    res = await comp.compose(
        description="Alicatado", unit="m²",
        material_price_rules=reader.list_active(),
    )

    mat = next(r for r in res.breakdown if r["type"] == "MATERIAL")
    # 50 € base × 1.10 = 55 €
    assert mat["price"] == pytest.approx(55.0, abs=1e-6)
    assert mat["total"] == pytest.approx(55.0, abs=1e-6)  # quantity 1.0
    # unit_price = material 55 + labor 23.01 = 78.01
    assert res.unit_price == pytest.approx(78.01, abs=0.01)
    assert res.needs_human_review is False  # material 70.5% del directo (<85%)
    assert any(n.startswith("Ajuste de precio de material") for n in res.notes)
    # NO destructivo: el precio BASE del candidato del catálogo no se muta.
    assert cand["price"] == 50.0
    assert reader.calls == 1


@pytest.mark.asyncio
async def test_no_rules_keeps_base_price_identical_to_today():
    cand = _azulejo_candidate()
    comp = _compositor(_base_plan(), cand)

    res = await comp.compose(description="Alicatado", unit="m²")  # sin reglas

    mat = next(r for r in res.breakdown if r["type"] == "MATERIAL")
    assert mat["price"] == pytest.approx(50.0, abs=1e-6)  # base intacto
    assert mat["total"] == pytest.approx(50.0, abs=1e-6)
    assert res.unit_price == pytest.approx(73.01, abs=0.01)  # 50 + 23.01
    assert not any(n.startswith("Ajuste de precio de material") for n in res.notes)


@pytest.mark.asyncio
async def test_empty_rules_list_is_noop():
    cand = _azulejo_candidate()
    comp = _compositor(_base_plan(), cand)
    reader = _FakeRulesReader([])  # sin reglas activas

    res = await comp.compose(
        description="Alicatado", unit="m²",
        material_price_rules=reader.list_active(),
    )

    mat = next(r for r in res.breakdown if r["type"] == "MATERIAL")
    assert mat["price"] == pytest.approx(50.0, abs=1e-6)
    assert not any(n.startswith("Ajuste de precio de material") for n in res.notes)


@pytest.mark.asyncio
async def test_material_scope_beats_category_in_composition():
    cand = _azulejo_candidate()
    comp = _compositor(_base_plan(), cand)
    # category +10% (casa) Y material sku "AZ" +20% (más específico → gana).
    reader = _FakeRulesReader([
        _rule("r_cat", "category", 10.0, category="Materiales de construcción"),
        _rule("r_mat", "material", 20.0, sku="AZ"),
    ])

    res = await comp.compose(
        description="Alicatado", unit="m²",
        material_price_rules=reader.list_active(),
    )

    mat = next(r for r in res.breakdown if r["type"] == "MATERIAL")
    assert mat["price"] == pytest.approx(60.0, abs=1e-6)  # 50 × 1.20, no × 1.10
    assert any("r_mat" in n for n in res.notes)


@pytest.mark.asyncio
async def test_budget_scope_beats_all_when_budget_id_matches():
    cand = _azulejo_candidate()
    comp = _compositor(_base_plan(), cand)
    reader = _FakeRulesReader([
        _rule("r_glob", "global", 5.0),
        _rule("r_cat", "category", 10.0, category="Materiales de construcción"),
        _rule("r_mat", "material", 20.0, sku="AZ"),
        _rule("r_bud", "budget", 3.0, budget_id="B1"),
    ])

    res = await comp.compose(
        description="Alicatado", unit="m²",
        material_price_rules=reader.list_active(),
        budget_id="B1",
    )

    mat = next(r for r in res.breakdown if r["type"] == "MATERIAL")
    assert mat["price"] == pytest.approx(51.5, abs=1e-6)  # 50 × 1.03 (budget gana)
    assert any("r_bud" in n for n in res.notes)


@pytest.mark.asyncio
async def test_client_scope_applies_when_lead_id_matches():
    cand = _azulejo_candidate()
    comp = _compositor(_base_plan(), cand)
    reader = _FakeRulesReader([
        _rule("r_glob", "global", 5.0),
        _rule("r_cli", "client", 8.0, lead_id="L1"),
    ])

    res = await comp.compose(
        description="Alicatado", unit="m²",
        material_price_rules=reader.list_active(),
        lead_id="L1",
    )

    mat = next(r for r in res.breakdown if r["type"] == "MATERIAL")
    assert mat["price"] == pytest.approx(54.0, abs=1e-6)  # 50 × 1.08 (client gana a global)


@pytest.mark.asyncio
async def test_global_fallback_when_no_specific_scope_matches():
    cand = _azulejo_candidate()
    comp = _compositor(_base_plan(), cand)
    # Solo global +5%: sin sku/category/lead/budget que casen otra cosa.
    reader = _FakeRulesReader([_rule("r_glob", "global", 5.0)])

    res = await comp.compose(
        description="Alicatado", unit="m²",
        material_price_rules=reader.list_active(),
        budget_id="OTHER", lead_id="OTHER",
    )

    mat = next(r for r in res.breakdown if r["type"] == "MATERIAL")
    assert mat["price"] == pytest.approx(52.5, abs=1e-6)  # 50 × 1.05

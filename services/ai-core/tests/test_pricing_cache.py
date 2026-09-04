"""S1-A-04 — Caché de pricing por hash en Firestore.

La misma partida (descripción + unidad normalizadas) aparece en N PDFs:
solera de hormigón HM-20 e=15cm m² puede salir en 50 presupuestos al mes.
Sin caché, cada PDF la re-tasa con Gemini ($0.01-0.10 cada vez).

Esquema (`partida_pricing_cache/{hash}`):
  hash = sha256(normalize(description) + "|" + normalize(unit))
  TTL  = 90 días
  Threshold de uso: confidence_score >= 0.85

Tests:
  1. ``compute_partida_hash`` es determinista, case-insensitive, robusto a
     whitespace y diacríticos básicos.
  2. ``PricingCache.lookup`` devuelve None cuando no hay hit.
  3. ``PricingCache.lookup`` devuelve el documento cuando hay hit confiable.
  4. ``PricingCache.lookup`` devuelve None cuando confidence < threshold.
  5. ``PricingCache.lookup`` devuelve None cuando expires_at pasó.
  6. ``PricingCache.persist`` guarda doc con TTL 90 días y hits_count=1.
  7. ``PricingCache.persist`` con hash existente incrementa hits_count y
     refresca last_used.
  8. ``PricingCache.persist`` no guarda si confidence_score es < threshold.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import pytest

from src.budget.application.services.pricing_cache import (
    PRICING_CACHE_COLLECTION,
    PRICING_CACHE_CONFIDENCE_THRESHOLD,
    PRICING_CACHE_TTL_DAYS,
    PricingCache,
    compute_partida_hash,
    normalize_for_hash,
)


# ---- Pure helpers ---------------------------------------------------------


def test_normalize_for_hash_lowercases_strips_whitespace():
    assert normalize_for_hash("  Solera   Hormigón   HM-20  ") == "solera hormigón hm-20"


def test_normalize_for_hash_collapses_internal_spaces():
    assert normalize_for_hash("a\t\nb\r c") == "a b c"


def test_normalize_for_hash_empty_returns_empty():
    assert normalize_for_hash("") == ""
    assert normalize_for_hash(None) == ""  # type: ignore[arg-type]


def test_compute_partida_hash_is_deterministic():
    h1 = compute_partida_hash("Solera de hormigón HM-20 fratasada", "m2")
    h2 = compute_partida_hash("Solera de hormigón HM-20 fratasada", "m2")
    assert h1 == h2
    assert len(h1) == 64  # sha256 hex


def test_compute_partida_hash_case_insensitive():
    h1 = compute_partida_hash("Solera HM-20", "m2")
    h2 = compute_partida_hash("SOLERA hm-20", "M2")
    assert h1 == h2


def test_compute_partida_hash_whitespace_insensitive():
    h1 = compute_partida_hash("Solera HM-20", "m2")
    h2 = compute_partida_hash("  Solera  HM-20  ", " m2 ")
    assert h1 == h2


def test_compute_partida_hash_differs_for_different_inputs():
    h1 = compute_partida_hash("Solera HM-20", "m2")
    h2 = compute_partida_hash("Solera HM-25", "m2")
    h3 = compute_partida_hash("Solera HM-20", "m3")
    assert h1 != h2
    assert h1 != h3


# ---- PricingCache with fake Firestore ------------------------------------


class _FakeDoc:
    """Mimic suficiente de un DocumentSnapshot."""

    def __init__(self, exists: bool, data: Optional[Dict[str, Any]]):
        self.exists = exists
        self._data = data

    def to_dict(self):
        return self._data


class _FakeDocRef:
    """El cliente firestore-admin es SÍNCRONO: `PricingCache` invoca
    `.get/.set/.update` vía `asyncio.to_thread(...)` (los envuelve en un hilo).
    Por eso el fake DEBE exponer métodos síncronos (no `async def`): si fueran
    coroutines, `to_thread` las ejecutaría sin await → "never awaited" y el
    "snapshot" sería la coroutine, no el `_FakeDoc`."""

    def __init__(self, store: Dict[str, Dict[str, Any]], doc_id: str):
        self._store = store
        self._doc_id = doc_id

    def get(self):
        data = self._store.get(self._doc_id)
        return _FakeDoc(data is not None, data)

    def set(self, data, merge=False):
        if merge and self._doc_id in self._store:
            self._store[self._doc_id].update(data)
        else:
            self._store[self._doc_id] = dict(data)

    def update(self, data):
        self._store[self._doc_id].update(data)


class _FakeCollection:
    def __init__(self, store: Dict[str, Dict[str, Any]]):
        self._store = store

    def document(self, doc_id: str):
        return _FakeDocRef(self._store, doc_id)


class _FakeDb:
    def __init__(self):
        self._store: Dict[str, Dict[str, Any]] = {}

    def collection(self, name: str):
        # Aceptamos múltiples colecciones pero solo guardamos una (la del cache).
        return _FakeCollection(self._store)


@pytest.fixture
def fake_db():
    return _FakeDb()


@pytest.mark.asyncio
async def test_lookup_miss_returns_none(fake_db):
    cache = PricingCache(db=fake_db)
    result = await cache.lookup(description="No existe", unit="m2")
    assert result is None


@pytest.mark.asyncio
async def test_persist_then_lookup_returns_payload(fake_db):
    cache = PricingCache(db=fake_db)
    description = "Solera hormigón HM-20"
    unit = "m2"
    partida_payload = {
        "code": "X.1",
        "description": description,
        "unit": unit,
        "unitPrice": 25.0,
        "match_kind": "1:1",
    }
    persisted = await cache.persist(
        description=description,
        unit=unit,
        partida=partida_payload,
        confidence_score=0.92,
        match_kind="1:1",
    )
    assert persisted is True

    hit = await cache.lookup(description=description, unit=unit)
    assert hit is not None
    assert hit.cache_hit is True
    assert hit.partida["code"] == "X.1"
    assert hit.confidence_score == pytest.approx(0.92)


@pytest.mark.asyncio
async def test_lookup_below_threshold_returns_none(fake_db):
    cache = PricingCache(db=fake_db)
    # Persistimos manualmente con confidence < threshold (saltándonos el guard
    # de persist) inyectando directamente en el store fake.
    fake_db._store["abcd1234"] = {
        "hash": "abcd1234",
        "normalized_description": "x",
        "normalized_unit": "m2",
        "resolved_partida": {"code": "X"},
        "match_kind": "1:1",
        "confidence_score": 0.50,  # bajo
        "hits_count": 1,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
    }
    # Lookup con el mismo hash debe rechazarlo por threshold.
    # Para forzar el hash, hacemos lookup con la misma descripción.
    # Pero el hash real será otro... La idea es testear con datos persistidos manualmente:
    h = compute_partida_hash("low conf partida", "m2")
    fake_db._store[h] = {
        "hash": h,
        "normalized_description": normalize_for_hash("low conf partida"),
        "normalized_unit": normalize_for_hash("m2"),
        "resolved_partida": {"code": "Y"},
        "match_kind": "1:1",
        "confidence_score": 0.50,
        "hits_count": 1,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
    }
    hit = await cache.lookup(description="low conf partida", unit="m2")
    assert hit is None


@pytest.mark.asyncio
async def test_lookup_expired_returns_none(fake_db):
    cache = PricingCache(db=fake_db)
    h = compute_partida_hash("expired partida", "m2")
    fake_db._store[h] = {
        "hash": h,
        "normalized_description": "expired partida",
        "normalized_unit": "m2",
        "resolved_partida": {"code": "Z"},
        "match_kind": "1:1",
        "confidence_score": 0.95,
        "hits_count": 1,
        "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
    }
    hit = await cache.lookup(description="expired partida", unit="m2")
    assert hit is None


@pytest.mark.asyncio
async def test_persist_refuses_low_confidence(fake_db):
    cache = PricingCache(db=fake_db)
    persisted = await cache.persist(
        description="low",
        unit="m2",
        partida={"code": "X"},
        confidence_score=0.5,
        match_kind="1:1",
    )
    assert persisted is False
    assert fake_db._store == {}


@pytest.mark.asyncio
async def test_persist_increments_hits_count_on_existing_hash(fake_db):
    cache = PricingCache(db=fake_db)
    description = "Pintura plástica"
    unit = "m2"
    await cache.persist(
        description=description, unit=unit,
        partida={"code": "A"},
        confidence_score=0.9,
        match_kind="1:1",
    )
    # Segunda persistencia: actualiza hits_count + last_used (no recrea).
    await cache.persist(
        description=description, unit=unit,
        partida={"code": "A"},
        confidence_score=0.9,
        match_kind="1:1",
    )
    h = compute_partida_hash(description, unit)
    assert fake_db._store[h]["hits_count"] == 2


@pytest.mark.asyncio
async def test_lookup_increments_hits_count_and_last_used(fake_db):
    """Cada hit incrementa hits_count y refresca last_used."""
    cache = PricingCache(db=fake_db)
    await cache.persist(
        description="solera", unit="m2",
        partida={"code": "X.1"}, confidence_score=0.91, match_kind="1:1",
    )
    h = compute_partida_hash("solera", "m2")
    assert fake_db._store[h]["hits_count"] == 1

    hit1 = await cache.lookup(description="solera", unit="m2")
    assert hit1 is not None
    assert fake_db._store[h]["hits_count"] == 2

    hit2 = await cache.lookup(description="solera", unit="m2")
    assert hit2 is not None
    assert fake_db._store[h]["hits_count"] == 3


@pytest.mark.asyncio
async def test_persist_records_ttl_90_days(fake_db):
    cache = PricingCache(db=fake_db)
    await cache.persist(
        description="x", unit="m2",
        partida={"code": "X"}, confidence_score=0.9, match_kind="1:1",
    )
    h = compute_partida_hash("x", "m2")
    expires_str = fake_db._store[h]["expires_at"]
    expires = datetime.fromisoformat(expires_str)
    now = datetime.now(timezone.utc)
    delta_days = (expires - now).days
    # 90 ± 1 day por timing fudge.
    assert PRICING_CACHE_TTL_DAYS - 1 <= delta_days <= PRICING_CACHE_TTL_DAYS + 1


def test_constants_have_expected_values():
    """Documentación viviente: si cambian, romper el test obliga a justificarlo."""
    assert PRICING_CACHE_COLLECTION == "partida_pricing_cache"
    assert PRICING_CACHE_TTL_DAYS == 90
    assert PRICING_CACHE_CONFIDENCE_THRESHOLD == 0.85


# ---- Integration: SwarmPricingService uses cache -------------------------


@pytest.mark.asyncio
async def test_swarm_short_circuits_on_cache_hit(monkeypatch, fake_db):
    """Si una partida tiene cache hit, NO se llama al LLM y se emite
    `pricing_cache_hit` + `item_resolved` con cache_hit=true."""
    from src.budget.application.ports.ports import (
        IGenerationEmitter,
        ILLMProvider,
        IVectorSearch,
    )
    from src.budget.application.services.pdf_extractor_service import RestructuredItem
    from src.budget.application.services.swarm_pricing_service import SwarmPricingService
    from src.budget.domain.entities import BudgetPartida, AIResolution, OriginalItem

    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", "u"),
    )

    # Pre-poblar caché con un BudgetPartida serializado.
    cached_partida = BudgetPartida(
        id="cached-1", order=1,
        original_item=OriginalItem(
            code="X.1", description="d", quantity=1.0, unit="m2",
            chapter="Sin Capítulo", raw_table_data="cached",
        ),
        ai_resolution=AIResolution(
            calculated_unit_price=42.0,
            calculated_total_price=42.0,
            confidence_score=92.0,
            is_estimated=False,
            needs_human_review=False,
            reasoning_trace="cached",
        ),
        code="X.1", description="d", unit="m2", quantity=1.0,
        unitPrice=42.0, totalPrice=42.0,
        matchConfidence=92.0,
        match_kind="1:1",
    )
    cache = PricingCache(db=fake_db)
    await cache.persist(
        description="d cached", unit="m2",
        partida=cached_partida.model_dump(),
        confidence_score=0.92, match_kind="1:1",
    )

    llm_called = []

    class _LLM(ILLMProvider):
        async def generate_structured(self, *a, **kw):
            llm_called.append(kw.get("model"))
            raise AssertionError("Cache hit should bypass LLM")

        async def get_embedding(self, text):
            raise AssertionError("Cache hit should bypass embedding")

    class _VS(IVectorSearch):
        def search_similar_items(self, *a, **kw):
            raise AssertionError("Cache hit should bypass vector search")

    class _SpyEmitter(IGenerationEmitter):
        def __init__(self):
            self.events = []
        def emit_event(self, b, t, d):
            self.events.append({"type": t, "data": d})

    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_LLM(),
        vector_search=_VS(),
        emitter=emitter,
        pricing_cache=cache,
    )
    items = [RestructuredItem(
        code="X.1", description="d cached", quantity=1.0, unit="m2",
        chapter="Sin Capítulo",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    result = await svc.evaluate_batch(items, budget_id="b-cache", metrics=metrics)

    # El item se devuelve desde caché (mismo code).
    assert len(result) == 1
    assert result[0].code == "X.1"
    # No se llamó al LLM ni al vector search.
    assert llm_called == []

    # Eventos relevantes.
    types = [e["type"] for e in emitter.events]
    assert "pricing_cache_hit" in types
    item_resolved = [e for e in emitter.events if e["type"] == "item_resolved"]
    assert item_resolved
    assert item_resolved[0]["data"]["pricing_metadata"]["cache_hit"] is True
    assert item_resolved[0]["data"]["pricing_metadata"]["cost_usd"] == 0.0


@pytest.mark.asyncio
async def test_swarm_persists_to_cache_after_llm_resolution(monkeypatch, fake_db):
    """Tras un resolver LLM exitoso con confidence >= threshold, la partida
    se persiste en cache para futuros lookups."""
    from src.budget.application.ports.ports import (
        IGenerationEmitter,
        ILLMProvider,
        IVectorSearch,
    )
    from src.budget.application.services.pdf_extractor_service import RestructuredItem
    from src.budget.application.services.swarm_pricing_service import (
        BatchPricedItemV3,
        BatchPricingEvaluatorResultV3,
        PricingFinalResultDB,
        SwarmPricingService,
    )

    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", "u"),
    )

    class _LLM(ILLMProvider):
        async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=False, queries=["q"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                return (
                    BatchPricingEvaluatorResultV3(results=[
                        BatchPricedItemV3(
                            item_code="P.1",
                            valuation=PricingFinalResultDB(
                                pensamiento_calculista="ok",
                                calculated_unit_price=50.0,
                                needs_human_review=False,
                                match_kind="1:1",
                            ),
                        ),
                    ]),
                    {},
                )
            raise AssertionError(name)

        async def get_embedding(self, text):
            return [0.0] * 768

    class _VS(IVectorSearch):
        def search_similar_items(self, *a, **kw):
            return [{
                "id": "C1", "code": "C1", "description": "x",
                "matchScore": 0.95, "unit": "m2", "priceTotal": 50.0,
            }]

    class _Emitter(IGenerationEmitter):
        def emit_event(self, b, t, d):
            pass

    cache = PricingCache(db=fake_db)
    svc = SwarmPricingService(
        llm_provider=_LLM(),
        vector_search=_VS(),
        emitter=_Emitter(),
        pricing_cache=cache,
    )
    items = [RestructuredItem(
        code="P.1", description="brand new partida", quantity=1.0, unit="m2",
        chapter="03 HORMIGONES",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    await svc.evaluate_batch(items, budget_id="b-persist", metrics=metrics)

    # La partida debió persistirse en cache.
    h = compute_partida_hash("brand new partida", "m2")
    assert h in fake_db._store
    assert fake_db._store[h]["resolved_partida"]["code"] == "P.1"


def test_hash_changes_with_pipeline_version():
    """Distinta versión de pipeline => distinto hash para la misma partida
    (invalidación por versión). Misma versión => mismo hash (estable)."""
    a = compute_partida_hash("Plato de ducha de resina", "ud", version="v1")
    b = compute_partida_hash("Plato de ducha de resina", "ud", version="v2")
    assert a != b
    a2 = compute_partida_hash("Plato de ducha de resina", "ud", version="v1")
    assert a == a2


def test_hash_uses_default_pipeline_version():
    from src.budget.application.services.pricing_cache import PRICING_PIPELINE_VERSION
    assert (
        compute_partida_hash("x", "ud")
        == compute_partida_hash("x", "ud", version=PRICING_PIPELINE_VERSION)
    )

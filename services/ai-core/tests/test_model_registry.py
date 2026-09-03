"""Unit tests for the configurable model registry reader (spec §08 Phase 0).

Covers: role lookup from a live doc, non-fatal fallback to the CODE DEFAULT
(missing doc / enabled=false / blank modelId / Firestore error), the ~60s TTL
cache (hot paths don't re-read Firestore), and the ``default_model_id`` override
that keeps each call site's own constant as the authoritative fallback.
"""
from __future__ import annotations

import pytest

from src.budget.infrastructure.config import model_registry as mr


# --- Fake synchronous Firestore admin client ---------------------------------
class _FakeSnap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class _FakeDoc:
    def __init__(self, db, role):
        self._db = db
        self._role = role

    def get(self):
        self._db.get_calls += 1
        if self._db.raise_on_get:
            raise RuntimeError("simulated firestore outage")
        return _FakeSnap(self._db.docs.get(self._role))


class _FakeCollection:
    def __init__(self, db, name):
        self._db = db
        self.name = name

    def document(self, role):
        return _FakeDoc(self._db, role)


class _FakeDb:
    def __init__(self, docs=None, raise_on_get=False):
        self.docs = docs or {}
        self.get_calls = 0
        self.raise_on_get = raise_on_get
        self.collections = []

    def collection(self, name):
        self.collections.append(name)
        return _FakeCollection(self, name)


@pytest.fixture(autouse=True)
def _clean_registry_state():
    """Reset cache + injected db before/after every test (module globals)."""
    mr.reset_cache()
    mr._set_db_for_testing(None)
    yield
    mr.reset_cache()
    mr._set_db_for_testing(None)


# --- Lookup from a live doc --------------------------------------------------
def test_get_model_reads_doc_when_present():
    db = _FakeDb(docs={
        "pricing_flash": {
            "modelId": "gemini-2.5-flash",
            "provider": "vertexai",
            "region": "europe-southwest1",
            "params": {"temperature": 0.2},
            "enabled": True,
        }
    })
    mr._set_db_for_testing(db)

    cfg = mr.get_model("pricing_flash")
    assert cfg.model_id == "gemini-2.5-flash"
    assert cfg.provider == "vertexai"
    assert cfg.region == "europe-southwest1"
    assert cfg.params == {"temperature": 0.2}
    assert cfg.enabled is True
    assert db.collections == [mr.MODEL_REGISTRY_COLLECTION]


def test_get_model_reads_overridden_id_from_doc():
    # A registry doc can point a role at a different id (this is the whole point
    # of the registry). Phase 0 seeds current ids, but the reader honours any.
    db = _FakeDb(docs={"pricing_pro": {"modelId": "gemini-2.5-pro-custom"}})
    mr._set_db_for_testing(db)
    assert mr.get_model("pricing_pro").model_id == "gemini-2.5-pro-custom"


def test_embedding_doc_params_preserved():
    db = _FakeDb(docs={
        "embedding": {
            "modelId": "gemini-embedding-001",
            "params": {"outputDimensionality": 768},
        }
    })
    mr._set_db_for_testing(db)
    cfg = mr.get_model("embedding")
    assert cfg.model_id == "gemini-embedding-001"
    assert cfg.params["outputDimensionality"] == 768


# --- Non-fatal fallbacks -----------------------------------------------------
def test_fallback_on_missing_doc_returns_code_default():
    db = _FakeDb(docs={})  # no docs at all
    mr._set_db_for_testing(db)

    assert mr.get_model("pricing_flash").model_id == "gemini-2.5-flash"
    assert mr.get_model("pricing_pro").model_id == "gemini-2.5-pro"
    assert mr.get_model("embedding").model_id == "gemini-embedding-001"
    # embedding code default carries the 768 dims marker.
    assert mr.get_model("embedding").params["outputDimensionality"] == 768


def test_fallback_when_disabled():
    db = _FakeDb(docs={
        "pricing_flash": {"modelId": "gemini-3.5-flash", "enabled": False},
    })
    mr._set_db_for_testing(db)
    # enabled=false → force the code default, NOT the doc's modelId.
    assert mr.get_model("pricing_flash").model_id == "gemini-2.5-flash"


def test_fallback_when_modelid_blank_or_missing():
    db = _FakeDb(docs={
        "pricing_flash": {"modelId": "   "},   # blank
        "pricing_pro": {"provider": "vertexai"},  # no modelId key
    })
    mr._set_db_for_testing(db)
    assert mr.get_model("pricing_flash").model_id == "gemini-2.5-flash"
    assert mr.get_model("pricing_pro").model_id == "gemini-2.5-pro"


def test_fallback_on_firestore_error():
    db = _FakeDb(raise_on_get=True)
    mr._set_db_for_testing(db)
    # Any Firestore error → code default, never raises.
    assert mr.get_model("pricing_flash").model_id == "gemini-2.5-flash"


def test_fallback_when_no_admin_client(monkeypatch):
    # No injected db and no Firebase app → _get_db() returns None → code default,
    # with zero network I/O.
    monkeypatch.setattr(mr, "_get_db", lambda: None)
    mr.reset_cache()
    assert mr.get_model("embedding").model_id == "gemini-embedding-001"


# --- default_model_id override (call-site constant stays authoritative) ------
def test_default_model_id_override_on_fallback():
    db = _FakeDb(docs={})  # missing doc → fallback path
    mr._set_db_for_testing(db)
    cfg = mr.get_model("pricing_flash", default_model_id="sentinel-flash")
    assert cfg.model_id == "sentinel-flash"
    # other default fields still come from the code default for the role.
    assert cfg.provider == "vertexai"


def test_default_model_id_ignored_when_doc_present():
    db = _FakeDb(docs={"pricing_flash": {"modelId": "gemini-2.5-flash"}})
    mr._set_db_for_testing(db)
    # A live doc wins over the call-site default.
    cfg = mr.get_model("pricing_flash", default_model_id="sentinel-flash")
    assert cfg.model_id == "gemini-2.5-flash"


# --- TTL cache ---------------------------------------------------------------
def test_cache_hits_do_not_reread_firestore():
    db = _FakeDb(docs={"pricing_flash": {"modelId": "gemini-2.5-flash"}})
    mr._set_db_for_testing(db)

    mr.get_model("pricing_flash")
    mr.get_model("pricing_flash")
    mr.get_model("pricing_flash")
    assert db.get_calls == 1  # only the first call touched Firestore


def test_cache_is_per_role():
    db = _FakeDb(docs={
        "pricing_flash": {"modelId": "gemini-2.5-flash"},
        "pricing_pro": {"modelId": "gemini-2.5-pro"},
    })
    mr._set_db_for_testing(db)
    mr.get_model("pricing_flash")
    mr.get_model("pricing_pro")
    assert db.get_calls == 2  # one read per distinct role


def test_cache_expires_after_ttl(monkeypatch):
    db = _FakeDb(docs={"pricing_flash": {"modelId": "gemini-2.5-flash"}})
    mr._set_db_for_testing(db)

    clock = {"t": 1000.0}
    monkeypatch.setattr(mr, "_now", lambda: clock["t"])

    mr.get_model("pricing_flash")
    assert db.get_calls == 1

    # Within TTL → still cached.
    clock["t"] += mr._CACHE_TTL_SECONDS - 1
    mr.get_model("pricing_flash")
    assert db.get_calls == 1

    # Past TTL → re-read.
    clock["t"] += 2
    mr.get_model("pricing_flash")
    assert db.get_calls == 2

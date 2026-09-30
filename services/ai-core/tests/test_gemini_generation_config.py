"""Config de generación por familia Gemini (2.5 vs 3.x) — migración Gemini 3.x."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from google.genai import types

from src.budget.infrastructure.adapters.ai import gemini_generation_config as g


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in (
        "GEMINI_FLASH_THINKING_LEVEL",
        "GEMINI_PRO_THINKING_LEVEL",
        "GEMINI3_TEMPERATURE",
        "GEMINI_GENERATION_LOCATION",
        "GOOGLE_CLOUD_LOCATION",
    ):
        monkeypatch.delenv(k, raising=False)


def _thinking(cfg):
    tc = cfg.thinking_config
    if tc is None:
        return None
    lvl = getattr(tc, "thinking_level", None)
    if lvl is not None:
        return getattr(lvl, "value", lvl).lower()
    return ("budget", tc.thinking_budget)


def test_family_detection():
    assert g.is_gemini3_family("gemini-3.5-flash")
    assert g.is_gemini3_family("vertexai/gemini-3.1-pro-preview")
    assert g.is_gemini3_family("models/gemini-3-flash-preview")
    assert not g.is_gemini3_family("gemini-2.5-flash")
    assert g.is_pro_model("gemini-3.1-pro-preview")
    assert not g.is_pro_model("gemini-3.5-flash")
    assert g.is_image_model("gemini-3.1-flash-image")


def test_legacy_25_config_is_unchanged():
    """Rollback: 2.5 conserva temperatura y NO lleva thinking_config."""
    cfg = g.build_generate_content_config(
        types, model="gemini-2.5-flash", temperature=0.0,
        response_mime_type="application/json", max_output_tokens=32768,
        system_instruction="sys",
    )
    assert cfg.temperature == 0.0
    assert cfg.thinking_config is None
    assert cfg.max_output_tokens == 32768
    assert cfg.response_mime_type == "application/json"
    assert cfg.system_instruction == "sys"


def test_gemini3_drops_temperature_and_sets_thinking_level():
    cfg = g.build_generate_content_config(types, model="gemini-3.5-flash", temperature=0.0)
    assert cfg.temperature is None  # rige el default 1.0 del servidor
    assert _thinking(cfg) in ("low", ("budget", 1024))


def test_max_output_tokens_gets_thinking_headroom_only_on_gemini3():
    """En 3.x max_output_tokens incluye el thinking → margen por nivel (cap 65536)."""
    c3 = g.build_generate_content_config(types, model="gemini-3.5-flash", temperature=0, max_output_tokens=10)
    assert c3.max_output_tokens == 10 + 2048
    cpro = g.build_generate_content_config(types, model="gemini-3.1-pro-preview", temperature=0, max_output_tokens=60000)
    assert cpro.max_output_tokens == 65536
    c25 = g.build_generate_content_config(types, model="gemini-2.5-flash", temperature=0, max_output_tokens=10)
    assert c25.max_output_tokens == 10


def test_pro_default_level_and_minimal_is_upgraded():
    cfg = g.build_generate_content_config(types, model="gemini-3.1-pro-preview", temperature=0.2)
    assert _thinking(cfg) in ("medium", ("budget", 8192))
    assert g.resolve_thinking_level("gemini-3.1-pro-preview", "minimal") == "low"
    assert g.resolve_thinking_level("gemini-3.5-flash", "minimal") == "minimal"


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("GEMINI_FLASH_THINKING_LEVEL", "minimal")
    monkeypatch.setenv("GEMINI_PRO_THINKING_LEVEL", "HIGH")
    monkeypatch.setenv("GEMINI3_TEMPERATURE", "0.7")
    assert g.resolve_thinking_level("gemini-3.5-flash") == "minimal"
    assert g.resolve_thinking_level("gemini-3.1-pro-preview") == "high"
    assert g.resolve_temperature("gemini-3.5-flash", 0.0) == 0.7
    monkeypatch.setenv("GEMINI_FLASH_THINKING_LEVEL", "turbo")  # inválido → default
    assert g.resolve_thinking_level("gemini-3.5-flash") == "low"


def test_explicit_level_wins_and_image_models_have_no_thinking():
    assert g.resolve_thinking_level("gemini-3.5-flash", "high") == "high"
    assert g.resolve_thinking_level("gemini-3.1-flash-image") is None
    assert g.resolve_thinking_level("gemini-2.5-flash", "high") is None


def test_old_sdk_without_thinking_level_falls_back_to_budget():
    captured = {}

    class _TC:
        model_fields = {"include_thoughts": None, "thinking_budget": None}

        def __init__(self, **kw):
            captured.update(kw)

    fake_types = SimpleNamespace(
        ThinkingConfig=_TC,
        GenerateContentConfig=lambda **kw: SimpleNamespace(**kw),
    )
    cfg = g.build_generate_content_config(fake_types, model="gemini-3.5-flash", temperature=0.0)
    assert captured == {"thinking_budget": 1024}
    assert not hasattr(cfg, "temperature")


def test_locations(monkeypatch):
    assert g.generation_location() == "global"
    assert g.embedding_location() == "europe-southwest1"
    monkeypatch.setenv("GEMINI_GENERATION_LOCATION", "us-central1")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "europe-west1")
    assert g.generation_location() == "us-central1"
    assert g.embedding_location() == "europe-west1"


def test_adapter_uses_separate_clients_for_generation_and_embeddings(monkeypatch):
    """Generación → global; embeddings → región UE (dos genai.Client)."""
    created = []

    class _FakeClient:
        def __init__(self, **kw):
            created.append(kw)

    import google.genai as genai_mod
    monkeypatch.setattr(genai_mod, "Client", _FakeClient)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "p")
    from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter

    a = GoogleGenerativeAIAdapter()
    assert [c["location"] for c in created] == ["global", "europe-southwest1"]
    assert a.genai_client is not a.embedding_client


def test_pro_models_get_longer_timeout(monkeypatch):
    import google.genai as genai_mod
    monkeypatch.setattr(genai_mod, "Client", lambda **kw: object())
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "p")
    monkeypatch.delenv("LLM_CALL_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("LLM_CALL_TIMEOUT_SECONDS_PRO", raising=False)
    from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter

    a = GoogleGenerativeAIAdapter()
    assert a._timeout_for("gemini-3.5-flash") == 60.0
    assert a._timeout_for("gemini-3.1-pro-preview") == 180.0
    assert a._timeout_for("gemini-2.5-pro") == 60.0
    # Un override explícito (tests / scripts) manda para todos.
    b = GoogleGenerativeAIAdapter(per_call_timeout_seconds=5.0)
    assert b._timeout_for("gemini-3.1-pro-preview") == 5.0

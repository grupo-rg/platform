"""Sprint 4 Fase A9 — tests del enforcement de LLM Vision budget.

Verifican que el extractor aborta con `LayoutUnsupportedError` cuando se
intenta procesar más de `MAX_LLM_VISION_PAGES` (default 50) via LLM Vision.

Esto cierra el silencio mortal del 14-may: si un PDF outlier llega al
fallback LLM Vision con 258 páginas, el sistema aborta inmediatamente
emitiendo `pipeline_error` SSE con `errorType=EXTRACTOR_LAYOUT_UNSUPPORTED`.
"""
from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest

from src.budget.application.services.pdf_extractor_service import (
    LayoutUnsupportedError,
    _enforce_llm_vision_budget,
    _get_max_llm_vision_pages,
    DEFAULT_MAX_LLM_VISION_PAGES,
)


def test_enforce_llm_vision_budget_under_threshold_no_raise():
    """Si num_pages <= max, no debe lanzar."""
    emit = MagicMock()
    _enforce_llm_vision_budget(
        num_pages=10,
        budget_id="b-test",
        emit_fn=emit,
        extractor_name="InlinePdfExtractorService",
    )
    emit.assert_not_called()


def test_enforce_llm_vision_budget_at_threshold_no_raise():
    """En el límite exacto (50 == 50), no lanza."""
    emit = MagicMock()
    _enforce_llm_vision_budget(
        num_pages=DEFAULT_MAX_LLM_VISION_PAGES,
        budget_id="b-test",
        emit_fn=emit,
        extractor_name="InlinePdfExtractorService",
    )
    emit.assert_not_called()


def test_enforce_llm_vision_budget_above_threshold_raises():
    """Si num_pages > max, lanza LayoutUnsupportedError + emite SSE."""
    emit = MagicMock()
    with pytest.raises(LayoutUnsupportedError) as exc_info:
        _enforce_llm_vision_budget(
            num_pages=DEFAULT_MAX_LLM_VISION_PAGES + 1,
            budget_id="b-test",
            emit_fn=emit,
            extractor_name="InlinePdfExtractorService",
        )
    assert "Layout no soportado" in str(exc_info.value)
    assert exc_info.value.error_code == "EXTRACTOR_LAYOUT_UNSUPPORTED"
    emit.assert_called_once()
    args, kwargs = emit.call_args
    assert args[0] == "b-test"
    assert args[1] == "pipeline_error"
    payload = args[2]
    assert payload["errorType"] == "EXTRACTOR_LAYOUT_UNSUPPORTED"
    assert payload["extractor"] == "InlinePdfExtractorService"
    assert payload["pagesAttempted"] == DEFAULT_MAX_LLM_VISION_PAGES + 1
    assert payload["maxPagesAllowed"] == DEFAULT_MAX_LLM_VISION_PAGES


def test_enforce_llm_vision_budget_rdll_258_pages_raises():
    """Caso concreto del incidente 14-may: 258 páginas → MUST abort."""
    emit = MagicMock()
    with pytest.raises(LayoutUnsupportedError):
        _enforce_llm_vision_budget(
            num_pages=258,
            budget_id="rdll-job",
            emit_fn=emit,
            extractor_name="AnnexedPdfExtractorService",
        )
    args, _ = emit.call_args
    payload = args[2]
    assert payload["pagesAttempted"] == 258


def test_enforce_llm_vision_budget_emit_failure_does_not_swallow():
    """Si emit_fn lanza, el budget enforcement aún levanta LayoutUnsupportedError."""
    def broken_emit(*args, **kwargs):
        raise RuntimeError("SSE channel closed")

    with pytest.raises(LayoutUnsupportedError):
        _enforce_llm_vision_budget(
            num_pages=100,
            budget_id="b-test",
            emit_fn=broken_emit,
            extractor_name="InlinePdfExtractorService",
        )


def test_get_max_llm_vision_pages_default():
    """Sin env var, default = 50."""
    old = os.environ.pop("MAX_LLM_VISION_PAGES", None)
    try:
        assert _get_max_llm_vision_pages() == DEFAULT_MAX_LLM_VISION_PAGES
    finally:
        if old is not None:
            os.environ["MAX_LLM_VISION_PAGES"] = old


def test_get_max_llm_vision_pages_env_override():
    """ENV `MAX_LLM_VISION_PAGES=100` override."""
    os.environ["MAX_LLM_VISION_PAGES"] = "100"
    try:
        assert _get_max_llm_vision_pages() == 100
    finally:
        os.environ.pop("MAX_LLM_VISION_PAGES", None)


def test_get_max_llm_vision_pages_invalid_env_falls_back():
    """ENV inválido (no numérico) → vuelve al default."""
    os.environ["MAX_LLM_VISION_PAGES"] = "not-a-number"
    try:
        assert _get_max_llm_vision_pages() == DEFAULT_MAX_LLM_VISION_PAGES
    finally:
        os.environ.pop("MAX_LLM_VISION_PAGES", None)


def test_get_max_llm_vision_pages_zero_or_negative_falls_back_to_min():
    """ENV `0` o negativo → clamp al minimo 1 (preventivo)."""
    os.environ["MAX_LLM_VISION_PAGES"] = "0"
    try:
        assert _get_max_llm_vision_pages() == 1
    finally:
        os.environ.pop("MAX_LLM_VISION_PAGES", None)
    os.environ["MAX_LLM_VISION_PAGES"] = "-10"
    try:
        assert _get_max_llm_vision_pages() == 1
    finally:
        os.environ.pop("MAX_LLM_VISION_PAGES", None)

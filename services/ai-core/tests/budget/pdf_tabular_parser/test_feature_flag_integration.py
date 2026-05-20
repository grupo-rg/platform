"""Tests para la integración del feature flag `USE_TABULAR_PARSER`."""
from __future__ import annotations

import os
from unittest.mock import patch

from src.budget.application.services.pdf_extractor_service import (
    _is_tabular_parser_enabled,
)


def test_default_is_disabled():
    """Sin env var → feature disabled."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("USE_TABULAR_PARSER", None)
        assert _is_tabular_parser_enabled() is False


def test_explicit_false_is_disabled():
    with patch.dict(os.environ, {"USE_TABULAR_PARSER": "false"}):
        assert _is_tabular_parser_enabled() is False


def test_truthy_values_enable():
    """`true|1|yes|on` (case-insensitive) deben activar el parser."""
    for val in ["true", "TRUE", "True", "1", "yes", "YES", "on", "ON"]:
        with patch.dict(os.environ, {"USE_TABULAR_PARSER": val}):
            assert _is_tabular_parser_enabled() is True, f"'{val}' debería activar"


def test_falsy_values_disable():
    """Otros strings deben desactivar."""
    for val in ["0", "no", "off", "False", "", "random"]:
        with patch.dict(os.environ, {"USE_TABULAR_PARSER": val}):
            assert _is_tabular_parser_enabled() is False, f"'{val}' debería desactivar"


def test_whitespace_tolerance():
    """Espacios alrededor del valor."""
    with patch.dict(os.environ, {"USE_TABULAR_PARSER": "  true  "}):
        assert _is_tabular_parser_enabled() is True

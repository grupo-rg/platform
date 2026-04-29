"""Fase 5.H — tests del matcher fuzzy para comparar pipeline output vs golden.

El matcher tiene 3 niveles (en orden de precedencia):
  1. Match exacto por código.
  2. Match por código normalizado (`re.sub(r'\W','',code).lower()`).
  3. Match fuzzy sobre descripción (SequenceMatcher ratio ≥ 0.85).

Si una partida del golden no matchea ninguna del pipeline en ninguno de los
3 niveles, cuenta como "no recuperada" (recall miss).
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "eval_golden_budgets.py"
spec = importlib.util.spec_from_file_location("eval_golden_budgets", _SCRIPT)
assert spec is not None and spec.loader is not None
_mod = importlib.util.module_from_spec(spec)
sys.modules["eval_golden_budgets"] = _mod
spec.loader.exec_module(_mod)

match_partidas = _mod.match_partidas
normalize_code = _mod.normalize_code


class TestNormalizeCode:
    def test_strips_non_alphanumeric(self):
        assert normalize_code("4.1.9") == "419"
        assert normalize_code("C01.01") == "c0101"
        assert normalize_code("EHV030b") == "ehv030b"

    def test_handles_none_or_empty(self):
        assert normalize_code(None) == ""
        assert normalize_code("") == ""


class TestMatchByExactCode:
    def test_exact_match_wins_first(self):
        golden = [{"code": "ACCESO", "description": "..."}]
        pipeline = [{"code": "ACCESO", "description": "..."}]
        matches = match_partidas(golden, pipeline)
        assert len(matches) == 1
        assert matches[0]["match_level"] == "exact_code"


class TestMatchByNormalizedCode:
    def test_code_with_formatting_differences(self):
        """'4.1.9' golden vs '4-1-9' pipeline → match normalizado."""
        golden = [{"code": "4.1.9", "description": "algo"}]
        pipeline = [{"code": "4-1-9", "description": "algo"}]
        matches = match_partidas(golden, pipeline)
        assert len(matches) == 1
        assert matches[0]["match_level"] == "normalized_code"

    def test_case_insensitive(self):
        golden = [{"code": "EHV030b", "description": "..."}]
        pipeline = [{"code": "ehv030B", "description": "..."}]
        matches = match_partidas(golden, pipeline)
        assert len(matches) == 1
        assert matches[0]["match_level"] == "normalized_code"


class TestMatchByFuzzyDescription:
    def test_same_description_different_code(self):
        """El pipeline puede asignar un código distinto del golden (p.ej.
        el del price_book en vez del del PDF humano). Si la descripción
        es la misma, el matcher fuzzy debe reconocerlos como la misma partida."""
        golden = [{
            "code": "ACCESO",
            "description": "Acondicioanmiento de la entrada del solar para camiones",
        }]
        pipeline = [{
            "code": "COAATMCA-ABC-123",
            "description": "Acondicionamiento de la entrada del solar para camiones",
        }]
        matches = match_partidas(golden, pipeline)
        assert len(matches) == 1
        assert matches[0]["match_level"] == "fuzzy_description"

    def test_very_different_descriptions_no_match(self):
        golden = [{"code": "A", "description": "Demolición de pared existente"}]
        pipeline = [{"code": "B", "description": "Pintura plástica blanca mate"}]
        matches = match_partidas(golden, pipeline)
        assert len(matches) == 0


class TestNoMatchingWhenOneSideEmpty:
    def test_empty_pipeline_returns_no_matches(self):
        golden = [{"code": "A", "description": "x"}]
        assert match_partidas(golden, []) == []

    def test_empty_golden_returns_no_matches(self):
        pipeline = [{"code": "A", "description": "x"}]
        assert match_partidas([], pipeline) == []


class TestOneToOneMatching:
    """Cada partida del golden matchea con una única del pipeline.
    Si hay dos pipeline partidas que podrían matchear la misma golden,
    se elige la de mayor ratio fuzzy."""

    def test_picks_best_of_multiple_candidates(self):
        golden = [{"code": "X", "description": "Pintura plástica mate blanca"}]
        pipeline = [
            {"code": "Y", "description": "Pintura plástica mate blanca de alta calidad"},  # score alto
            {"code": "Z", "description": "Pintura vinílica azul"},  # score bajo
        ]
        matches = match_partidas(golden, pipeline)
        assert len(matches) == 1
        assert matches[0]["pipeline"]["code"] == "Y"

    def test_does_not_double_match_pipeline_partida(self):
        """Una misma partida del pipeline no se puede mapear a dos goldens."""
        golden = [
            {"code": "A", "description": "Pintura plástica mate blanca"},
            {"code": "B", "description": "Pintura plástica mate blanca de calidad"},
        ]
        pipeline = [{"code": "X", "description": "Pintura plástica mate blanca"}]
        matches = match_partidas(golden, pipeline)
        # Solo puede haber 1 match (la otra golden queda sin pipeline)
        assert len(matches) == 1

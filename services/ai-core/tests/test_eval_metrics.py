"""Fase 5.H — tests de las métricas del eval.

Métricas implementadas:
  - recall: |golden ∩ pipeline| / |golden|
  - precision_1to1: matches por código exacto / total matches
  - price_delta_p50 / p95: percentiles del error relativo del precio unitario
  - chapter_total_delta_mean: media del error relativo del total por capítulo
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

compute_recall = _mod.compute_recall
compute_precision_1to1 = _mod.compute_precision_1to1
compute_price_delta_percentiles = _mod.compute_price_delta_percentiles
compute_chapter_total_delta = _mod.compute_chapter_total_delta
compute_precision_semantic = _mod.compute_precision_semantic
compute_chapter_total_delta_weighted = _mod.compute_chapter_total_delta_weighted


class TestRecall:
    def test_perfect_recall(self):
        golden = [{"code": "A"}, {"code": "B"}, {"code": "C"}]
        matches = [{"golden": g, "pipeline": {"code": g["code"]}} for g in golden]
        assert compute_recall(golden, matches) == pytest.approx(1.0)

    def test_half_recall(self):
        golden = [{"code": "A"}, {"code": "B"}, {"code": "C"}, {"code": "D"}]
        matches = [
            {"golden": golden[0], "pipeline": {"code": "A"}},
            {"golden": golden[1], "pipeline": {"code": "B"}},
        ]
        assert compute_recall(golden, matches) == pytest.approx(0.5)

    def test_empty_golden_returns_zero(self):
        assert compute_recall([], []) == 0.0


class TestPrecision1to1:
    def test_all_exact_matches(self):
        matches = [
            {"match_level": "exact_code"},
            {"match_level": "exact_code"},
            {"match_level": "exact_code"},
        ]
        assert compute_precision_1to1(matches) == pytest.approx(1.0)

    def test_mixed_levels(self):
        matches = [
            {"match_level": "exact_code"},
            {"match_level": "normalized_code"},
            {"match_level": "fuzzy_description"},
            {"match_level": "exact_code"},
        ]
        # 2/4 son exact_code → 0.5
        assert compute_precision_1to1(matches) == pytest.approx(0.5)

    def test_empty_returns_zero(self):
        assert compute_precision_1to1([]) == 0.0


class TestPriceDeltaPercentiles:
    def test_zero_delta_when_prices_match(self):
        matches = [
            {"golden": {"unitPrice": 100.0}, "pipeline": {"unitPrice": 100.0}},
            {"golden": {"unitPrice": 50.0}, "pipeline": {"unitPrice": 50.0}},
        ]
        p50, p95 = compute_price_delta_percentiles(matches)
        assert p50 == pytest.approx(0.0)
        assert p95 == pytest.approx(0.0)

    def test_relative_delta_uses_golden_as_base(self):
        """Si golden=100 y pipeline=120, delta relativo = |120-100|/100 = 0.2."""
        matches = [
            {"golden": {"unitPrice": 100.0}, "pipeline": {"unitPrice": 120.0}},
            {"golden": {"unitPrice": 100.0}, "pipeline": {"unitPrice": 80.0}},
        ]
        p50, p95 = compute_price_delta_percentiles(matches)
        assert p50 == pytest.approx(0.2)
        assert p95 == pytest.approx(0.2)

    def test_skips_matches_with_zero_golden_price(self):
        """División por cero evitada silenciosamente."""
        matches = [
            {"golden": {"unitPrice": 0.0}, "pipeline": {"unitPrice": 50.0}},
            {"golden": {"unitPrice": 100.0}, "pipeline": {"unitPrice": 110.0}},
        ]
        p50, p95 = compute_price_delta_percentiles(matches)
        # Solo se usa el segundo (delta = 0.1)
        assert p50 == pytest.approx(0.1)

    def test_empty_returns_zero(self):
        p50, p95 = compute_price_delta_percentiles([])
        assert p50 == 0.0 and p95 == 0.0


class TestChapterTotalDelta:
    def test_perfect_match_per_chapter(self):
        golden = [
            {"chapter_num": 1, "totalPrice": 100},
            {"chapter_num": 1, "totalPrice": 50},
            {"chapter_num": 2, "totalPrice": 200},
        ]
        pipeline = [
            {"chapter": "1", "totalPrice": 150},
            {"chapter": "2", "totalPrice": 200},
        ]
        delta_mean = compute_chapter_total_delta(golden, pipeline)
        assert delta_mean == pytest.approx(0.0)

    def test_divergence_detected(self):
        """Golden cap 1 = 150, pipeline cap 1 = 120 → delta = |120-150|/150 = 0.2"""
        golden = [{"chapter_num": 1, "totalPrice": 150}]
        pipeline = [{"chapter": "1", "totalPrice": 120}]
        delta_mean = compute_chapter_total_delta(golden, pipeline)
        assert delta_mean == pytest.approx(0.2)

    def test_averages_across_chapters(self):
        golden = [
            {"chapter_num": 1, "totalPrice": 100},
            {"chapter_num": 2, "totalPrice": 100},
        ]
        pipeline = [
            {"chapter": "1", "totalPrice": 100},  # delta 0
            {"chapter": "2", "totalPrice": 80},   # delta 0.2
        ]
        # Media = (0 + 0.2) / 2 = 0.1
        assert compute_chapter_total_delta(golden, pipeline) == pytest.approx(0.1)


# -------- 6.G — métricas recalibradas --------------------------------------


class TestPrecisionSemantic:
    """Sustituto semántico de `precision_1to1` — no depende de igualdad de
    códigos (golden Presto/RG ≠ pipeline COAATMCA) sino de que la descripción
    del pipeline sea >= 0.80 fuzzy contra el golden Y el capítulo coincida."""

    def test_all_descriptions_above_threshold_returns_1(self):
        matches = [
            {
                "golden": {"description": "Demolición alicatado baño", "chapter_num": 1},
                "pipeline": {"description": "Demolición de alicatado en baño", "chapter": "1"},
            },
            {
                "golden": {"description": "Instalación inodoro", "chapter_num": 2},
                "pipeline": {"description": "Instalación de inodoro", "chapter": "2"},
            },
        ]
        assert compute_precision_semantic(matches) == pytest.approx(1.0)

    def test_description_below_threshold_excluded(self):
        """Una descripción con similitud << 0.80 no cuenta como match preciso."""
        matches = [
            {
                "golden": {"description": "Demolición alicatado baño", "chapter_num": 1},
                "pipeline": {"description": "Demolición de alicatado en baño", "chapter": "1"},
            },
            {
                "golden": {"description": "Instalación inodoro", "chapter_num": 2},
                "pipeline": {"description": "Pintura plástica blanca", "chapter": "2"},
            },
        ]
        # 1/2 pasa el threshold → 0.5
        assert compute_precision_semantic(matches) == pytest.approx(0.5)

    def test_chapter_mismatch_excluded_even_when_description_matches(self):
        matches = [
            {
                "golden": {"description": "Demolición alicatado baño", "chapter_num": 1},
                "pipeline": {"description": "Demolición de alicatado en baño", "chapter": "3"},
            },
        ]
        assert compute_precision_semantic(matches) == pytest.approx(0.0)

    def test_empty_returns_zero(self):
        assert compute_precision_semantic([]) == 0.0

    def test_threshold_is_tunable(self):
        """Si bajamos el threshold a 0.30, incluso una similitud modesta cuenta."""
        matches = [
            {
                "golden": {"description": "aaaa", "chapter_num": 1},
                "pipeline": {"description": "aabb", "chapter": "1"},
            },
        ]
        # Ratio(aaaa, aabb) = 0.5 → debería pasar con thr=0.30, fallar con 0.80.
        assert compute_precision_semantic(matches, description_threshold=0.30) == pytest.approx(1.0)
        assert compute_precision_semantic(matches, description_threshold=0.80) == pytest.approx(0.0)


class TestChapterTotalDeltaWeighted:
    """Normaliza el error por PEM absoluto — evita que un capítulo pequeño
    con error grande domine la métrica."""

    def test_zero_on_perfect_match(self):
        golden = [
            {"chapter_num": 1, "totalPrice": 100},
            {"chapter_num": 2, "totalPrice": 500},
        ]
        pipeline = [
            {"chapter": "1", "totalPrice": 100},
            {"chapter": "2", "totalPrice": 500},
        ]
        assert compute_chapter_total_delta_weighted(golden, pipeline) == pytest.approx(0.0)

    def test_empty_returns_zero(self):
        assert compute_chapter_total_delta_weighted([], []) == 0.0

    def test_weighted_is_dominated_by_big_chapter_not_small(self):
        """Capítulo 1 = 90% del PEM (900€) con +10%  →  error=90€;
        capítulo 2 =  1€ con +200% (el pipeline responde 3€) → error=2€;

        Mean simple:      (0.10 + 2.00) / 2 = 1.05   (dominado por el pequeño)
        Weighted:         (90 + 2) / (900 + 1) = 92 / 901 ≈ 0.102  (dominado por el grande)
        """
        golden = [
            {"chapter_num": 1, "totalPrice": 900},
            {"chapter_num": 2, "totalPrice": 1},
        ]
        pipeline = [
            {"chapter": "1", "totalPrice": 990},   # +90€
            {"chapter": "2", "totalPrice": 3},     # +2€
        ]
        w = compute_chapter_total_delta_weighted(golden, pipeline)
        # Debe estar dominado por el 10% del capítulo grande, no por el 200% del pequeño.
        assert w == pytest.approx(92 / 901, rel=1e-3)

    def test_missing_chapter_in_pipeline_counted_as_full_loss(self):
        """Si el pipeline no tiene un capítulo que el golden sí tiene,
        ese error es el 100% del PEM del capítulo faltante."""
        golden = [
            {"chapter_num": 1, "totalPrice": 1000},
            {"chapter_num": 2, "totalPrice": 100},
        ]
        pipeline = [
            {"chapter": "1", "totalPrice": 1000},
        ]
        # Pérdida total = 100 sobre PEM 1100 → 100/1100 ≈ 0.091
        w = compute_chapter_total_delta_weighted(golden, pipeline)
        assert w == pytest.approx(100 / 1100, rel=1e-3)

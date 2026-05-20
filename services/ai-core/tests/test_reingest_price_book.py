"""Sprint 3.B — unit tests for `scripts/reingest_price_book.py`.

These tests cover the PURE pieces of the re-ingest script that are safe
to exercise without hitting Firestore or Gemini:
  - Unit normalization (delegates to Unit VO, but we pin the contract).
  - Breakdown doc_id construction (`{parent}#{idx:02d}`).
  - `_truncated_in_source` marker for codes containing ellipsis.
  - Embedding text builder matches what `EmbeddingTextBuilder` produces.
  - Pre-flight validation rejects sources where `is_variable` is missing
    on any breakdown.

The real ingest (Firestore writes, Gemini calls) is integration territory
and is intentionally NOT tested here — see the spec's prohibition on
hitting prod in unit tests.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

# Load `scripts/reingest_price_book.py` as a module (it's not in a package).
ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "reingest_price_book.py"
spec = importlib.util.spec_from_file_location("reingest_price_book", SCRIPT_PATH)
assert spec is not None and spec.loader is not None
reingest_price_book = importlib.util.module_from_spec(spec)
sys.modules["reingest_price_book"] = reingest_price_book
spec.loader.exec_module(reingest_price_book)

from src.budget.catalog.domain.price_book_entry import (  # noqa: E402
    EmbeddingTextBuilder,
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)


# -------- Helpers -----------------------------------------------------------


def _valid_breakdown(**overrides: Any) -> dict[str, Any]:
    """Minimal valid breakdown dict (with is_variable). Override any field."""
    base = {
        "code": "mo055",
        "description": "Oficial 1ª construcción.",
        "unit": "h",
        "quantity": 0.41,
        "price_unit": 35.2,
        "price": 14.43,
        "is_variable": False,
    }
    base.update(overrides)
    return base


def _valid_item(**overrides: Any) -> dict[str, Any]:
    """Minimal valid item dict (with one valid breakdown). Override fields."""
    base = {
        "code": "LVC010",
        "section": "Vidrios dobles estándar",
        "description": "Suministro y colocación de doble acristalamiento.",
        "unit": "m2",
        "priceTotal": 75.02,
        "page": 353,
        "breakdown": [_valid_breakdown()],
    }
    base.update(overrides)
    return base


def _make_source(items: list[dict[str, Any]], *, chapter: str = "ACRISTALAMIENTOS") -> list[dict[str, Any]]:
    return [{"chapter": chapter, "items": items}]


# -------- Unit normalization -----------------------------------------------


class TestNormalizeUnit:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("m²", "m2"),
            ("m2", "m2"),
            ("M2", "m2"),
            ("M²", "m2"),
            ("m³", "m3"),
            ("M³", "m3"),
            ("ud", "ud"),
            ("Ud", "ud"),
            ("UD", "ud"),
            ("u", "ud"),
            ("h", "h"),
            ("kg", "kg"),
            ("%", "%"),
        ],
    )
    def test_canonical_forms(self, raw: str, expected: str) -> None:
        assert reingest_price_book.normalize_unit(raw) == expected

    def test_unknown_unit_returns_none(self) -> None:
        # The Unit VO doesn't know about arbitrary jargon — we expect None.
        assert reingest_price_book.normalize_unit("xyz_not_a_unit") is None

    def test_empty_returns_none(self) -> None:
        assert reingest_price_book.normalize_unit("") is None
        assert reingest_price_book.normalize_unit("   ") is None


# -------- Breakdown doc_id construction ------------------------------------


class TestBuildBreakdownDocId:
    def test_zero_based_index_default(self) -> None:
        # Sprint 3.B spec: 0-based per item.
        assert reingest_price_book.build_breakdown_doc_id("LVC010", 0) == "LVC010#00"
        assert reingest_price_book.build_breakdown_doc_id("LVC010", 1) == "LVC010#01"
        assert reingest_price_book.build_breakdown_doc_id("LVC010", 9) == "LVC010#09"
        assert reingest_price_book.build_breakdown_doc_id("LVC010", 10) == "LVC010#10"

    def test_two_digit_zero_pad(self) -> None:
        # Big items can have 20+ breakdowns; we keep the 2-digit ordinal.
        assert reingest_price_book.build_breakdown_doc_id("X", 25) == "X#25"

    def test_parent_with_dots_preserved(self) -> None:
        # Codes like `D3001.0120` (post-fix) MUST keep their dots.
        assert (
            reingest_price_book.build_breakdown_doc_id("D3001.0120", 3)
            == "D3001.0120#03"
        )


# -------- Truncation marker -------------------------------------------------


class TestCodeIsTruncated:
    @pytest.mark.parametrize(
        "code,expected",
        [
            ("UXH010c…", True),
            ("foo...", True),
            ("foo…bar", True),
            ("UXH010ca", False),
            ("D3001.0120", False),
            ("mt21veg011aa", False),
            ("", False),
        ],
    )
    def test_detects_ellipsis(self, code: str, expected: bool) -> None:
        assert reingest_price_book.code_is_truncated(code) is expected

    def test_transform_marks_truncated_codes(self) -> None:
        """`transform_source` must surface ellipsis codes via the marker."""
        source = _make_source(
            [
                _valid_item(
                    code="GOOD001",
                    breakdown=[_valid_breakdown(code="mt21veg011aa")],
                ),
                # Item code is fine but one breakdown code is truncated.
                _valid_item(
                    code="GOOD002",
                    breakdown=[
                        _valid_breakdown(code="mt_truncated…"),
                        _valid_breakdown(code="mo055"),
                    ],
                ),
            ]
        )
        report = reingest_price_book.transform_source(source, idx_base=0)
        # The truncated breakdown should be counted.
        assert report.truncated_marks == 1
        # And the entry payload (when serialized) flags it.
        truncated_bk = next(
            b for b in report.breakdowns if "…" in b.code
        )
        doc_id, payload = reingest_price_book._entry_to_doc_payload(
            truncated_bk, [0.0] * 768, session_id="sess_test"
        )
        assert payload["_truncated_in_source"] is True
        assert payload["_reingest_session_id"] == "sess_test"


# -------- Embedding text builder parity ------------------------------------


class TestEmbeddingTextBuilderParity:
    """The re-ingest script delegates embedding text to `EmbeddingTextBuilder`
    from `domain/price_book_entry.py`. These tests confirm we're producing
    the same string the schema expects — a divergence would silently break
    vector search hits across the catalogue.
    """

    def test_item_text_matches(self) -> None:
        item = PriceBookItemEntry(
            code="LVC010",
            chapter="ACRISTALAMIENTOS",
            section="Vidrios dobles estándar",
            description="Suministro y colocación de doble acristalamiento",
            unit_raw="m2",
            unit_normalized="m2",
            unit_dimension="superficie",
            priceTotal=75.02,
        )
        # We use the imported builder directly in the script; this just pins
        # the format string so a future refactor doesn't drift.
        expected = (
            "ACRISTALAMIENTOS > Vidrios dobles estándar | m2 | "
            "Suministro y colocación de doble acristalamiento"
        )
        assert EmbeddingTextBuilder.for_item(item) == expected

    def test_breakdown_text_matches(self) -> None:
        bk = PriceBookBreakdownEntry(
            code="mo055",
            doc_id="LVC010#00",
            parent_code="LVC010",
            parent_description="Suministro y colocación de doble acristalamiento",
            parent_unit="m2",
            chapter="ACRISTALAMIENTOS",
            description="Oficial 1ª cristalero.",
            unit_raw="h",
            unit_normalized="h",
            unit_dimension="tiempo",
            quantity=0.41,
            price_unit=35.2,
            price=14.43,
        )
        expected = (
            "ACRISTALAMIENTOS > Suministro y colocación de doble "
            "acristalamiento | componente: Oficial 1ª cristalero. (h)"
        )
        assert EmbeddingTextBuilder.for_breakdown(bk) == expected


# -------- Pre-flight validation: is_variable enforcement -------------------


class TestPreflightValidate:
    def test_accepts_valid_minimal_source_with_padding(self) -> None:
        """Minimal valid source must pass schema checks (count thresholds
        intentionally bypassed for this unit test by patching the constants).
        """
        # Lower thresholds so a small fixture passes — this isolates the
        # schema checks from the production-volume thresholds.
        original_min_items = reingest_price_book.MIN_ITEM_COUNT
        original_min_bk = reingest_price_book.MIN_BREAKDOWN_COUNT
        reingest_price_book.MIN_ITEM_COUNT = 1
        reingest_price_book.MIN_BREAKDOWN_COUNT = 1
        try:
            source = _make_source([_valid_item()])
            report = reingest_price_book.preflight_validate(source)
            assert report.ok, f"expected ok, got errors: {report.errors}"
            assert report.items_count == 1
            assert report.breakdowns_count == 1
            assert report.is_variable_false_count == 1
            assert report.is_variable_true_count == 0
        finally:
            reingest_price_book.MIN_ITEM_COUNT = original_min_items
            reingest_price_book.MIN_BREAKDOWN_COUNT = original_min_bk

    def test_rejects_when_is_variable_missing_on_any_breakdown(self) -> None:
        """CRITICAL Sprint 3.B check: absent `is_variable` -> preflight fails."""
        bad_bk = _valid_breakdown()
        del bad_bk["is_variable"]
        source = _make_source([_valid_item(breakdown=[bad_bk])])
        report = reingest_price_book.preflight_validate(source)
        assert not report.ok
        # Error message must mention is_variable so the operator knows what's wrong.
        joined = " | ".join(report.errors)
        assert "is_variable" in joined
        # And it should not increment the bool counter for the missing one.
        assert report.is_variable_true_count == 0
        assert report.is_variable_false_count == 0

    def test_rejects_when_a_single_breakdown_misses_is_variable(self) -> None:
        """Even ONE missing is_variable across thousands must abort."""
        good_bk = _valid_breakdown(is_variable=True)
        bad_bk = _valid_breakdown()
        del bad_bk["is_variable"]
        source = _make_source([_valid_item(breakdown=[good_bk, bad_bk])])
        report = reingest_price_book.preflight_validate(source)
        assert not report.ok
        joined = " | ".join(report.errors)
        assert "is_variable" in joined

    def test_rejects_duplicate_item_codes(self) -> None:
        source = _make_source([_valid_item(code="DUP"), _valid_item(code="DUP")])
        report = reingest_price_book.preflight_validate(source)
        assert not report.ok
        joined = " | ".join(report.errors)
        assert "Duplicate" in joined or "duplicate" in joined.lower()

    def test_rejects_empty_item_code(self) -> None:
        source = _make_source([_valid_item(code="")])
        report = reingest_price_book.preflight_validate(source)
        assert not report.ok
        joined = " | ".join(report.errors)
        assert "empty code" in joined.lower()

    def test_rejects_below_minimum_item_count(self) -> None:
        """When the JSON is too small, the thresholds must guard us."""
        # Defaults are 1650 items / 10000 breakdowns; a single-item fixture
        # falls well below.
        source = _make_source([_valid_item()])
        report = reingest_price_book.preflight_validate(source)
        assert not report.ok
        joined = " | ".join(report.errors)
        assert (
            "expected minimum" in joined or "Item count" in joined
        )

    def test_preserves_is_variable_true_false_distribution(self) -> None:
        """Counters should reflect the JSON exactly (not be overridden)."""
        original_min_items = reingest_price_book.MIN_ITEM_COUNT
        original_min_bk = reingest_price_book.MIN_BREAKDOWN_COUNT
        reingest_price_book.MIN_ITEM_COUNT = 1
        reingest_price_book.MIN_BREAKDOWN_COUNT = 1
        try:
            source = _make_source(
                [
                    _valid_item(
                        code="X1",
                        breakdown=[
                            _valid_breakdown(is_variable=True),
                            _valid_breakdown(is_variable=False),
                            _valid_breakdown(is_variable=True),
                        ],
                    ),
                ]
            )
            report = reingest_price_book.preflight_validate(source)
            assert report.ok
            assert report.is_variable_true_count == 2
            assert report.is_variable_false_count == 1
        finally:
            reingest_price_book.MIN_ITEM_COUNT = original_min_items
            reingest_price_book.MIN_BREAKDOWN_COUNT = original_min_bk


# -------- transform_source preserves is_variable exactly --------------------


class TestTransformSourcePreservesIsVariable:
    def test_round_trip_is_variable_bool(self) -> None:
        """The transformed entries must carry `is_variable` unchanged."""
        source = _make_source(
            [
                _valid_item(
                    code="X1",
                    breakdown=[
                        _valid_breakdown(code="mt001", is_variable=True),
                        _valid_breakdown(code="mt002", is_variable=False),
                    ],
                ),
            ]
        )
        report = reingest_price_book.transform_source(source, idx_base=0)
        assert len(report.breakdowns) == 2
        by_code = {b.code: b.is_variable for b in report.breakdowns}
        assert by_code["mt001"] is True
        assert by_code["mt002"] is False

    def test_breakdown_ids_use_compound_doc_ids(self) -> None:
        """The parent's `breakdown_ids` list must be the doc_ids, not codes."""
        source = _make_source(
            [
                _valid_item(
                    code="X1",
                    breakdown=[
                        _valid_breakdown(code="mo055"),
                        _valid_breakdown(code="mo055"),  # same code, different idx
                    ],
                ),
            ]
        )
        report = reingest_price_book.transform_source(source, idx_base=0)
        assert len(report.items) == 1
        # With idx_base=0, the two doc_ids are #00 and #01.
        assert report.items[0].breakdown_ids == ["X1#00", "X1#01"]

    def test_idx_base_one_starts_at_01(self) -> None:
        """Operator override: idx_base=1 keeps the previous prod convention."""
        source = _make_source(
            [
                _valid_item(
                    code="X1",
                    breakdown=[_valid_breakdown(), _valid_breakdown()],
                ),
            ]
        )
        report = reingest_price_book.transform_source(source, idx_base=1)
        assert report.items[0].breakdown_ids == ["X1#01", "X1#02"]

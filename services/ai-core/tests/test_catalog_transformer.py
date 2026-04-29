"""Fase 3.3 — tests del `CatalogTransformer`.

Convierte el JSON origen `docs/2025_variable_final.json` (lista de
capítulos → lista de items → breakdowns) en el formato del nuevo
price_book_2025: pares (item padre, breakdowns hijos). Función pura,
determinista, sin I/O.

Contrato:
  - El code del padre se preserva del origen (`LVC010`).
  - Los codes de los breakdowns son `{parent_code}#{idx:02d}` desde 1.
  - Los `breakdown_ids` del padre son EXACTAMENTE la lista de codes hijos.
  - Las unidades se normalizan vía Unit VO (`m²` → `m2`).
  - Items sin breakdowns se transforman sin generar hijos (breakdown_ids=[]).
  - Items sin `priceTotal` o sin campos críticos → se omiten con un warning
    (no crash, no datos basura en el índice).
"""

from __future__ import annotations

import pytest

from src.budget.catalog.application.services.catalog_transformer import (
    CatalogTransformer,
)


# -------- Fixtures mínimos (shapes reales del JSON fuente) --------------------


def _minimal_item(code: str = "LVC010", with_breakdowns: bool = True) -> dict:
    base = {
        "code": code,
        "description": "Suministro y colocación de doble acristalamiento estándar 4/12/4",
        "unit": "m2",
        "priceTotal": 75.02,
        "chapter": "ACRISTALAMIENTOS",
        "section": "Vidrios dobles estándar",
        "page": 353,
    }
    if with_breakdowns:
        base["breakdown"] = [
            {
                "code": "mt21veg011aa",
                "description": "Doble acristalamiento estándar, 4/12/4",
                "quantity": 1.01,
                "unit": "m2",
                "price_unit": 39.58,
                "price": 39.98,
                "is_variable": True,
            },
            {
                "code": "mo055",
                "description": "Oficial 1ª cristalero.",
                "quantity": 0.41,
                "unit": "h",
                "price_unit": 35.2,
                "price": 14.43,
                "is_variable": False,
            },
        ]
    return base


def _chapter_shape(chapter_name: str, items: list[dict]) -> dict:
    return {"chapter": chapter_name, "items": items}


# -------- Transformer happy path ---------------------------------------------


class TestCatalogTransformerHappyPath:
    def test_single_item_with_two_breakdowns_produces_1_item_2_bks(self) -> None:
        source = [_chapter_shape("ACRISTALAMIENTOS", [_minimal_item()])]

        items, bks = CatalogTransformer.transform(source)

        assert len(items) == 1
        assert len(bks) == 2

    def test_parent_code_preserved(self) -> None:
        source = [_chapter_shape("ACRISTALAMIENTOS", [_minimal_item(code="LVC010")])]
        items, _ = CatalogTransformer.transform(source)
        assert items[0].code == "LVC010"

    def test_breakdown_codes_preserve_original_coaatmca_prefix(self) -> None:
        """Fase 12 — el `code` del breakdown ahora preserva el original (mt*/mo*/mq*).
        El doc_id compound (`LVC010#01`) se guarda aparte para uniqueness en Firestore.
        """
        source = [_chapter_shape("ACRISTALAMIENTOS", [_minimal_item(code="LVC010")])]
        _, bks = CatalogTransformer.transform(source)
        assert bks[0].code == "mt21veg011aa"  # original
        assert bks[1].code == "mo055"  # original
        assert bks[0].doc_id == "LVC010#01"  # compound único
        assert bks[1].doc_id == "LVC010#02"

    def test_breakdown_falls_back_to_compound_when_original_code_missing(self) -> None:
        """Si el JSON no aporta `code`, fallback a compound (legacy)."""
        item = _minimal_item()
        del item["breakdown"][0]["code"]
        source = [_chapter_shape("X", [item])]
        _, bks = CatalogTransformer.transform(source)
        # Sin code original → code = doc_id compound.
        assert bks[0].code == "LVC010#01"
        assert bks[0].doc_id == "LVC010#01"

    def test_parent_breakdown_ids_point_to_doc_ids_not_codes(self) -> None:
        """`breakdown_ids` apunta a doc_ids únicos (no a codes que pueden repetirse)."""
        source = [_chapter_shape("ACRISTALAMIENTOS", [_minimal_item()])]
        items, bks = CatalogTransformer.transform(source)
        assert items[0].breakdown_ids == [bk.doc_id for bk in bks]

    def test_parent_context_is_copied_into_breakdown(self) -> None:
        source = [_chapter_shape("ACRISTALAMIENTOS", [_minimal_item()])]
        _, bks = CatalogTransformer.transform(source)
        assert bks[0].parent_code == "LVC010"
        assert bks[0].parent_description.startswith("Suministro y colocación")
        assert bks[0].parent_unit == "m2"
        assert bks[0].chapter == "ACRISTALAMIENTOS"

    def test_unit_is_normalized_via_unit_vo(self) -> None:
        item = _minimal_item()
        item["unit"] = "M²"  # jerga
        source = [_chapter_shape("X", [item])]
        items, _ = CatalogTransformer.transform(source)
        assert items[0].unit_raw == "M²"
        assert items[0].unit_normalized == "m2"
        assert items[0].unit_dimension == "superficie"


class TestCatalogTransformerEdgeCases:
    def test_item_without_breakdowns_produces_item_only(self) -> None:
        source = [_chapter_shape("X", [_minimal_item(with_breakdowns=False)])]
        items, bks = CatalogTransformer.transform(source)
        assert len(items) == 1
        assert items[0].breakdown_ids == []
        assert bks == []

    def test_item_missing_code_is_skipped(self) -> None:
        bad_item = _minimal_item()
        del bad_item["code"]
        source = [_chapter_shape("X", [bad_item, _minimal_item(code="OK1")])]
        items, _ = CatalogTransformer.transform(source)
        # Solo el item válido queda
        assert {i.code for i in items} == {"OK1"}

    def test_breakdown_with_bad_shape_is_skipped_but_siblings_survive(self) -> None:
        item = _minimal_item()
        # breakdown sin description → lo descartamos
        item["breakdown"].insert(0, {"invalid": True})
        source = [_chapter_shape("X", [item])]
        items, bks = CatalogTransformer.transform(source)
        # Los 2 breakdowns originales se procesan; el malformado se salta.
        # Los índices del compound doc_id se asignan SOLO a los válidos para
        # mantener la correspondencia con `breakdown_ids` del padre.
        assert len(bks) == 2
        assert bks[0].doc_id == "LVC010#01"
        assert bks[1].doc_id == "LVC010#02"
        assert bks[0].code == "mt21veg011aa"  # Fase 12 — codes originales preservados
        assert bks[1].code == "mo055"
        assert items[0].breakdown_ids == ["LVC010#01", "LVC010#02"]

    def test_empty_source_returns_empty_lists(self) -> None:
        items, bks = CatalogTransformer.transform([])
        assert items == []
        assert bks == []

    def test_multiple_chapters_handled_independently(self) -> None:
        source = [
            _chapter_shape("A", [_minimal_item(code="A1"), _minimal_item(code="A2")]),
            _chapter_shape("B", [_minimal_item(code="B1")]),
        ]
        items, _ = CatalogTransformer.transform(source)
        codes = {i.code for i in items}
        chapters = {i.chapter for i in items}
        assert codes == {"A1", "A2", "B1"}
        assert chapters == {"A", "B"}


# -------- Integración con el JSON real ---------------------------------------


class TestAgainstRealJson:
    """Sanity check contra `docs/2025_variable_final.json` del repo.

    Este test es costoso (carga 5MB). Lo aceptamos porque es la única forma
    de detectar si el JSON evoluciona a un shape que el transformer no soporta.
    """

    def test_real_json_transforms_without_errors(self) -> None:
        import json
        from pathlib import Path

        # services/ai-core → ../../docs
        repo_root = Path(__file__).resolve().parents[3]
        json_path = repo_root / "docs" / "2025_variable_final.json"
        assert json_path.exists(), f"Falta {json_path}"

        with json_path.open("r", encoding="utf-8") as f:
            source = json.load(f)

        items, bks = CatalogTransformer.transform(source)
        # Sanity: al menos cientos de items y miles de breakdowns
        assert len(items) > 100
        assert len(bks) > len(items) * 2  # al menos 2 breakdowns medios por item
        # Todo item referencia breakdowns existentes (vía doc_id, no code).
        bk_doc_ids = {bk.doc_id or bk.code for bk in bks}
        for it in items:
            for bk_id in it.breakdown_ids:
                assert bk_id in bk_doc_ids, f"Referencia rota: {it.code} → {bk_id}"
        # Fase 12 — sanity adicional: la mayoría de breakdowns preservan prefijos COAATMCA.
        prefixes = sum(
            1 for bk in bks
            if bk.code.lower().startswith(("mo", "mt", "mq", "%", "ci"))
        )
        # Empíricamente 92% del catálogo tiene prefijos limpios; pedimos ≥ 80% margen.
        assert prefixes / len(bks) > 0.80, f"Solo {prefixes}/{len(bks)} con prefijos"

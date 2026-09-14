"""CLI shim — la lógica de extracción vive ahora en
``src/budget/catalog/pdf_extractor.py`` para que sea importable desde el
servicio (el endpoint de preview la usa) y NO quede excluida del contenedor
por `.dockerignore scripts/`.

Este fichero re-exporta TODO el módulo (incluidos los helpers privados que
usan los tests) y conserva el CLI:

    python services/ai-core/scripts/extract_catalog_from_pdf.py \
        --pdf docs/Palma47_2025_COAATMCA.pdf \
        --output data/catalog_source/pdf_extracted_catalog.json
"""

from __future__ import annotations

from src.budget.catalog import pdf_extractor as _impl

# Re-exporta el namespace completo (público + `_privados`) para no romper
# `from scripts.extract_catalog_from_pdf import _extract_words, ...` en tests.
_SKIP = {
    "__name__",
    "__doc__",
    "__package__",
    "__loader__",
    "__spec__",
    "__file__",
    "__builtins__",
    "__cached__",
}
globals().update({k: v for k, v in vars(_impl).items() if k not in _SKIP})


if __name__ == "__main__":
    raise SystemExit(_impl.main())

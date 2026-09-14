"""Puntero de versión del catálogo de precios (fuente ÚNICA del año/edición activos).

Sustituye los literales `price_book_2025` / `labor_rates_2025` /
`machinery_rates_2025` dispersos por el código. El año activo se resuelve del
env `CATALOG_YEAR` (default 2025) → HOY es un no-op (mismo comportamiento). Al
subir el Libro 2026, un solo cambio (`CATALOG_YEAR=2026`) reapunta TODAS las
colecciones a la vez, y volver a 2025 es el rollback.

Se resuelve al importar el módulo consumidor (en Cloud Run el env ya está puesto
al arrancar). Un futuro puntero en Firestore (`catalog_config/active`) puede
envolver estas funciones sin tocar los call-sites.
"""
from __future__ import annotations

import os

_DEFAULT_CATALOG_YEAR = 2025


def catalog_year() -> int:
    """Año/edición activo del catálogo. `CATALOG_YEAR` del entorno o 2025."""
    raw = (os.environ.get("CATALOG_YEAR") or "").strip()
    if raw.isdigit():
        return int(raw)
    return _DEFAULT_CATALOG_YEAR


def price_book_collection() -> str:
    return f"price_book_{catalog_year()}"


def labor_rates_collection() -> str:
    return f"labor_rates_{catalog_year()}"


def machinery_rates_collection() -> str:
    return f"machinery_rates_{catalog_year()}"


def source_book() -> str:
    return f"COAATMCA_{catalog_year()}"

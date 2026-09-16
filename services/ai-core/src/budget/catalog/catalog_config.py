"""Puntero de versión del catálogo de precios (fuente ÚNICA del año/edición activos).

Sustituye los literales `price_book_2025` / `labor_rates_2025` /
`machinery_rates_2025` dispersos por el código.

**Resolución del año activo (prioridad):**
  1. Puntero Firestore `catalog_config/active.year` — permite **flip en caliente**
     (go-live / rollback) sin redeploy. Cacheado con TTL corto para no leer
     Firestore en cada llamada.
  2. Env `CATALOG_YEAR` — fallback si el puntero no existe o Firestore no
     responde (y bootstrap por defecto).
  3. `2025` — default duro.

Las funciones se llaman en runtime en los paths de búsqueda (ej.
`firestore_price_book.py` construye la colección por-query), así que el flip del
puntero reapunta la búsqueda vectorial sin reiniciar. Los consumidores que
resuelven la colección a nivel de módulo (import-time) reflejan el cambio al
reciclarse la instancia.
"""
from __future__ import annotations

import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

_DEFAULT_CATALOG_YEAR = 2025
_POINTER_COLLECTION = "catalog_config"
_POINTER_DOC = "active"
_POINTER_TTL_SECONDS = 30.0

_cache_lock = threading.Lock()
_cache: dict[str, float | int | None] = {"year": None, "ts": 0.0}


def _env_or_default_year() -> int:
    raw = (os.environ.get("CATALOG_YEAR") or "").strip()
    return int(raw) if raw.isdigit() else _DEFAULT_CATALOG_YEAR


def _read_pointer_year() -> int | None:
    """Lee `catalog_config/active.year` de Firestore. `None` si no existe o falla
    (firebase no inicializado, red caída, etc.) → el caller usa el fallback."""
    try:
        from firebase_admin import firestore

        doc = firestore.client().collection(_POINTER_COLLECTION).document(_POINTER_DOC).get()
        if not doc.exists:
            return None
        y = (doc.to_dict() or {}).get("year")
        if isinstance(y, bool):  # bool es subclase de int → excluir
            return None
        if isinstance(y, int) and y > 0:
            return y
        if isinstance(y, str) and y.strip().isdigit():
            return int(y.strip())
    except Exception:
        return None
    return None


def catalog_year() -> int:
    """Año/edición activo del catálogo. Puntero Firestore (cache TTL) → env → 2025."""
    now = time.time()
    with _cache_lock:
        cached = _cache["year"]
        ts = _cache["ts"] or 0.0
        if cached is not None and (now - ts) < _POINTER_TTL_SECONDS:
            return int(cached)

    year = _read_pointer_year()
    if year is None:
        year = _env_or_default_year()

    with _cache_lock:
        _cache["year"] = year
        _cache["ts"] = now
    return year


def refresh_catalog_pointer() -> None:
    """Invalida la caché: el próximo `catalog_year()` relee el puntero de Firestore.
    Útil justo tras escribir el puntero para no esperar el TTL."""
    with _cache_lock:
        _cache["year"] = None
        _cache["ts"] = 0.0


def set_active_year(year: int, *, updated_by: str = "system") -> None:
    """Escribe el puntero `catalog_config/active.year` (go-live / rollback) e
    invalida la caché local. El resto de instancias lo recogen dentro del TTL."""
    from datetime import datetime, timezone

    from firebase_admin import firestore

    firestore.client().collection(_POINTER_COLLECTION).document(_POINTER_DOC).set(
        {
            "year": int(year),
            "updated_at": datetime.now(timezone.utc),
            "updated_by": updated_by,
        },
        merge=True,
    )
    refresh_catalog_pointer()
    logger.info("catalog_pointer_set", extra={"year": year, "updatedBy": updated_by})


def price_book_collection() -> str:
    return f"price_book_{catalog_year()}"


def labor_rates_collection() -> str:
    return f"labor_rates_{catalog_year()}"


def machinery_rates_collection() -> str:
    return f"machinery_rates_{catalog_year()}"


def source_book() -> str:
    return f"COAATMCA_{catalog_year()}"

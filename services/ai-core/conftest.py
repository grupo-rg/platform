"""Raíz de conftest.

Ignoramos tests legacy cuyos imports apuntan a clases que ya no existen
(ej: `PricingEvaluatorResult` fue reemplazado por `BatchPricingEvaluatorResultV3`).
Se mantienen en disco para migrarlos cuando toque.
"""

import os
import sys

collect_ignore_glob = [
    "scripts/test_extractor_local.py",
    "tests/application/test_extract_budget_use_case.py",
    "tests/budget/application/test_restructure_budget_uc.py",
    "tests/domain/test_math_validator.py",
]


# ---------------------------------------------------------------------------
# Aislamiento del puntero de año del catálogo (`catalog_config`).
#
# `catalog_config._read_pointer_year()` hace un GET a la colección
# `catalog_config/active` de Firestore para resolver el año/edición activo
# (feature Fase 4d — flip en caliente). En unit tests NO debemos tocar el
# backend real, pero los tests de endpoints importan `src.core.http.main`, que
# en import-time llama a `load_dotenv()` + `firebase_admin.initialize_app(cred)`
# con las credenciales de `.env`. Una vez firebase_admin queda inicializado
# (singleton de proceso), `_read_pointer_year()` empieza a leer PRODUCCIÓN y
# devuelve el año activo real (hoy `2026`).
#
# Ese año se cachea a nivel de módulo (`catalog_config._cache`) y reescribe los
# nombres de colección — tanto las constantes resueltas en import-time
# (`PRICE_BOOK_COLLECTION`, `COLLECTION_NAME`, baked al importar
# `dependencies.py` durante la colección) como la resolución en runtime del
# adapter de búsqueda. Eso rompe, de forma dependiente del orden, los tests que
# fijan `2025` (`test_firestore_price_book_search.py`,
# `test_firestore_catalog_repository.py`, `test_firestore_price_book_repository.py`),
# que pasan en aislado (sin firebase) pero fallan en la suite completa.
#
# Fix de test-only: neutralizamos la lectura del puntero para TODA la sesión de
# pytest, a nivel de módulo de conftest (que pytest importa ANTES de colectar
# cualquier test, luego antes de que se horneen las constantes). Con el puntero
# neutralizado, `catalog_year()` cae al fallback determinista
# (`CATALOG_YEAR` env → default 2025). Ningún test ejercita la lógica del
# puntero, así que es seguro. NO se toca código de producción: el import-time
# baking del año activo es un tradeoff deliberado documentado en
# `catalog_config.py`, correcto en producción.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.budget.catalog import catalog_config as _catalog_config  # noqa: E402

_catalog_config._read_pointer_year = lambda: None  # type: ignore[assignment]
_catalog_config.refresh_catalog_pointer()

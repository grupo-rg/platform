"""Reader Firestore de la colección `material_price_rules`.

Colección PEQUEÑA (una fila por regla de ajuste de precio). Este módulo SOLO
LEE: crear / editar / desactivar reglas lo hace el admin desde el lado
TypeScript (admin SDK). El compositor de pricing Python consume `list_active()`
para resolver el factor por material (cableado en otra wave).

Patrón espejo de `firestore_material_catalog.py`: `firestore.client()` por
defecto (db inyectable para tests), constante `COLLECTION`, y NUNCA lanza hacia
el pricing (devuelve `[]` ante error). Como la tabla es pequeña, se hace stream
completo + filtrado de activas en memoria (igual que `FirestoreCatalogRepository`),
sin índices compuestos.

Cache: TTL simple opcional a nivel de instancia (~30s) para evitar un stream
por cada partida valorada dentro de un mismo presupuesto. Pásese
`cache_ttl_seconds=0` para desactivarla (útil en tests).
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Tuple

from firebase_admin import firestore

from src.budget.catalog.domain.material_price_rule import MaterialPriceRule

logger = logging.getLogger(__name__)

COLLECTION = "material_price_rules"

_DEFAULT_CACHE_TTL_SECONDS = 30.0


class FirestoreMaterialPriceRulesReader:
    def __init__(
        self,
        db: Optional[Any] = None,
        cache_ttl_seconds: float = _DEFAULT_CACHE_TTL_SECONDS,
    ) -> None:
        # db inyectable para tests; en prod default al cliente global.
        self.db = db if db is not None else firestore.client()
        self._cache_ttl = cache_ttl_seconds
        # key ("all" | "active") -> (expira_en_monotonic, reglas)
        self._cache: Dict[str, Tuple[float, List[MaterialPriceRule]]] = {}

    def list_all(self) -> List[MaterialPriceRule]:
        """Todas las reglas (activas e inactivas)."""
        return self._load(include_inactive=True)

    def list_active(self) -> List[MaterialPriceRule]:
        """Solo las reglas con `active == True`."""
        return self._load(include_inactive=False)

    def invalidate_cache(self) -> None:
        """Descarta el cache (útil tras una escritura desde el lado TS)."""
        self._cache.clear()

    # ---- interno ----------------------------------------------------------

    def _load(self, *, include_inactive: bool) -> List[MaterialPriceRule]:
        cache_key = "all" if include_inactive else "active"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        rules: List[MaterialPriceRule] = []
        try:
            for snap in self.db.collection(COLLECTION).stream():
                data = snap.to_dict()
                if data is None:
                    continue
                # El `id` viaja dentro del doc (paridad TS); fallback al doc id.
                data.setdefault("id", getattr(snap, "id", None))
                try:
                    rule = MaterialPriceRule.model_validate(data)
                except Exception as e:
                    logger.warning(
                        f"[material_price_rules] skipping malformed doc "
                        f"{getattr(snap, 'id', '?')}: {e}"
                    )
                    continue
                if not include_inactive and rule.active is not True:
                    continue
                rules.append(rule)
        except Exception as e:  # nunca lanzamos hacia el pricing
            logger.error(f"[material_price_rules] list failed: {e}")
            return []

        self._cache_set(cache_key, rules)
        return rules

    def _cache_get(self, key: str) -> Optional[List[MaterialPriceRule]]:
        if self._cache_ttl <= 0:
            return None
        entry = self._cache.get(key)
        if entry is None:
            return None
        expires_at, rules = entry
        if time.monotonic() >= expires_at:
            self._cache.pop(key, None)
            return None
        return list(rules)  # copia defensiva: el caller no muta el cache

    def _cache_set(self, key: str, rules: List[MaterialPriceRule]) -> None:
        if self._cache_ttl <= 0:
            return
        self._cache[key] = (time.monotonic() + self._cache_ttl, list(rules))

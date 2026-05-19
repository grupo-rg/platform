"""S1-A-04 — Caché de pricing por hash en Firestore.

Cada partida del PDF tiene una descripción + unidad. Si la misma combinación
ya fue resuelta antes con confidence ≥ threshold, podemos reutilizar el
resultado sin llamar al LLM.

Esquema del documento Firestore (``partida_pricing_cache/{hash}``):

  hash:                  sha256 hex del normalize(description) + "|" + normalize(unit)
  normalized_description: descripción normalizada (auditable)
  normalized_unit:       unidad normalizada (auditable)
  resolved_partida:      BudgetPartida serializada
  match_kind:            "1:1" | "1:N" | "from_scratch"
  confidence_score:      float 0..1 (del cross-encoder o del LLM judge)
  hits_count:            int — cuántas veces se ha usado el hit
  first_seen:            ISO timestamp
  last_used:             ISO timestamp (se actualiza en cada hit)
  expires_at:            ISO timestamp (now + 90 días al persist; rolling window)

Política:
  - Lookup: si hit existe Y confidence ≥ 0.85 Y expires_at > now, devolver.
    Side-effect: hits_count++, last_used = now.
  - Persist: guardar solo cuando confidence ≥ 0.85; refrescar TTL en cada
    persist (rolling window).

Note: el cron de limpieza de entradas expiradas se introduce en Sprint 2
(no aquí). Mientras tanto, lookup filtra por expires_at en el momento.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


PRICING_CACHE_COLLECTION = "partida_pricing_cache"
PRICING_CACHE_TTL_DAYS = 90
PRICING_CACHE_CONFIDENCE_THRESHOLD = 0.85


_WHITESPACE_RE = re.compile(r"\s+", re.UNICODE)


def normalize_for_hash(text: Optional[str]) -> str:
    """Normaliza un texto para uso en el hash de cache.

    - lowercase
    - colapsar todos los whitespace internos a un único espacio
    - strip al principio/final

    Mantiene diacríticos (ñ, á, ç…) y signos de puntuación que sí cargan
    información semántica en construcción (HM-20 vs HM-25, e=15cm).
    """
    if not text:
        return ""
    lowered = text.lower()
    return _WHITESPACE_RE.sub(" ", lowered).strip()


def compute_partida_hash(description: Optional[str], unit: Optional[str]) -> str:
    """Hash sha256 hex de la pareja (description, unit) normalizada.

    Determinista, case-insensitive, whitespace-insensitive.
    """
    desc = normalize_for_hash(description)
    u = normalize_for_hash(unit)
    payload = f"{desc}|{u}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


@dataclass
class PricingCacheHit:
    """Resultado de un cache hit, devuelto por `PricingCache.lookup`."""

    hash: str
    partida: Dict[str, Any]
    confidence_score: float
    match_kind: str
    hits_count: int
    cache_hit: bool = True


class PricingCache:
    """Caché de pricing por hash sobre Firestore.

    Uso típico (desde `SwarmPricingService.evaluate_batch`):

        for item in items:
            hit = await cache.lookup(item.description, item.unit)
            if hit is not None:
                # short-circuit: usar hit.partida sin llamar al LLM.
                ...
                continue
            ...
            partida = await self._price_item_via_llm(item)
            await cache.persist(
                description=item.description, unit=item.unit,
                partida=partida.model_dump(),
                confidence_score=match_score,
                match_kind=partida.match_kind or "1:1",
            )
    """

    def __init__(
        self,
        db: Any,
        *,
        collection: str = PRICING_CACHE_COLLECTION,
        ttl_days: int = PRICING_CACHE_TTL_DAYS,
        confidence_threshold: float = PRICING_CACHE_CONFIDENCE_THRESHOLD,
    ):
        self.db = db
        self.collection = collection
        self.ttl_days = ttl_days
        self.confidence_threshold = confidence_threshold

    def _doc_ref(self, hash_: str):
        return self.db.collection(self.collection).document(hash_)

    async def lookup(
        self,
        *,
        description: Optional[str],
        unit: Optional[str],
    ) -> Optional[PricingCacheHit]:
        """Busca un hit confiable y no expirado para la pareja desc+unit.

        Devuelve ``None`` cuando:
          - el doc no existe;
          - el ``confidence_score`` es < threshold;
          - el ``expires_at`` ya pasó.

        Side-effects (solo si hay hit válido):
          - incrementa ``hits_count``
          - refresca ``last_used`` al now
        """
        h = compute_partida_hash(description, unit)
        try:
            # firebase-admin firestore client es síncrono; envolvemos en thread
            # para no bloquear el event loop y devolver una coroutine awaitable.
            snap = await asyncio.to_thread(self._doc_ref(h).get)
        except Exception as e:
            logger.warning(f"[PricingCache] lookup get failed for {h[:8]}: {e}")
            return None
        if not snap.exists:
            return None
        data = snap.to_dict() or {}

        # Threshold check.
        confidence = float(data.get("confidence_score") or 0.0)
        if confidence < self.confidence_threshold:
            return None

        # TTL check.
        expires_str = data.get("expires_at")
        if expires_str:
            try:
                expires = datetime.fromisoformat(expires_str)
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) >= expires:
                    return None
            except (ValueError, TypeError):
                # Fechas malformadas → tratamos como no-hit (defensivo).
                return None

        # Side-effects: bump hits_count + last_used.
        new_hits = int(data.get("hits_count") or 0) + 1
        try:
            await asyncio.to_thread(
                self._doc_ref(h).update,
                {
                    "hits_count": new_hits,
                    "last_used": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception as e:
            # No-fatal: el hit es válido aunque el side-effect falle.
            logger.warning(f"[PricingCache] hit update failed for {h[:8]}: {e}")

        return PricingCacheHit(
            hash=h,
            partida=data.get("resolved_partida") or {},
            confidence_score=confidence,
            match_kind=str(data.get("match_kind") or ""),
            hits_count=new_hits,
        )

    async def persist(
        self,
        *,
        description: Optional[str],
        unit: Optional[str],
        partida: Dict[str, Any],
        confidence_score: float,
        match_kind: str,
    ) -> bool:
        """Persiste una resolución en la caché.

        No persiste si ``confidence_score`` < threshold (no aporta valor —
        un futuro lookup la rechazaría de todos modos).

        Si el hash ya existe (mismas desc+unit canonicalized), incrementa
        ``hits_count`` y refresca ``last_used`` + ``expires_at`` (rolling).
        No reescribe ``resolved_partida`` salvo que la nueva venga con
        mayor confidence.

        Devuelve True si se escribió (o actualizó), False si se rechazó.
        """
        if confidence_score < self.confidence_threshold:
            return False
        h = compute_partida_hash(description, unit)
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=self.ttl_days)

        # Reaprovecha el hash si ya existe.
        try:
            existing = await asyncio.to_thread(self._doc_ref(h).get)
        except Exception as e:
            logger.warning(f"[PricingCache] persist get failed for {h[:8]}: {e}")
            existing = None

        if existing is not None and existing.exists:
            old = existing.to_dict() or {}
            new_hits = int(old.get("hits_count") or 0) + 1
            update_payload: Dict[str, Any] = {
                "hits_count": new_hits,
                "last_used": now.isoformat(),
                "expires_at": expires_at.isoformat(),
            }
            # Si la nueva tiene mejor confidence, reemplazamos la resolución.
            if confidence_score > float(old.get("confidence_score") or 0.0):
                update_payload.update({
                    "resolved_partida": partida,
                    "confidence_score": confidence_score,
                    "match_kind": match_kind,
                })
            try:
                await asyncio.to_thread(self._doc_ref(h).update, update_payload)
            except Exception as e:
                logger.warning(f"[PricingCache] persist update failed for {h[:8]}: {e}")
                return False
            return True

        # Nuevo doc.
        payload = {
            "hash": h,
            "normalized_description": normalize_for_hash(description),
            "normalized_unit": normalize_for_hash(unit),
            "resolved_partida": partida,
            "match_kind": match_kind,
            "confidence_score": confidence_score,
            "hits_count": 1,
            "first_seen": now.isoformat(),
            "last_used": now.isoformat(),
            "expires_at": expires_at.isoformat(),
        }
        try:
            await asyncio.to_thread(self._doc_ref(h).set, payload)
        except Exception as e:
            logger.warning(f"[PricingCache] persist set failed for {h[:8]}: {e}")
            return False
        return True

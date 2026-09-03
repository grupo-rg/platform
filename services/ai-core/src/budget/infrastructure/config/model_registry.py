"""Configurable model registry reader — Python half of spec §08 "Phase 0".

Single source of truth for which Gemini model each *role* runs. Reads
``model_registry/{role}`` documents from Firestore (admin SDK, the same
credentials already used by ``PricingCache`` / ``CalibrationService``) and
resolves the model id per role. The Python swarm only needs three roles:

  - ``pricing_flash``  → default ``gemini-2.5-flash``
  - ``pricing_pro``    → default ``gemini-2.5-pro``
  - ``embedding``      → default ``gemini-embedding-001`` (outputDimensionality 768)

Contract (identical to ``CalibrationService`` — AI-first, never hard-fail):

  * **TTL cache (~60s).** Hot paths (per-item pricing) don't hit Firestore on
    every call; the resolved config is cached per role for ``_CACHE_TTL_SECONDS``.
  * **Non-fatal fallback.** On missing doc / ``enabled == False`` / unparseable
    / any Firestore error → return the CODE DEFAULT for that role and log. The
    pipeline never raises because the registry is misconfigured or unreachable.

**Phase 0 = ZERO behavior change:** the code defaults are the CURRENT ids, so
with no ``model_registry`` document present the resolved ids are byte-identical
to today's hardcoded ``MODEL_FLASH`` / ``MODEL_PRO`` / ``_MODEL`` constants.

Shared schema (the Node side writes/seeds the SAME collection):
``model_registry/{role}`` → ``{ modelId, provider, region, params
(incl. outputDimensionality), enabled, fallbackModelId }``.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field, replace
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


# --- Firestore location ------------------------------------------------------
MODEL_REGISTRY_COLLECTION = "model_registry"

# Process-level cache TTL. A UI change takes up to this long to propagate (and
# is per-process on Cloud Run) — acceptable for a config swap; keeps per-call
# Firestore reads off the pricing hot path.
_CACHE_TTL_SECONDS: float = 60.0


@dataclass(frozen=True)
class ModelConfig:
    """Resolved model selection for a role.

    ``params`` carries the role-appropriate subset from the doc (e.g.
    ``outputDimensionality`` for the embedding role). ``enabled`` is always
    ``True`` on the returned config: a disabled doc resolves to the code
    default (which is enabled), so callers never see a disabled selection.
    """

    model_id: str
    provider: str = "vertexai"
    region: str = "europe-southwest1"
    params: Dict[str, Any] = field(default_factory=dict)
    enabled: bool = True


# --- CODE DEFAULTS (the CURRENT ids — Phase 0 fallback, never invalid) --------
# These MUST equal the constants the call sites keep locally
# (``MODEL_FLASH`` / ``MODEL_PRO`` / ``_MODEL``); they are the fallback used
# whenever the registry doc is absent, disabled, unparseable, or unreachable.
_CODE_DEFAULTS: Dict[str, ModelConfig] = {
    "pricing_flash": ModelConfig(model_id="gemini-2.5-flash"),
    "pricing_pro": ModelConfig(model_id="gemini-2.5-pro"),
    "embedding": ModelConfig(
        model_id="gemini-embedding-001",
        params={"outputDimensionality": 768},
    ),
}


# --- TTL cache + optional injected client (tests) ----------------------------
_cache_lock = threading.Lock()
_cache: Dict[str, Tuple[float, ModelConfig]] = {}
_injected_db: Any = None  # set by _set_db_for_testing; None → live admin client


def _now() -> float:
    return time.monotonic()


def _code_default(role: str, default_model_id: Optional[str]) -> ModelConfig:
    """Code default for ``role``.

    ``default_model_id``, when supplied by the call site, overrides the built-in
    default id so the call site's own constant stays the authoritative fallback
    (keeps ``MODEL_FLASH`` / ``MODEL_PRO`` / ``_MODEL`` load-bearing).
    """
    base = _CODE_DEFAULTS.get(role)
    if base is None:
        # Unknown role: only reachable if a caller invents a role. Never raise.
        return ModelConfig(model_id=default_model_id or "gemini-2.5-flash")
    if default_model_id and default_model_id != base.model_id:
        return replace(base, model_id=default_model_id)
    return base


def _get_db() -> Any:
    """Return a synchronous Firestore admin client, or ``None`` if unavailable.

    Mirrors the lazy pattern used across the service
    (``db if db is not None else firestore.client()``). Returns ``None`` when
    the Firebase Admin app is not initialised (e.g. unit tests) so the reader
    falls back to code defaults without touching the network.
    """
    if _injected_db is not None:
        return _injected_db
    try:
        import firebase_admin

        if not firebase_admin._apps:  # noqa: SLF001 — same check as init_firebase_admin
            return None
        from firebase_admin import firestore

        return firestore.client()
    except Exception:  # pragma: no cover - defensive; treated as "no client"
        return None


def _parse(role: str, data: Dict[str, Any], default: ModelConfig) -> ModelConfig:
    """Parse a ``model_registry/{role}`` document into a ``ModelConfig``.

    Any config problem (disabled, missing/blank ``modelId``) → code default.
    """
    if data.get("enabled") is False:
        logger.warning(
            "[model_registry] role=%s is enabled=false; using code default %s",
            role, default.model_id,
        )
        return default

    model_id = data.get("modelId")
    if not isinstance(model_id, str) or not model_id.strip():
        logger.warning(
            "[model_registry] role=%s has invalid modelId=%r; using code default %s",
            role, model_id, default.model_id,
        )
        return default

    provider = data.get("provider")
    region = data.get("region")
    params = data.get("params")
    return ModelConfig(
        model_id=model_id.strip(),
        provider=str(provider) if provider else default.provider,
        region=str(region) if region else default.region,
        params=dict(params) if isinstance(params, dict) else dict(default.params),
        enabled=True,
    )


def _resolve_from_firestore(role: str, default: ModelConfig) -> ModelConfig:
    try:
        db = _get_db()
        if db is None:
            # No admin app (tests / not-yet-initialised) → code default, no I/O.
            return default
        snap = db.collection(MODEL_REGISTRY_COLLECTION).document(role).get()
    except Exception as e:
        logger.warning(
            "[model_registry] Firestore read failed for role=%s (%s: %s); "
            "using code default %s",
            role, type(e).__name__, e, default.model_id,
        )
        return default

    try:
        if snap is not None and getattr(snap, "exists", False):
            return _parse(role, snap.to_dict() or {}, default)
        # Doc absent → code default (normal in Phase 0 before seeding).
        logger.debug(
            "[model_registry] role=%s doc absent; using code default %s",
            role, default.model_id,
        )
        return default
    except Exception as e:  # pragma: no cover - defensive parse guard
        logger.warning(
            "[model_registry] parse failed for role=%s (%s: %s); "
            "using code default %s",
            role, type(e).__name__, e, default.model_id,
        )
        return default


def get_model(role: str, *, default_model_id: Optional[str] = None) -> ModelConfig:
    """Resolve the ``ModelConfig`` for ``role`` from ``model_registry/{role}``.

    TTL-cached (~60s) and non-fatal: any missing/disabled/unparseable doc or
    Firestore error yields the code default for ``role``. ``default_model_id``
    lets a call site pin its own constant as the fallback id (Phase 0 keeps the
    existing ``MODEL_FLASH`` / ``MODEL_PRO`` / ``_MODEL`` constants that way).
    """
    now = _now()
    with _cache_lock:
        cached = _cache.get(role)
        if cached is not None and (now - cached[0]) < _CACHE_TTL_SECONDS:
            return cached[1]

    default = _code_default(role, default_model_id)
    cfg = _resolve_from_firestore(role, default)

    with _cache_lock:
        _cache[role] = (now, cfg)
    return cfg


def reset_cache() -> None:
    """Clear the TTL cache. Primarily for tests and manual cache-bust on save."""
    with _cache_lock:
        _cache.clear()


def _set_db_for_testing(db: Any) -> None:
    """Inject a fake/sync Firestore client and reset the cache (tests only)."""
    global _injected_db
    _injected_db = db
    reset_cache()

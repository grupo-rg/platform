"""Price calibration reader — "catálogo → constructor real" factor.

Los precios del catálogo (BC3/COAATMCA) correlacionan bien con los de un
constructor real, pero el constructor factura ~1.7× el catálogo de media, y
~1.3–2.1× por capítulo. Este módulo lee una tabla de factores configurable
(``calibration_factors/default`` en Firestore, editable por el owner) y expone
el factor *efectivo* por capítulo que el pricer aplica al PEM (pre-markup).

Diseño AI-First (spec §4/§5/§8):
  - **0 samples / capítulo desconocido / nombre de capítulo poco fiable** → cae
    al factor global; nunca inventa un número por capítulo de la nada.
  - **Guarda de min-samples** (default 8): ``learned_factor`` sólo se aplica con
    ``sample_count >= guard.min_samples``; por debajo se usa ``manual_factor`` /
    seed / global.
  - **Clamp de lectura** a ``[clamp_min, clamp_max]`` (default [0.8, 2.6]), defensa
    en profundidad además del clamp de escritura.
  - **Fallback a CODE DEFAULTS NEUTROS** si el doc de Firestore falta o no se
    puede leer (global 1.0, sin seeds por capítulo, guard 8, clamp [0.8, 2.6])
    — no-fatal; nunca aplica un factor oculto (los seeds 1.36/1.42 viven en el
    doc sembrado, visibles para el owner).

Valores al nivel **raw-PEM** (pre GG+BI), consistente con el orden de
operaciones del pricer (spec §2): ``PVP = catálogo × calibración × markup × IVA``.
"""
from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


# --- Firestore location ------------------------------------------------------
CALIBRATION_COLLECTION = "calibration_factors"
CALIBRATION_DOC_ID = "default"


# --- CODE DEFAULTS (cold-start, spec §7 + invariante "nada oculto" §8) -------
# Se usan SÓLO cuando el doc de Firestore falta / no se puede leer / parsear.
# Son NEUTROS a propósito: global 1.0 y sin seeds por capítulo. Los valores con
# evidencia (global 1.36 = 1.7 all-in / 1.25 markup; DEMOLICIONES 1.42) viven
# EXCLUSIVAMENTE en el doc sembrado (src/scripts/seed-calibration-factors.ts),
# que el owner ve y edita en la UI. Así el pricer nunca aplica un factor ≠ 1.0
# que el owner no pueda ver — si el seed no se ha corrido, la calibración es un
# no-op (paridad con el default neutro del stack Node, defaultCalibrationFactors).
DEFAULT_GLOBAL_FACTOR = 1.0
DEFAULT_GLOBAL_SOURCE = "seed"
DEFAULT_GLOBAL_SAMPLE_COUNT = 0
DEFAULT_GUARD_MIN_SAMPLES = 8
DEFAULT_CLAMP_MIN = 0.8
DEFAULT_CLAMP_MAX = 2.6
# Sin seeds por capítulo en CODE DEFAULTS (viven en el doc sembrado, visibles).
DEFAULT_CHAPTER_SEEDS: Dict[str, Dict[str, Any]] = {}


# Marcadores de alucinación — espejo del predicado inline de
# ``swarm_pricing_service._derive_structural_filters`` (líneas 431-437). Se
# mantienen en sync a propósito: un nombre de capítulo con estos marcadores no
# aporta señal y cae al factor global.
_HALLUCINATION_MARKERS: Tuple[str, ...] = (
    "[", "NOT FOUND", "NO ESPECIFICADO", "NO IDENTIFICADO",
    "NO ENCONTRADO", "UNKNOWN", "UNDEFINED",
)


def normalize_chapter_key(chapter: Optional[str]) -> str:
    """Clave normalizada del capítulo: ``strip().upper()``.

    Idempotente y alineada con la salida de ``stabilize_chapter_name`` /
    ``_normalize_chapter`` (UPPERCASE + strip), que es cómo se keyean las
    entradas de ``chapters`` en el doc de Firestore.
    """
    return str(chapter or "").strip().upper()


def _low_confidence_chapters() -> set:
    """Reusa el set autoritativo ``_LOW_CONFIDENCE_CHAPTERS`` del swarm.

    Import perezoso a propósito: ``swarm_pricing_service`` importa este módulo
    a nivel de módulo, así que un import recíproco a nivel de módulo sería
    circular. Cuando ``effective_factor`` se ejecuta, el swarm ya está cargado
    (o se carga on-demand en tests), así que el import es barato.
    """
    try:
        from src.budget.application.services.swarm_pricing_service import (
            _LOW_CONFIDENCE_CHAPTERS,
        )
        return _LOW_CONFIDENCE_CHAPTERS
    except Exception:  # pragma: no cover - defensivo; el swarm siempre importa
        return set()


def is_low_confidence_chapter(chapter: Optional[str]) -> bool:
    """True si el nombre de capítulo no aporta señal fiable → usar factor global.

    Reusa el predicado de ``_derive_structural_filters``: marcadores de
    alucinación + el set ``_LOW_CONFIDENCE_CHAPTERS`` (VARIOS, GENERAL,
    SIN CAPÍTULO, [UNKNOWN]…). Un capítulo vacío también es poco fiable.
    """
    up = normalize_chapter_key(chapter)
    if not up:
        return True
    if any(marker in up for marker in _HALLUCINATION_MARKERS):
        return True
    return up in _low_confidence_chapters()


# --- Helpers -----------------------------------------------------------------
def _is_finite(x: Any) -> bool:
    try:
        return math.isfinite(float(x))
    except (TypeError, ValueError):
        return False


def _as_float(value: Any, default: float) -> float:
    if value is None:
        return default
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _as_int(value: Any, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_opt_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# --- Value objects -----------------------------------------------------------
@dataclass(frozen=True)
class EffectiveFactor:
    """Factor efectivo que el pricer lee y aplica a una partida."""
    factor: float
    source: str          # "global" | "seed" | "manual" | "learned"
    sample_count: int


@dataclass
class ChapterCalibration:
    """Factores de un capítulo (spec §4a ``chapters[<KEY>]``)."""
    factor: float = 1.0
    source: str = "seed"
    sample_count: int = 0
    learned_factor: Optional[float] = None
    manual_factor: Optional[float] = None
    manual_locked: bool = False
    clamp_min: Optional[float] = None
    clamp_max: Optional[float] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ChapterCalibration":
        d = d or {}
        return cls(
            factor=_as_float(d.get("factor"), 1.0),
            source=str(d.get("source") or "seed"),
            sample_count=_as_int(d.get("sample_count"), 0),
            learned_factor=_as_opt_float(d.get("learned_factor")),
            manual_factor=_as_opt_float(d.get("manual_factor")),
            manual_locked=bool(d.get("manual_locked", False)),
            clamp_min=_as_opt_float(d.get("clamp_min")),
            clamp_max=_as_opt_float(d.get("clamp_max")),
        )


@dataclass
class CalibrationTable:
    """Tabla de factores de calibración cargada una vez por batch.

    ``effective_factor(chapter)`` implementa la semántica §4/§5/§8: lookup por
    capítulo con fallback a global (luego 1.0), guarda de min-samples, y clamp
    de lectura.
    """
    global_factor: float = DEFAULT_GLOBAL_FACTOR
    global_source: str = DEFAULT_GLOBAL_SOURCE
    global_sample_count: int = DEFAULT_GLOBAL_SAMPLE_COUNT
    chapters: Dict[str, ChapterCalibration] = field(default_factory=dict)
    guard_min_samples: int = DEFAULT_GUARD_MIN_SAMPLES
    clamp_min: float = DEFAULT_CLAMP_MIN
    clamp_max: float = DEFAULT_CLAMP_MAX
    # Blend §5.6 (suavizado opcional al cruzar la guarda). Desactivado por
    # defecto — determinista y sin salto duro artificial en los tests.
    blend_enabled: bool = False

    # -- Construcción ---------------------------------------------------------
    @classmethod
    def code_defaults(cls) -> "CalibrationTable":
        """Tabla de CODE DEFAULTS (fallback no-fatal cuando falta el doc)."""
        chapters = {
            normalize_chapter_key(k): ChapterCalibration.from_dict(v)
            for k, v in DEFAULT_CHAPTER_SEEDS.items()
        }
        return cls(chapters=chapters)

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "CalibrationTable":
        """Parsea el doc de Firestore. Robusto: campos ausentes caen a los
        CODE DEFAULTS por campo (el doc parcial nunca rompe la lectura)."""
        data = data or {}
        g = data.get("global") or {}
        guard = data.get("guard") or {}
        chapters_raw = data.get("chapters") or {}

        chapters: Dict[str, ChapterCalibration] = {}
        if isinstance(chapters_raw, dict):
            for key, cfg in chapters_raw.items():
                if isinstance(cfg, dict):
                    chapters[normalize_chapter_key(key)] = ChapterCalibration.from_dict(cfg)

        return cls(
            global_factor=_as_float(g.get("factor"), DEFAULT_GLOBAL_FACTOR),
            global_source=str(g.get("source") or DEFAULT_GLOBAL_SOURCE),
            global_sample_count=_as_int(g.get("sample_count"), DEFAULT_GLOBAL_SAMPLE_COUNT),
            chapters=chapters,
            guard_min_samples=_as_int(guard.get("min_samples"), DEFAULT_GUARD_MIN_SAMPLES),
            clamp_min=_as_float(guard.get("clamp_min"), DEFAULT_CLAMP_MIN),
            clamp_max=_as_float(guard.get("clamp_max"), DEFAULT_CLAMP_MAX),
            blend_enabled=bool(guard.get("blend_enabled", False)),
        )

    # -- Lookup ---------------------------------------------------------------
    def _clamp(self, factor: float, chapter: Optional[ChapterCalibration] = None) -> float:
        lo, hi = self.clamp_min, self.clamp_max
        if chapter is not None:
            if chapter.clamp_min is not None:
                lo = chapter.clamp_min
            if chapter.clamp_max is not None:
                hi = chapter.clamp_max
        if hi < lo:  # config inconsistente: no rompas, respeta el mínimo
            hi = lo
        return max(lo, min(hi, factor))

    def _global_effective(self) -> EffectiveFactor:
        base = self.global_factor if _is_finite(self.global_factor) else 1.0
        return EffectiveFactor(
            factor=self._clamp(base),
            source="global",
            sample_count=self.global_sample_count,
        )

    def effective_factor(self, chapter: Optional[str]) -> EffectiveFactor:
        """Devuelve el ``EffectiveFactor`` para un capítulo.

        Reglas (spec §4/§5/§8):
          1. Capítulo poco fiable / alucinado / vacío → factor **global**.
          2. Capítulo no presente en la tabla → factor **global**.
          3. Presente:
             - ``manual_locked`` con ``manual_factor`` → siempre manual.
             - ``sample_count >= guard`` y hay ``learned_factor`` → learned
               (con blend opcional §5.6).
             - en otro caso (por debajo de la guarda) → ``manual_factor``, si
               no hay, ``factor`` almacenado; si tampoco, global.
          4. Clamp de lectura a ``[clamp_min, clamp_max]`` (override por capítulo).
        """
        if is_low_confidence_chapter(chapter):
            return self._global_effective()

        key = normalize_chapter_key(chapter)
        ch = self.chapters.get(key)
        if ch is None:
            return self._global_effective()

        n = int(ch.sample_count or 0)
        guard = int(self.guard_min_samples)

        if ch.manual_locked and ch.manual_factor is not None:
            raw = ch.manual_factor
            source = "manual"
        elif n >= guard and ch.learned_factor is not None and _is_finite(ch.learned_factor):
            raw = float(ch.learned_factor)
            source = "learned"
            # Blend §5.6 (opcional): suaviza el salto justo al cruzar la guarda.
            if self.blend_enabled and n < 3 * guard and guard > 0:
                w = (n - guard) / (2.0 * guard)
                raw = w * raw + (1.0 - w) * self.global_factor
        else:
            # Por debajo de la guarda (o sin learned): manual → seed/stored → global.
            if ch.manual_factor is not None and _is_finite(ch.manual_factor):
                raw = float(ch.manual_factor)
            elif _is_finite(ch.factor) and ch.factor > 0:
                raw = float(ch.factor)
            else:
                return self._global_effective()
            source = ch.source or "seed"

        return EffectiveFactor(
            factor=self._clamp(raw, ch),
            source=source,
            sample_count=n,
        )


# --- Loader (admin SDK) ------------------------------------------------------
class CalibrationService:
    """Carga la ``CalibrationTable`` desde Firestore vía el admin SDK.

    Mismo patrón que ``PricingCache``: ``db`` (firebase-admin firestore client,
    síncrono) se inyecta y las lecturas se envuelven en ``asyncio.to_thread``.
    La tabla se carga **una vez por batch** desde ``SwarmPricingService``.

    Semántica no-fatal / AI-First: si el doc no existe o Firestore no responde,
    devuelve ``CalibrationTable.code_defaults()`` NEUTROS (global 1.0, sin seeds
    por capítulo, guard 8, clamp [0.8, 2.6]) — la calibración queda como no-op
    hasta que el seed/owner escriba el doc (nunca aplica un factor oculto).
    """

    def __init__(
        self,
        db: Any,
        *,
        collection: str = CALIBRATION_COLLECTION,
        doc_id: str = CALIBRATION_DOC_ID,
    ):
        self.db = db
        self.collection = collection
        self.doc_id = doc_id

    def _doc_ref(self):
        return self.db.collection(self.collection).document(self.doc_id)

    async def load(self) -> CalibrationTable:
        try:
            snap = await asyncio.to_thread(self._doc_ref().get)
        except Exception as e:
            logger.warning(
                "[calibration] Firestore read failed (%s: %s); using code defaults",
                type(e).__name__, e,
            )
            return CalibrationTable.code_defaults()

        try:
            if snap is not None and getattr(snap, "exists", False):
                return CalibrationTable.from_dict(snap.to_dict() or {})
        except Exception as e:  # pragma: no cover - parse defensivo
            logger.warning(
                "[calibration] parse failed (%s: %s); using code defaults",
                type(e).__name__, e,
            )
        # Doc ausente → CODE DEFAULTS.
        return CalibrationTable.code_defaults()

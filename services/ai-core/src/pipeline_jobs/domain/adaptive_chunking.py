"""S2-A-04 — Adaptive chunking domain service.

Reglas:
  - ≤500 items → un único job (camino actual).
  - >500 items → split por capítulo en sub-jobs de ≤200 items.
  - >2000 items → JobTooLargeError (señal de PDF mal extraído).
  - Partidas con chapter `[UNKNOWN]`, `VARIOS` o vacío van a un sub-job
    "uncategorized" procesado al final (queremos que los chunks con
    contexto fuerte se procesen primero).

El servicio toma una lista de partidas como dicts (genéricos: solo lee
`code` y `chapter`) y devuelve `List[ChunkDefinition]`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence


# Thresholds — exposable como env vars en el futuro si emerge la necesidad.
SINGLE_JOB_MAX_ITEMS: int = 500
SUB_JOB_MAX_ITEMS: int = 200
ABSOLUTE_MAX_ITEMS: int = 2000

# Markers que tratamos como "sin capítulo asignado".
UNCATEGORIZED_MARKERS: frozenset = frozenset({
    "",
    "VARIOS",
    "[UNKNOWN]",
    "UNKNOWN",
    "SIN CAPÍTULO",
    "SIN CAPITULO",
    "—",
    "-",
})


@dataclass(frozen=True)
class ChunkDefinition:
    """Descripción de un chunk a ejecutar como sub-job.

    - `chunk_index`: índice 0-based dentro del job parent.
    - `chunk_total`: total de chunks del job parent.
    - `chapter`: capítulo principal del chunk (o "uncategorized").
    - `partida_codes`: códigos de partidas que entran a este chunk.
      El runner usará estos códigos para filtrar el conjunto completo
      antes de pasarlo al swarm.
    """
    chunk_index: int
    chunk_total: int
    chapter: str
    partida_codes: List[str] = field(default_factory=list)


def _normalize_chapter(raw: Optional[str]) -> str:
    """Mayúsculas + strip. Vacío si None."""
    if not raw:
        return ""
    return str(raw).strip().upper()


def _is_uncategorized(chapter_norm: str) -> bool:
    if chapter_norm in UNCATEGORIZED_MARKERS:
        return True
    # Cualquier chapter que contenga "[" o "UNKNOWN" lo tratamos como tal.
    if "[" in chapter_norm and "]" in chapter_norm:
        return True
    if "UNKNOWN" in chapter_norm:
        return True
    return False


def plan_chunks(
    items: Sequence[Dict[str, Any]],
    *,
    single_job_max: int = SINGLE_JOB_MAX_ITEMS,
    sub_job_max: int = SUB_JOB_MAX_ITEMS,
    absolute_max: int = ABSOLUTE_MAX_ITEMS,
) -> List[ChunkDefinition]:
    """Planifica los chunks para una lista de items.

    Args:
      items: lista de dicts con al menos `code` y `chapter`.
      single_job_max: umbral por debajo del cual NO se chunkea.
      sub_job_max: tamaño máximo de cada sub-chunk.
      absolute_max: cap absoluto. Si los items superan esto, raise.

    Returns:
      Lista de ChunkDefinition. Si `len(items) <= single_job_max`,
      devuelve un único chunk con TODOS los codes.

    Raises:
      JobTooLargeError si `len(items) > absolute_max`.
    """
    # Import local para evitar ciclos con tests que importan exceptions.
    from src.pipeline_jobs.domain.exceptions import JobTooLargeError

    if not items:
        return []

    if len(items) > absolute_max:
        raise JobTooLargeError(
            f"Budget tiene {len(items)} partidas — supera el cap absoluto de "
            f"{absolute_max}. Probable causa: extracción duplicada o PDF mal "
            f"formateado. Revisar manualmente antes de re-correr."
        )

    # Path single-job: bajo el threshold, todo en uno.
    if len(items) <= single_job_max:
        codes = [str(it.get("code") or "") for it in items]
        return [
            ChunkDefinition(
                chunk_index=0,
                chunk_total=1,
                chapter="(all)",
                partida_codes=codes,
            )
        ]

    # Split por capítulo. Preservamos el orden de aparición (estable).
    by_chapter: Dict[str, List[str]] = {}
    chapter_order: List[str] = []
    uncategorized_codes: List[str] = []

    for it in items:
        code = str(it.get("code") or "")
        if not code:
            continue
        ch_norm = _normalize_chapter(it.get("chapter"))
        if _is_uncategorized(ch_norm):
            uncategorized_codes.append(code)
            continue
        # Usamos el chapter normalizado como clave; preservamos un alias del
        # original (primer encuentro) para los tests/diagnóstico.
        if ch_norm not in by_chapter:
            by_chapter[ch_norm] = []
            chapter_order.append(ch_norm)
        by_chapter[ch_norm].append(code)

    # Construimos los chunks: por cada capítulo, partimos si supera sub_job_max.
    chunks: List[ChunkDefinition] = []
    for ch in chapter_order:
        codes = by_chapter[ch]
        if len(codes) <= sub_job_max:
            chunks.append(
                ChunkDefinition(
                    chunk_index=0,  # se reescribe al final con total real
                    chunk_total=0,
                    chapter=ch,
                    partida_codes=codes,
                )
            )
        else:
            # Capítulo gigante: partir intra-capítulo en sub-chunks.
            for i in range(0, len(codes), sub_job_max):
                window = codes[i:i + sub_job_max]
                # Sufijo para distinguir las partes (1/3, 2/3, 3/3).
                chunks.append(
                    ChunkDefinition(
                        chunk_index=0,
                        chunk_total=0,
                        chapter=f"{ch} (parte {i // sub_job_max + 1})",
                        partida_codes=window,
                    )
                )

    # Chunks "uncategorized" se procesan al final. Si son muchos, los
    # también partimos en sub_job_max.
    if uncategorized_codes:
        for i in range(0, len(uncategorized_codes), sub_job_max):
            window = uncategorized_codes[i:i + sub_job_max]
            suffix = f" (parte {i // sub_job_max + 1})" if len(uncategorized_codes) > sub_job_max else ""
            chunks.append(
                ChunkDefinition(
                    chunk_index=0,
                    chunk_total=0,
                    chapter=f"uncategorized{suffix}",
                    partida_codes=window,
                )
            )

    # Reescribimos chunk_index y chunk_total con el total real.
    total = len(chunks)
    return [
        ChunkDefinition(
            chunk_index=idx,
            chunk_total=total,
            chapter=ch.chapter,
            partida_codes=ch.partida_codes,
        )
        for idx, ch in enumerate(chunks)
    ]

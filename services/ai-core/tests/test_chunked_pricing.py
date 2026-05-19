"""S2-A-04 — Cap absoluto + adaptive chunking.

Reglas:
  - ≤500 items → un único job.
  - >500 items → split por capítulo en sub-jobs de ≤200 items.
  - >2000 items → JobTooLargeError.
  - Partidas con chapter `[UNKNOWN]`, `VARIOS` o vacío van a un sub-job
    "uncategorized" al final.

Estos tests son puros sobre `plan_chunks`. La orquestación de sub-jobs
(crear sub-PipelineJob, dispatcher) queda para integración en Agent B
quien consume `chunk_index`/`chunk_total`/`parent_job_id` desde la API.
"""
from __future__ import annotations

import pytest

from src.pipeline_jobs.domain.adaptive_chunking import (
    ABSOLUTE_MAX_ITEMS,
    SINGLE_JOB_MAX_ITEMS,
    SUB_JOB_MAX_ITEMS,
    ChunkDefinition,
    plan_chunks,
)
from src.pipeline_jobs.domain.entities import JobType, PipelineJob
from src.pipeline_jobs.domain.exceptions import JobTooLargeError


def _make_item(code: str, chapter: str = "C01") -> dict:
    return {"code": code, "chapter": chapter}


# ---- Single job path (≤500 items) -----------------------------------------


def test_plan_chunks_empty_returns_empty():
    """Sin items → sin chunks."""
    assert plan_chunks([]) == []


def test_plan_chunks_single_job_below_threshold():
    """Con 100 items y 3 capítulos, NO se chunkea: un solo chunk."""
    items = []
    for ch in ["C01", "C02", "C03"]:
        for i in range(33):
            items.append(_make_item(f"{ch}.{i}", chapter=ch))
    items.append(_make_item("EXTRA.1", "C01"))  # total 100
    chunks = plan_chunks(items)
    assert len(chunks) == 1
    assert chunks[0].chunk_index == 0
    assert chunks[0].chunk_total == 1
    assert chunks[0].chapter == "(all)"
    assert len(chunks[0].partida_codes) == 100


def test_plan_chunks_500_items_still_single():
    """Exactamente 500 items = aún single-job (umbral inclusive)."""
    items = [_make_item(f"X.{i}", chapter="C01") for i in range(500)]
    chunks = plan_chunks(items)
    assert len(chunks) == 1


# ---- Chunked path (501..2000 items) ----------------------------------------


def test_plan_chunks_600_items_3_chapters_produces_3_subjobs():
    """PDF mock 600 partidas en 3 capítulos de 200 c/u → 3 sub-jobs."""
    items = []
    for ch in ["C01 TRABAJOS PREVIOS", "C02 ALBAÑILERIA", "C03 SOLADOS"]:
        for i in range(200):
            items.append(_make_item(f"{ch[:3]}.{i}", chapter=ch))
    chunks = plan_chunks(items)
    assert len(chunks) == 3
    # Cada chunk lleva los 200 de su capítulo.
    for c in chunks:
        assert len(c.partida_codes) == 200
        assert c.chunk_total == 3
    # Los chunk_index son 0, 1, 2.
    assert [c.chunk_index for c in chunks] == [0, 1, 2]


def test_plan_chunks_1200_items_with_oversized_chapter_splits_intra():
    """Si un capítulo tiene >200 items, se parte intra-capítulo en partes."""
    items = []
    # 600 items en C01 (debe partirse en 3 sub-chunks de 200).
    for i in range(600):
        items.append(_make_item(f"C01.{i}", chapter="C01 ALBAÑILERIA"))
    # 600 items en C02 (también 3 sub-chunks).
    for i in range(600):
        items.append(_make_item(f"C02.{i}", chapter="C02 ESTRUCTURAS"))

    chunks = plan_chunks(items)
    assert len(chunks) == 6
    for c in chunks:
        assert len(c.partida_codes) <= SUB_JOB_MAX_ITEMS
    # Los chapters tienen sufijo " (parte X)".
    chapter_names = [c.chapter for c in chunks]
    assert any("parte 1" in n for n in chapter_names)
    assert any("parte 2" in n for n in chapter_names)
    assert any("parte 3" in n for n in chapter_names)


def test_plan_chunks_2000_items_at_absolute_cap_works():
    """2000 items exactos = OK (cap inclusivo en >2000 → raise)."""
    items = [_make_item(f"X.{i}", chapter=f"C{i // 100}") for i in range(2000)]
    chunks = plan_chunks(items)
    assert len(chunks) > 1  # se chunkea
    # Suma de codes == 2000.
    total = sum(len(c.partida_codes) for c in chunks)
    assert total == 2000


def test_plan_chunks_2001_items_raises():
    """>2000 items → JobTooLargeError con mensaje claro."""
    items = [_make_item(f"X.{i}", chapter="C01") for i in range(2001)]
    with pytest.raises(JobTooLargeError) as exc:
        plan_chunks(items)
    assert "2001" in str(exc.value)
    assert "2000" in str(exc.value)


# ---- Uncategorized chunk --------------------------------------------------


def test_plan_chunks_unknown_chapter_goes_to_uncategorized_at_end():
    """Partidas con chapter `[UNKNOWN]` o `VARIOS` van al chunk especial."""
    items = []
    for i in range(200):
        items.append(_make_item(f"C01.{i}", chapter="C01 ALBAÑILERIA"))
    for i in range(200):
        items.append(_make_item(f"C02.{i}", chapter="C02 ESTRUCTURAS"))
    for i in range(100):
        items.append(_make_item(f"C03.{i}", chapter="C03 SOLADOS"))
    for i in range(50):
        items.append(_make_item(f"VAR.{i}", chapter="[UNKNOWN]"))
    for i in range(50):
        items.append(_make_item(f"VAR2.{i}", chapter="VARIOS"))

    chunks = plan_chunks(items)
    # Total = 600 > 500 → se chunkea.
    assert len(chunks) > 1
    # El último chunk debe ser `uncategorized`.
    assert chunks[-1].chapter.startswith("uncategorized")
    # Y contiene los 100 huérfanos.
    assert len(chunks[-1].partida_codes) == 100


def test_plan_chunks_empty_chapter_goes_to_uncategorized():
    """Items con chapter vacío también van al uncategorized."""
    items = []
    for i in range(200):
        items.append(_make_item(f"C01.{i}", chapter="C01"))
    for i in range(150):
        items.append(_make_item(f"C02.{i}", chapter="C02"))
    for i in range(200):
        items.append(_make_item(f"X.{i}", chapter=""))  # vacío

    chunks = plan_chunks(items)
    # El último chunk es `uncategorized` (o uncategorized parte X).
    assert any("uncategorized" in c.chapter for c in chunks)


def test_plan_chunks_only_uncategorized():
    """Si todas las partidas son uncategorized, va un solo chunk especial."""
    items = [_make_item(f"X.{i}", chapter="VARIOS") for i in range(600)]
    chunks = plan_chunks(items)
    assert len(chunks) == 3  # 600 / 200 = 3 sub-chunks
    for c in chunks:
        assert c.chapter.startswith("uncategorized")


def test_plan_chunks_100_items_no_chunking_even_with_unknowns():
    """Con ≤500 items, NO se chunkea aunque algunos sean uncategorized."""
    items = []
    for i in range(50):
        items.append(_make_item(f"C01.{i}", chapter="C01"))
    for i in range(50):
        items.append(_make_item(f"X.{i}", chapter="[UNKNOWN]"))
    chunks = plan_chunks(items)
    assert len(chunks) == 1
    assert chunks[0].chapter == "(all)"


# ---- PipelineJob fields ----------------------------------------------------


def test_pipeline_job_new_accepts_parent_job_id_and_chunk_fields():
    """`PipelineJob.new` acepta `parent_job_id`, `chunk_index`, `chunk_total`
    (defaults a None para mantener backward-compat con el path single-job).
    """
    job = PipelineJob.new(
        jobId="sub-1",
        jobType=JobType.MEASUREMENTS,
        leadId="L",
        budgetId="B",
        uid="U",
        payload={},
        parent_job_id="parent-x",
        chunk_index=2,
        chunk_total=5,
    )
    assert job.parent_job_id == "parent-x"
    assert job.chunk_index == 2
    assert job.chunk_total == 5


def test_pipeline_job_new_defaults_to_none():
    """Sin pasar los kwargs nuevos, los 3 son None (single-job path)."""
    job = PipelineJob.new(
        jobId="solo",
        jobType=JobType.NL_BUDGET,
        leadId="L",
        budgetId="B",
        uid="U",
        payload={},
    )
    assert job.parent_job_id is None
    assert job.chunk_index is None
    assert job.chunk_total is None


# ---- Order preservation ----------------------------------------------------


def test_plan_chunks_preserves_chapter_order():
    """El orden de los chunks respeta el orden de aparición de los capítulos."""
    items = []
    # Aparición: C03 primero, luego C01, luego C02.
    for ch in ["C03 SOLADOS", "C01 TRABAJOS", "C02 ALBAÑILERIA"]:
        for i in range(200):
            items.append(_make_item(f"{ch[:3]}.{i}", chapter=ch))
    chunks = plan_chunks(items)
    assert chunks[0].chapter.startswith("C03")
    assert chunks[1].chapter.startswith("C01")
    assert chunks[2].chapter.startswith("C02")


def test_plan_chunks_codes_preserved_within_chunk():
    """Los codes dentro de un chunk preservan su orden original."""
    items = [_make_item(f"X.{i}", chapter="C01 ALBAÑILERIA") for i in range(600)]
    chunks = plan_chunks(items)
    # 600 / 200 = 3 chunks.
    assert len(chunks) == 3
    # Primer chunk: codes 0..199.
    assert chunks[0].partida_codes[0] == "X.0"
    assert chunks[0].partida_codes[-1] == "X.199"
    # Segundo chunk: codes 200..399.
    assert chunks[1].partida_codes[0] == "X.200"
    assert chunks[1].partida_codes[-1] == "X.399"
    # Tercer chunk: codes 400..599.
    assert chunks[2].partida_codes[0] == "X.400"
    assert chunks[2].partida_codes[-1] == "X.599"

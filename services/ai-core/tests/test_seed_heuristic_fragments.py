"""Tests del builder puro que produce los HeuristicFragments demo.

El script `seed_heuristic_fragments.py` es un wrapper I/O alrededor de
`build_demo_fragments()` — aquí cubrimos el builder, que es la única pieza con
lógica no trivial. El script propio (init Firebase, parser CLI) no se testea
por el mismo criterio que `seed_labor_rates_2025.py`: es un thin CLI.

Invariantes:
  1. Los fragments emiten los tags canónicos `chapter:<NAME>` + `reason:<KIND>`
     que consume `FirestoreHeuristicFragmentRepository.find_relevant`.
  2. `status='golden'` (los demo se consideran validados por el operador).
  3. El aiInferenceTrace contiene un precio razonable y la humanCorrection
     aporta un precio distinto (si no, el fragment no aportaría evidencia).
  4. El timestamp es `datetime` timezone-aware en UTC.
  5. Cada fragment tiene un id estable basado en su contenido (idempotente).
"""

from __future__ import annotations

from datetime import datetime, timezone

from src.budget.domain.entities import HeuristicFragment
from scripts.seed_heuristic_fragments import build_demo_fragments


def test_builds_at_least_two_fragments_per_reason_for_retrieval_min_count():
    """El retrieval exige min_count=2 — si los demo son 1 por motivo, no se
    activa la inyección ICL. El builder debe emitir ≥ 2 fragments para al
    menos un motivo real, con descripciones similares entre ellos."""
    frags = build_demo_fragments()
    # Agrupa por (chapter_tag, reason_tag)
    buckets: dict[tuple[str, str], int] = {}
    for f in frags:
        chapter = next((t for t in f.tags if t.startswith("chapter:")), None)
        reason = next((t for t in f.tags if t.startswith("reason:")), None)
        if chapter and reason:
            buckets[(chapter, reason)] = buckets.get((chapter, reason), 0) + 1
    assert any(count >= 2 for count in buckets.values()), (
        "Al menos un bucket (chapter, reason) debe tener ≥ 2 fragments "
        "para activar el retrieval ICL del Swarm."
    )


def test_every_fragment_has_chapter_and_reason_tags():
    for f in build_demo_fragments():
        assert any(t.startswith("chapter:") for t in f.tags), f.id
        assert any(t.startswith("reason:") for t in f.tags), f.id


def test_status_is_golden():
    for f in build_demo_fragments():
        assert f.status == "golden", f.id


def test_ai_price_differs_from_human_price():
    for f in build_demo_fragments():
        ai = f.aiInferenceTrace.proposedUnitPrice
        hum = f.humanCorrection.correctedUnitPrice
        assert hum is not None, f.id
        assert ai != hum, f"{f.id} tiene ai==hum → no aporta evidencia"


def test_timestamps_are_tz_aware_utc():
    for f in build_demo_fragments():
        assert f.timestamp.tzinfo is not None, f.id
        assert f.timestamp.tzinfo.utcoffset(f.timestamp) == timezone.utc.utcoffset(
            datetime.now(timezone.utc)
        ), f.id


def test_ids_are_stable_across_invocations():
    """Idempotencia: llamar dos veces emite los MISMOS ids → re-seed no duplica."""
    a = {f.id for f in build_demo_fragments()}
    b = {f.id for f in build_demo_fragments()}
    assert a == b


def test_returns_typed_entities_not_dicts():
    for f in build_demo_fragments():
        assert isinstance(f, HeuristicFragment), f

"""Fase 13.E — tests de los 3 fixes del retrieval de fragments.

Bugs detectados en el debug del run-4 (2026-04-27):
  1. `_has_chapter_tag` exigía match string-igualitario. Las partidas reales
     traen prefijos `CAPÍTULO 01 ` o `C02 ` antes del nombre del capítulo,
     que los tags de fragments no contienen → 0 matches.
  2. `_similarity` (SequenceMatcher.ratio) penaliza desigualdad de longitud.
     `description` de partida 250-400 chars vs `originalDescription` del
     fragment 50-80 chars → ratio cae a 0.20-0.45 aunque las palabras claves
     coincidan. El umbral de 0.70 no es alcanzable.
  3. `min_count=2` con buckets de 1 fragment cada uno → ningún bucket activa.
     Los fragments golden firmados (`sourceType='baseline_migration'`) no
     necesitan corroboración estadística.

Fixes:
  A. `_has_chapter_tag` usa substring match case-insensitive.
  B. `_similarity` devuelve `max(SequenceMatcher.ratio, token_coverage)` —
     `token_coverage` mide qué fracción de tokens del string más corto
     aparece en el más largo, robusto a desigualdad de longitud.
  C. `find_relevant` baja `min_count` a 1 cuando todos los matches tienen
     `sourceType='baseline_migration'`.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from src.budget.domain.entities import (
    HeuristicAIInferenceTrace,
    HeuristicContext,
    HeuristicFragment,
    HeuristicHumanCorrection,
)
from src.budget.learning.application._retrieval import (
    _has_chapter_tag,
    _similarity,
    filter_and_rank_fragments,
)


def _make_frag(
    *,
    fragment_id: str,
    chapter_tag: str,
    description: str,
    source_type: str = "internal_admin",
    timestamp: datetime | None = None,
) -> HeuristicFragment:
    return HeuristicFragment(
        id=fragment_id,
        sourceType=source_type,  # type: ignore[arg-type]
        status="golden",
        context=HeuristicContext(
            budgetId="b",
            originalDescription=description,
            originalQuantity=1.0,
            originalUnit="ud",
        ),
        aiInferenceTrace=HeuristicAIInferenceTrace(
            proposedUnitPrice=10.0,
            aiReasoning="x",
        ),
        humanCorrection=HeuristicHumanCorrection(
            correctedUnitPrice=15.0,
            heuristicRule="rule",
        ),
        tags=[f"chapter:{chapter_tag}"],
        timestamp=timestamp or datetime.now(timezone.utc),
    )


# -------- Fix A: chapter tag substring -----------------------------------------


def test_chapter_tag_matches_with_prefix_in_partida_chapter() -> None:
    """Partida real tiene `CAPÍTULO 01 DEFICIENCIAS IEE HENRI DUNANT`,
    fragment tag `chapter:DEFICIENCIAS IEE HENRI DUNANT` → match.
    """
    frag = _make_frag(
        fragment_id="f1",
        chapter_tag="DEFICIENCIAS IEE HENRI DUNANT",
        description="Reparación pilastras hormigón armado",
    )
    assert _has_chapter_tag(frag, "CAPÍTULO 01 DEFICIENCIAS IEE HENRI DUNANT")


def test_chapter_tag_matches_with_C_numeric_prefix() -> None:
    """Partida `C02 OBRAS VARIAS`, fragment tag `chapter:OBRAS VARIAS` → match."""
    frag = _make_frag(
        fragment_id="f2",
        chapter_tag="OBRAS VARIAS",
        description="Pintura plástica fachada",
    )
    assert _has_chapter_tag(frag, "C02 OBRAS VARIAS")


def test_chapter_tag_match_is_case_insensitive() -> None:
    frag = _make_frag(fragment_id="f3", chapter_tag="DEFICIENCIAS IEE", description="x")
    assert _has_chapter_tag(frag, "capítulo 01 deficiencias iee henri dunant")


def test_chapter_tag_does_not_match_unrelated_chapter() -> None:
    frag = _make_frag(fragment_id="f4", chapter_tag="DEMOLICIONES", description="x")
    assert not _has_chapter_tag(frag, "CAPÍTULO 02 OBRAS VARIAS")


def test_chapter_tag_still_matches_exact_legacy() -> None:
    """Compat: partidas con chapter exactamente igual al tag siguen matcheando."""
    frag = _make_frag(fragment_id="f5", chapter_tag="DEMOLICIONES", description="x")
    assert _has_chapter_tag(frag, "DEMOLICIONES")


# -------- Fix B: similarity robust to length asymmetry --------------------------


def test_similarity_with_short_fragment_inside_long_partida() -> None:
    """La descripción del fragment (≤ 80 chars) está semánticamente contenida
    en la descripción larga de la partida (≥ 250 chars). El score debe ser
    suficiente para superar 0.30.
    """
    fragment_desc = "Reparación de pilastras con saneado de armaduras y mortero"
    partida_desc = (
        "Reparación de pilastras. Reparación de pilastras mediante eliminación "
        "de revestimientos y picoteado de hormigón de recubrimiento en mal estado, "
        "dejando las armaduras al descubierto, eliminación de óxido del armado, "
        "protección con pasivador, reconstrucción con mortero de reparación."
    )
    sim = _similarity(partida_desc, fragment_desc)
    assert sim >= 0.50, f"sim={sim:.3f} demasiado bajo para fragments de Grupo RG"


def test_similarity_high_for_identical_strings() -> None:
    s = "Pintura plástica para exterior, dos manos."
    assert _similarity(s, s) == 1.0


def test_similarity_low_for_unrelated_strings() -> None:
    a = "Demolición de muro de carga"
    b = "Instalación de tomas de agua"
    sim = _similarity(a, b)
    assert sim < 0.45


# -------- Fix C: min_count=1 for baseline_migration -----------------------------


def test_baseline_migration_fragment_returned_with_count_1() -> None:
    """Un solo fragment `sourceType='baseline_migration'` cumple match → devuelto."""
    frag = _make_frag(
        fragment_id="f-eval",
        chapter_tag="DEFICIENCIAS IEE",
        description="Reparación de pilastras con saneado de armaduras",
        source_type="baseline_migration",
    )
    results = filter_and_rank_fragments(
        [frag],
        chapter="CAPÍTULO 01 DEFICIENCIAS IEE",
        description="Reparación de pilastras mediante saneado de armaduras y mortero",
        similarity_threshold=0.30,
        min_count=2,  # threshold inicial: 2 — pero baseline_migration relaja a 1
        max_age_months=12,
    )
    assert len(results) == 1
    assert results[0].id == "f-eval"


def test_internal_admin_fragment_still_requires_min_count() -> None:
    """`sourceType='internal_admin'` (capturas del editor) sigue requiriendo
    min_count para activar — evidencia repetida.
    """
    frag = _make_frag(
        fragment_id="f-admin",
        chapter_tag="DEFICIENCIAS IEE",
        description="Reparación de pilastras con saneado de armaduras",
        source_type="internal_admin",
    )
    results = filter_and_rank_fragments(
        [frag],
        chapter="CAPÍTULO 01 DEFICIENCIAS IEE",
        description="Reparación de pilastras mediante saneado de armaduras y mortero",
        similarity_threshold=0.30,
        min_count=2,
        max_age_months=12,
    )
    assert results == []


def test_mixed_baseline_and_admin_fragments_combine_correctly() -> None:
    """Si hay 1 baseline + 1 admin matching → se devuelven ambos (≥ min_count
    contando todos, y baseline relaja igual)."""
    frag_eval = _make_frag(
        fragment_id="f-eval",
        chapter_tag="DEFICIENCIAS IEE",
        description="Reparación de pilastras con saneado y mortero",
        source_type="baseline_migration",
    )
    frag_admin = _make_frag(
        fragment_id="f-admin",
        chapter_tag="DEFICIENCIAS IEE",
        description="Reparación de pilastras saneado armaduras mortero",
        source_type="internal_admin",
    )
    results = filter_and_rank_fragments(
        [frag_eval, frag_admin],
        chapter="CAPÍTULO 01 DEFICIENCIAS IEE",
        description="Reparación de pilastras mediante saneado de armaduras y mortero",
        similarity_threshold=0.30,
        min_count=2,
        max_age_months=12,
    )
    ids = {r.id for r in results}
    assert ids == {"f-eval", "f-admin"}

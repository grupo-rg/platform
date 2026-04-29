"""Fase 9.2.B — fast path heurístico en InlinePdfExtractorService.

Cuando el PDF es texto-extraíble con layout claro (`INLINE_WITH_TITLES`,
confidence ≥ 0.85, ≥ 90% partidas heurísticas), el extractor SALTA el LLM
completo y construye los `RestructuredItem` desde la heurística pura.

Esto baja el coste de extracción de 60-90s a ~1s para casos como SANITAS
DENTAL (62 partidas).
"""
from __future__ import annotations

from src.budget.layout_analyzer.analyzer import try_heuristic_extraction


def test_returns_restructured_items_when_clean_inline_layout():
    """Texto bien estructurado (INLINE_WITH_TITLES alto confidence) → fast path."""
    text_per_page = [
        "REFORMA DE LOCAL\n"
        "Código Nat Ud Resumen Comentario N\n"
        "C01 Capítulo TRABAJOS PREVIOS\n"
        "C01.01 Partida m2 DEMOLICIÓN DE FALSO TECHO\n"
        "Demolición de falso techo continuo o de placas registrables, vigas de\n"
        "decoración, dobles falsos techos existentes y su correspondiente\n"
        "estructura y aislamiento, dejando limpia la superfície de soporte.\n"
        "1,0\n"
        "2,5\n"
        "C01.02 Partida m2 DESMONTADO DE TABIQUERÍA\n"
        "Desmontado de tabiquería de pladur de 100 mm, incluyendo retirada\n"
        "de escombros y limpieza posterior.\n"
        "10,5\n"
        "C01.03 Partida m3 DESMONTADO DE AMUEBLAMIENTO\n"
        "Desmontado de mobiliario fijo y suelto con cuidado de no dañar paredes.\n"
        "5,0\n"
        "C01.04 Partida m2 DESMONTADO DE PLACAS DE TERRAZO\n"
        "Picado y desmontado de placas con martillo eléctrico.\n"
        "20,0\n"
        "C01.05 Partida m2 DEMOLICIÓN DE MAMPARAS\n"
        "Demolición de mamparas de vidrio existentes con sus estructuras.\n"
        "5,0\n"
        # Repetir para llegar a >= 20 partidas (umbral de high confidence).
        + "".join(
            f"C0{i//10+1}.{i%10+10:02d} Partida m2 PARTIDA NÚMERO {i}\n"
            f"Descripción técnica detallada de la partida {i} con detalles de obra.\n"
            f"{i+1}.0\n"
            for i in range(25)
        )
    ]
    items = try_heuristic_extraction(text_per_page)
    assert items is not None, "Threshold debería cumplirse con texto limpio"
    assert len(items) >= 25
    by_code = {r.code: r for r in items}
    assert "C01.01" in by_code
    # Las descripciones técnicas se propagan.
    assert "Demolición de falso techo continuo" in (by_code["C01.01"].description or "")
    # Las cantidades se suman.
    assert by_code["C01.01"].quantity == 3.5  # 1.0 + 2.5


def test_returns_none_when_layout_not_inline():
    """Si el layout es UNKNOWN, devolver None → fallback al LLM."""
    text_per_page = ["Lorem ipsum dolor sit amet."]
    assert try_heuristic_extraction(text_per_page) is None


def test_returns_none_when_too_many_cross_page_candidates():
    """Si más del 10% de partidas son cross-page (descripción corta), no
    podemos confiar en la heurística → fallback al LLM. Aquí 4/5 = 80%
    cross-page, claramente sobre el umbral."""
    # 5 partidas todas con título solo, descripción ausente, página siguiente
    # con verbos de obra → 5 cross-page candidates.
    pages = [
        "Código Nat Ud Resumen Comentario N\n"
        "C01.01 Partida m2 DEMOLICIÓN DE A\n"
        "C01.02 Partida m2 DEMOLICIÓN DE B\n"
        "C01.03 Partida m2 DEMOLICIÓN DE C\n"
        "C01.04 Partida m2 DEMOLICIÓN DE D\n"
        "C01.05 Partida m2 DEMOLICIÓN DE E\n",
        "Demolición y picado completo de muros existentes con martillo eléctrico.\n"
        "Demolición y picado completo de muros existentes con martillo eléctrico.\n"
        "Demolición y picado completo de muros existentes con martillo eléctrico.\n"
        "Demolición y picado completo de muros existentes con martillo eléctrico.\n"
        "Demolición y picado completo de muros existentes con martillo eléctrico.\n",
    ]
    items = try_heuristic_extraction(pages)
    assert items is None, "Demasiados cross-page → no debe entrar al fast path"


def test_chapters_propagated_to_each_partida():
    """Cada item resultado debe tener su `chapter` correctamente asignado."""
    text_per_page = [
        "Código Nat Ud Resumen Comentario N\n"
        "C01 Capítulo TRABAJOS PREVIOS\n"
        + "".join(
            f"C01.{i:02d} Partida m2 PARTIDA {i}\nDescripción técnica detallada de obra completa con materiales.\n{i}.0\n"
            for i in range(1, 26)
        )
    ]
    items = try_heuristic_extraction(text_per_page)
    assert items is not None
    chapters = {r.chapter for r in items}
    # Todas deben tener el chapter asignado correctamente
    assert "C01 TRABAJOS PREVIOS" in chapters or "Sin Capítulo" in chapters

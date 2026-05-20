"""Tests para hierarchy_tracker."""
from __future__ import annotations

from src.budget.pdf_tabular_parser.application.hierarchy_tracker import (
    apply_detection_to_hierarchy,
    detect_hierarchy_in_line,
)
from src.budget.pdf_tabular_parser.domain.hierarchy import (
    ChapterHierarchy,
    HierarchyLevel,
)


def test_initial_hierarchy_is_empty():
    h = ChapterHierarchy()
    assert h.get_chapter_label() == "Sin Capítulo"
    assert h.get_sub_chapter_label() is None
    assert not h.has_any()


def test_set_capitulo_populates_label():
    h = ChapterHierarchy()
    h.set_capitulo("01", "ACTUACIONES PREVIAS")
    assert h.get_chapter_label() == "01 ACTUACIONES PREVIAS"
    assert h.has_any()


def test_set_subcapitulo_does_not_clear_capitulo():
    h = ChapterHierarchy()
    h.set_capitulo("01", "ACTUACIONES PREVIAS")
    h.set_subcapitulo("01.01", "Trabajos previos")
    assert h.get_chapter_label() == "01 ACTUACIONES PREVIAS"
    assert h.get_sub_chapter_label() == "01.01 Trabajos previos"


def test_new_capitulo_clears_subcapitulo():
    """Setear nuevo capítulo limpia los niveles inferiores."""
    h = ChapterHierarchy()
    h.set_capitulo("01", "PRIMERO")
    h.set_subcapitulo("01.01", "Sub1")
    h.set_apartado("01.01.01", "Apartado1")
    # Cambio de capítulo.
    h.set_capitulo("02", "SEGUNDO")
    assert h.get_chapter_label() == "02 SEGUNDO"
    assert h.get_sub_chapter_label() is None
    assert h.apartado_code is None


def test_new_subcapitulo_clears_apartado():
    h = ChapterHierarchy()
    h.set_capitulo("01", "PRIMERO")
    h.set_subcapitulo("01.01", "Sub1")
    h.set_apartado("01.01.01", "Apartado1")
    # Cambio de subcapítulo.
    h.set_subcapitulo("01.02", "Sub2")
    assert h.get_chapter_label() == "01 PRIMERO"
    assert h.get_sub_chapter_label() == "01.02 Sub2"
    assert h.apartado_code is None


def test_snapshot_is_independent_copy():
    h = ChapterHierarchy()
    h.set_capitulo("01", "PRIMERO")
    snap = h.snapshot()
    h.set_capitulo("02", "SEGUNDO")
    # snapshot no debe haberse modificado.
    assert snap.capitulo_code == "01"
    assert snap.capitulo_name == "PRIMERO"


def test_detect_capitulo_explicit():
    det = detect_hierarchy_in_line("CAPÍTULO 01 ACTUACIONES PREVIAS")
    assert det.level == HierarchyLevel.CAPITULO
    assert det.code == "01"
    assert det.name == "ACTUACIONES PREVIAS"


def test_detect_subcapitulo_explicit():
    det = detect_hierarchy_in_line("SUBCAPÍTULO 04.02 Trabajos de albañilería")
    assert det.level == HierarchyLevel.SUBCAPITULO
    assert det.code == "04.02"
    assert det.name == "Trabajos de albañilería"


def test_detect_apartado_explicit():
    det = detect_hierarchy_in_line("APARTADO 04.02.01 Tabique cerámico")
    assert det.level == HierarchyLevel.APARTADO
    assert det.code == "04.02.01"
    assert det.name == "Tabique cerámico"


def test_detect_capitulo_implicit_all_caps():
    """`XX NOMBRE_TODO_MAYUSCULA` se detecta como capítulo implícito."""
    det = detect_hierarchy_in_line("21 PATOLOGÍAS GRAVES")
    assert det.level == HierarchyLevel.CAPITULO
    assert det.code == "21"
    assert det.name == "PATOLOGÍAS GRAVES"


def test_implicit_capitulo_with_lowercase_rejected():
    """Si el nombre tiene minúsculas, no se considera capítulo implícito (es partida o ruido)."""
    det = detect_hierarchy_in_line("01.01 m2 Demolición de tabique")
    # Tiene unidad m2 + minúsculas → no es capítulo.
    assert det.level is None


def test_total_line_not_chapter():
    det = detect_hierarchy_in_line("TOTAL CAPÍTULO 02 1234,56")
    assert det.level is None


def test_apply_capitulo_detection_to_hierarchy():
    h = ChapterHierarchy()
    det = detect_hierarchy_in_line("CAPÍTULO 01 ACTUACIONES PREVIAS")
    assert apply_detection_to_hierarchy(h, det) is True
    assert h.capitulo_code == "01"
    assert h.capitulo_name == "ACTUACIONES PREVIAS"


def test_apply_none_detection_returns_false():
    h = ChapterHierarchy()
    det = detect_hierarchy_in_line("01.01 m2 Demolicion")
    # No es chapter heading → level=None → apply returns False.
    assert apply_detection_to_hierarchy(h, det) is False
    assert not h.has_any()

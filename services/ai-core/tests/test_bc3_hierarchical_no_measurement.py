"""BC3 jerárquico SIN mediciones (~M): plantilla capítulo→partida "en blanco".

Algunos exports (plantillas / presupuestos en blanco) traen el árbol `~D`
capítulo→partida pero SIN ningún `~M` ni precios. Antes producían 0 partidas
(budget vacío). El parser debe clasificar las HOJAS que cuelgan de un capítulo
como PARTIDA y el adapter debe emitirlas (cantidad 1 → revisión), sin romper el
caso bien-formado donde los recursos que cuelgan de una partida medida siguen
siendo COMPONENT.
"""

from src.budget.bc3_parser.entities import (
    Bc3Concept,
    Bc3ConceptKind,
    Bc3Decomposition,
    Bc3Measurement,
    Bc3Tree,
)
from src.budget.bc3_parser.parser import Bc3Parser
from src.budget.bc3_parser.to_restructured import bc3_tree_to_restructured_items


def _blank_hierarchical_tree() -> Bc3Tree:
    """root## → [C01# capítulo] → [P1, P2 hojas]; sin ~M, sin precios."""
    t = Bc3Tree()
    t.concepts["ROOT##"] = Bc3Concept(code="ROOT##", description="PRESUPUESTO")
    t.concepts["C01#"] = Bc3Concept(code="C01#", unit="Ud", description="MOVIMIENTO DE TIERRAS")
    t.concepts["P1"] = Bc3Concept(code="P1", unit="m2", description="Excavación en roca")
    t.concepts["P2"] = Bc3Concept(code="P2", unit="m3", description="Relleno de zanja")
    t.decompositions["ROOT##"] = Bc3Decomposition(parent_code="ROOT##", children=[("C01#", 1.0)])
    t.decompositions["C01#"] = Bc3Decomposition(parent_code="C01#", children=[("P1", 1.0), ("P2", 1.0)])
    return t


def test_hojas_de_capitulo_sin_medicion_son_partidas():
    t = _blank_hierarchical_tree()
    Bc3Parser()._infer_kinds(t)
    assert t.concepts["ROOT##"].kind == Bc3ConceptKind.CHAPTER
    assert t.concepts["C01#"].kind == Bc3ConceptKind.CHAPTER   # sufijo '#'
    assert t.concepts["P1"].kind == Bc3ConceptKind.PARTIDA     # hoja bajo capítulo
    assert t.concepts["P2"].kind == Bc3ConceptKind.PARTIDA


def test_adapter_emite_partidas_en_blanco_con_cantidad_1():
    t = _blank_hierarchical_tree()
    Bc3Parser()._infer_kinds(t)
    items = bc3_tree_to_restructured_items(t)
    by_code = {it.code: it for it in items}
    assert set(by_code) == {"P1", "P2"}                       # capítulos NO se emiten
    assert by_code["P1"].quantity == 1.0                       # sin ~M → 1 (revisión)
    assert by_code["P1"].unit == "m2"                          # unidad del ~C preservada
    assert by_code["P1"].chapter == "C01 MOVIMIENTO DE TIERRAS"  # '#' limpio del título


def test_capitulo_sin_almohadilla_por_hijo_con_decomp():
    """Un capítulo cuyo código NO acaba en '#' se detecta porque agrupa nodos
    que a su vez tienen ~D (sub-árbol)."""
    t = Bc3Tree()
    t.concepts["OBRA"] = Bc3Concept(code="OBRA", description="OBRA")
    t.concepts["CAP1"] = Bc3Concept(code="CAP1", description="Capítulo 1")
    t.concepts["PAR"] = Bc3Concept(code="PAR", unit="m2", description="Partida con recursos")
    t.concepts["MO"] = Bc3Concept(code="MO", unit="h", description="Oficial 1ª")
    t.decompositions["OBRA"] = Bc3Decomposition(parent_code="OBRA", children=[("CAP1", 1.0)])
    t.decompositions["CAP1"] = Bc3Decomposition(parent_code="CAP1", children=[("PAR", 1.0)])
    t.decompositions["PAR"] = Bc3Decomposition(parent_code="PAR", children=[("MO", 2.0)])
    Bc3Parser()._infer_kinds(t)
    assert t.concepts["OBRA"].kind == Bc3ConceptKind.CHAPTER   # raíz
    assert t.concepts["CAP1"].kind == Bc3ConceptKind.CHAPTER   # agrupa un nodo con ~D
    assert t.concepts["PAR"].kind == Bc3ConceptKind.PARTIDA    # ~D bajo capítulo (con recursos)
    assert t.concepts["MO"].kind == Bc3ConceptKind.COMPONENT   # recurso bajo partida


def test_regresion_recurso_bajo_partida_medida_sigue_component():
    """GUARD: en un BC3 bien-formado, los recursos que cuelgan de una partida
    MEDIDA (~M) no deben promocionarse a PARTIDA."""
    t = Bc3Tree()
    t.concepts["01#"] = Bc3Concept(code="01#", description="CAPÍTULO")
    t.concepts["PAR"] = Bc3Concept(code="PAR", unit="m2", description="Alicatado")
    t.concepts["MAT"] = Bc3Concept(code="MAT", unit="m2", description="Azulejo")
    t.decompositions["01#"] = Bc3Decomposition(parent_code="01#", children=[("PAR", 1.0)])
    t.decompositions["PAR"] = Bc3Decomposition(parent_code="PAR", children=[("MAT", 1.05)])
    t.measurements["PAR"] = Bc3Measurement(parent_code="01#", code="PAR", total_quantity=30.0)
    Bc3Parser()._infer_kinds(t)
    assert t.concepts["PAR"].kind == Bc3ConceptKind.PARTIDA    # medida
    assert t.concepts["MAT"].kind == Bc3ConceptKind.COMPONENT  # recurso, NO partida
    # y el adapter no emite el recurso como línea
    codes = {it.code for it in bc3_tree_to_restructured_items(t)}
    assert codes == {"PAR"}


def test_subcapitulo_da_chapter_path_mas_cercano():
    """root## → C02# → MUR# → P: la ruta de P usa el capítulo más cercano (MUR)."""
    t = Bc3Tree()
    t.concepts["R##"] = Bc3Concept(code="R##", description="OBRA")
    t.concepts["C02#"] = Bc3Concept(code="C02#", description="ESTRUCTURA")
    t.concepts["MUR#"] = Bc3Concept(code="MUR#", description="MUROS SOTANO")
    t.concepts["P"] = Bc3Concept(code="P", unit="m2", description="Muro HA")
    t.decompositions["R##"] = Bc3Decomposition(parent_code="R##", children=[("C02#", 1.0)])
    t.decompositions["C02#"] = Bc3Decomposition(parent_code="C02#", children=[("MUR#", 1.0)])
    t.decompositions["MUR#"] = Bc3Decomposition(parent_code="MUR#", children=[("P", 1.0)])
    Bc3Parser()._infer_kinds(t)
    items = bc3_tree_to_restructured_items(t)
    assert len(items) == 1
    assert items[0].chapter == "MUR MUROS SOTANO"

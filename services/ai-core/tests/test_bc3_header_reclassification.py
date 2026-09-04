"""Lever 1 — reclasificar (NO borrar) cabeceras coladas como partida.

En el path de promoción-de-hoja (BC3 sin `~M`), algunas hojas son TÍTULOS de
sección o cláusulas contractuales, no unidades de obra (`CIMENTACION`,
`Consideraciones Previas [cláusula legal]`). Se priciaban por error e inflaban el
total. Se reclasifican a CHAPTER (no se pricia) — NUNCA se borran, y con guardas
ultra-conservadoras para no tumbar una partida real (el peligro contrario).
"""
from __future__ import annotations

from src.budget.bc3_parser.entities import (
    Bc3Concept,
    Bc3ConceptKind,
    Bc3Decomposition,
    Bc3Measurement,
    Bc3Tree,
)
from src.budget.bc3_parser.parser import Bc3Parser
from src.budget.bc3_parser.to_restructured import bc3_tree_to_restructured_items


def _tree_with_leaf(code, desc, long, *, unit="ud", price=None, measured=False,
                    second_chapter=False) -> Bc3Tree:
    """root## → CAP# → [leaf]; opcionalmente medido / con precio / bajo 2 capítulos."""
    t = Bc3Tree()
    t.concepts["ROOT##"] = Bc3Concept(code="ROOT##", description="OBRA")
    t.concepts["C06#"] = Bc3Concept(code="C06#", description="SOLADOS Y ALICATADOS")
    leaf = Bc3Concept(code=code, unit=unit, description=desc, price=price)
    leaf.long_description = long
    t.concepts[code] = leaf
    t.decompositions["ROOT##"] = Bc3Decomposition(parent_code="ROOT##", children=[("C06#", 1.0)])
    kids = [(code, 1.0)]
    t.decompositions["C06#"] = Bc3Decomposition(parent_code="C06#", children=kids)
    if second_chapter:
        t.concepts["C02#"] = Bc3Concept(code="C02#", description="ESTRUCTURA")
        t.decompositions["ROOT##"].children.append(("C02#", 1.0))
        t.decompositions["C02#"] = Bc3Decomposition(parent_code="C02#", children=[(code, 1.0)])
    if measured:
        t.measurements[code] = Bc3Measurement(parent_code="C06#", code=code, total_quantity=5.0)
    Bc3Parser()._infer_kinds(t)
    return t


# ---- CABECERAS que SÍ se reclasifican (a CHAPTER, fuera de partidas) ----------

def test_self_echo_single_word_es_cabecera():
    t = _tree_with_leaf("CIM", "CIMENTACION", "CIMENTACION")
    assert t.concepts["CIM"].kind == Bc3ConceptKind.CHAPTER
    assert "CIM" not in {it.code for it in bc3_tree_to_restructured_items(t)}


def test_clausula_boilerplate_larga_es_cabecera():
    clause = ("Las obras se contratarán a precio y plazo fijo. " * 60) + " cláusula y aval."
    assert len(clause) > 2000
    t = _tree_with_leaf("C000", "Consideraciones Previas", clause)
    assert t.concepts["C000"].kind == Bc3ConceptKind.CHAPTER


def test_eco_exacto_del_capitulo_es_cabecera():
    t = _tree_with_leaf("SEC", "SOLADOS Y ALICATADOS", "")
    assert t.concepts["SEC"].kind == Bc3ConceptKind.CHAPTER


# ---- PARTIDAS reales que NO deben reclasificarse (guardas anti-falso-positivo) -

def test_multipalabra_con_desc_identica_sigue_partida():
    # Caso 06.04: en plantillas el ~C y el ~T son idénticos INCLUSO en partidas
    # reales. Multi-palabra → NO es auto-eco de cabecera.
    d = "Instalación solado gres porcelanico"
    t = _tree_with_leaf("06.04", d, d, unit="m2")
    assert t.concepts["06.04"].kind == Bc3ConceptKind.PARTIDA
    assert "06.04" in {it.code for it in bc3_tree_to_restructured_items(t)}


def test_spec_larga_con_propiedad_sigue_partida():
    # Caso 06.08: spec detallada (~800) que menciona 'propiedades' NO es cláusula.
    long = ("m2. Suministro y ejecución de revestimiento cerámico de gran formato, "
            "respetando las propiedades del material y la planeidad del soporte. " * 8)
    assert 600 < len(long) < 2000
    t = _tree_with_leaf("06.08", "Instalación alicatado GRAN FORMATO", long, unit="m2")
    assert t.concepts["06.08"].kind == Bc3ConceptKind.PARTIDA


def test_partida_referenciada_por_dos_capitulos_sigue_partida():
    # Caso EHV020E: una partida real puede estar referenciada por 2 capítulos.
    # NO debe demotarse a componente por eso.
    t = _tree_with_leaf("EHV020E", "Zuncho TIPO A",
                        "Zuncho de apoyo de forjado de hormigón armado HA-30.",
                        unit="m3", second_chapter=True)
    assert t.concepts["EHV020E"].kind == Bc3ConceptKind.PARTIDA


def test_partida_con_precio_nunca_es_cabecera():
    # Aunque sea palabra única auto-eco, si trae precio del BC3 es partida real.
    t = _tree_with_leaf("CIM", "CIMENTACION", "CIMENTACION", price=1250.0)
    assert t.concepts["CIM"].kind == Bc3ConceptKind.PARTIDA


def test_partida_medida_nunca_es_cabecera():
    # Con ~M, el ancla de medición manda aunque la descripción se auto-eco.
    t = _tree_with_leaf("CIM", "CIMENTACION", "CIMENTACION", measured=True)
    assert t.concepts["CIM"].kind == Bc3ConceptKind.PARTIDA

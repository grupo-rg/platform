"""BC3 con mediciones ~M ciegas (total=0): recuperar la cantidad del texto.

Algunos exportadores no escriben la medición en ~M (total=0, sin parciales) y la
vuelcan en la descripción ("… 25,85 m² 1.1 Replanteo …"). El adapter debe
recuperar cantidad+unidad y limpiar la anotación, sin quedar en 0€.
"""

from src.budget.bc3_parser.entities import Bc3Concept, Bc3ConceptKind, Bc3Measurement, Bc3Tree
from src.budget.bc3_parser.to_restructured import (
    bc3_tree_to_restructured_items,
    _extract_qty_from_text,
)


def _blind_tree(desc: str, unit: str = "") -> Bc3Tree:
    t = Bc3Tree()
    t.concepts["P1"] = Bc3Concept(code="P1", unit=unit, description=desc, kind=Bc3ConceptKind.PARTIDA)
    t.measurements["P1"] = Bc3Measurement(parent_code="C1", code="P1", total_quantity=0.0, parciales_text="", lines=[])
    return t


def test_extract_qty_area_decimal_espanol():
    r = _extract_qty_from_text("Tabique de yeso. HÚMEDO 25,85 m² 1.1 Replanteo")
    assert r is not None
    qty, unit, _ = r
    assert qty == 25.85 and unit == "m2"


def test_extract_qty_unidades():
    r = _extract_qty_from_text("Desmontaje de carpintería. 2,00 Ud 1.1 Acopio")
    assert r is not None
    assert r[0] == 2.0 and r[1] == "ud"


def test_extract_qty_sin_medicion_devuelve_none():
    assert _extract_qty_from_text("Protección frente a la humedad de muros") is None


def test_blind_measurement_recupera_cantidad_y_limpia_descripcion():
    items = bc3_tree_to_restructured_items(
        _blind_tree("Tabique de placas de yeso laminado. HÚMEDO-HÚMEDO 25,85 m² 1.1 Replanteo y trazado")
    )
    assert len(items) == 1
    it = items[0]
    assert it.quantity == 25.85
    assert it.unit == "m2"                       # unidad ~C vacía → recuperada del texto
    assert "1.1" not in it.description           # anotación recortada
    assert it.description == "Tabique de placas de yeso laminado. HÚMEDO-HÚMEDO"


def test_blind_measurement_sin_texto_default_1():
    items = bc3_tree_to_restructured_items(_blind_tree("Protección frente a la humedad de muros"))
    assert items[0].quantity == 1.0             # fallback: 1, nunca 0


def test_medicion_bien_formada_no_se_toca():
    t = Bc3Tree()
    t.concepts["P1"] = Bc3Concept(code="P1", unit="m3", description="Hormigón HM-20", kind=Bc3ConceptKind.PARTIDA)
    t.measurements["P1"] = Bc3Measurement(parent_code="C1", code="P1", total_quantity=12.5, parciales_text="", lines=[])
    it = bc3_tree_to_restructured_items(t)[0]
    assert it.quantity == 12.5 and it.unit == "m3" and it.description == "Hormigón HM-20"

"""Regresiones: rendimiento (`yield`) por nombre de campo y ajustes comerciales fuera de la valoración IA."""
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import _is_commercial_adjustment
from src.budget.domain.entities import BudgetBreakdownComponent


def test_yield_amount_by_field_name_is_kept():
    c = BudgetBreakdownComponent(concept="Oficial 1ª", type="LABOR", price=31.11, yield_amount=0.5, total=15.56)
    assert c.yield_amount == 0.5
    assert c.model_dump(by_alias=True)["yield"] == 0.5


def test_yield_by_alias_still_works():
    c = BudgetBreakdownComponent.model_validate({"concept": "Peón", "type": "LABOR", "price": 25.14, "yield": 2.0, "total": 50.28})
    assert c.yield_amount == 2.0


def _item(desc: str) -> RestructuredItem:
    return RestructuredItem(code="X", description=desc, quantity=1.0, unit="ud")


def test_commercial_adjustments_detected():
    for desc in ("Descuento 10%", "DESCUENTO comercial por volumen", "Bonificación por pronto pago", "Dto. 5%", "Abono de materiales"):
        assert _is_commercial_adjustment(_item(desc)), desc


def test_work_units_are_not_adjustments():
    for desc in ("Demolición de alicatado con descuento de huecos", "Sifón para lavabo", "Carga manual de escombros en contenedor"):
        assert not _is_commercial_adjustment(_item(desc)), desc

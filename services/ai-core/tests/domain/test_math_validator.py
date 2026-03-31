import pytest
from src.domain.entities.models import LineItem, Chapter, ExtractedBudget
from src.domain.services.math_validator import MathValidator
from src.domain.exceptions.errors import MathematicalValidationError

def test_line_item_validation_success():
    item = LineItem(
        code="TEST.01",
        description="Test Item",
        unit="m2",
        quantity=10.0,
        priceLabor=5.0,
        priceMaterial=5.0,
        priceTotal=100.0,
        chapter="Test Chapter"
    )
    # Should not raise exception
    MathValidator.validate_line_item(item)

def test_line_item_validation_failure():
    item = LineItem(
        code="TEST.01",
        description="Test Item",
        unit="m2",
        quantity=10.0,
        priceLabor=5.0,
        priceMaterial=5.0,
        priceTotal=90.0, # Deliberately wrong (should be 100)
    )
    with pytest.raises(MathematicalValidationError):
        MathValidator.validate_line_item(item)

def test_chapter_validation_success():
    item1 = LineItem(code="01", description="A", unit="u", quantity=1.0, priceTotal=50.0)
    item2 = LineItem(code="02", description="B", unit="u", quantity=2.0, priceTotal=100.0)
    
    chapter = Chapter(name="Foundation", items=[item1, item2], subtotal=150.0)
    # Should not raise
    MathValidator.validate_chapter(chapter)

def test_budget_full_validation_failure():
    item1 = LineItem(code="01", description="A", unit="u", quantity=1.0, priceTotal=50.0)
    chapter = Chapter(name="Foundation", items=[item1], subtotal=50.0)
    
    budget = ExtractedBudget(chapters=[chapter], total_price=999.0) # Deliberately wrong
    
    with pytest.raises(MathematicalValidationError):
        MathValidator.validate_budget(budget)

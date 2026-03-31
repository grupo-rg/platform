import pytest
from src.budget.domain.math_validator import MathValidator

def test_calculate_total_basic_multiply():
    """Test standard multiplication."""
    total = MathValidator.calculate_total(10.5, 2.0)
    assert total == 21.0

def test_calculate_total_rounding():
    """Test rounding logic ensures precision up to 2 decimals."""
    total = MathValidator.calculate_total(3.333, 2.55)
    # 3.333 * 2.55 = 8.49915 -> rounded to 8.50
    assert total == 8.50

def test_validate_line_item_success():
    """Test valid line item validation where Total = QTY * Price."""
    item = {
        "quantity": 5.0,
        "unitPrice": 10.0,
        "totalPrice": 50.0
    }
    assert MathValidator.validate_line_item(item) is True

def test_validate_line_item_failure():
    """Test line item failing when Total does not equal QTY * Price."""
    item = {
        "quantity": 5.0,
        "unitPrice": 10.0,
        "totalPrice": 55.0 # Wrong total
    }
    assert MathValidator.validate_line_item(item) is False

def test_validate_chapter_success():
    """Test a valid chapter where the sum of its items' total matches exactly."""
    items = [
        {"totalPrice": 100.50},
        {"totalPrice": 50.25},
        {"totalPrice": 25.00}
    ]
    # Sum is 175.75
    assert MathValidator.validate_chapter(items, 175.75) is True

def test_validate_chapter_rounding_success():
    """Test a valid chapter allowing for minute float rounding differences."""
    items = [
        {"totalPrice": 100.501},
        {"totalPrice": 50.252},
        {"totalPrice": 25.001}
    ]
    # Sum is 175.754
    assert MathValidator.validate_chapter(items, 175.75) is True

def test_validate_chapter_failure():
    """Test chapter failure due to incorrect sum declaration."""
    items = [
        {"totalPrice": 100.00},
        {"totalPrice": 50.00}
    ]
    # Sum is 150.00. Declared is 200.
    assert MathValidator.validate_chapter(items, 200.0) is False

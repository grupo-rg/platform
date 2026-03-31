import pytest
from unittest.mock import MagicMock
from io import BytesIO

from src.application.ports.pdf_reader_port import IPdfReader
from src.application.use_cases.extract_budget_use_case import ExtractBudgetFromPdfUseCase
from src.domain.entities.models import ExtractedBudget, Chapter, LineItem
from src.domain.exceptions.errors import MathematicalValidationError

def test_extract_budget_success():
    # 1. Arrange
    mock_reader = MagicMock(spec=IPdfReader)
    
    # Create a valid budget
    item = LineItem(code="1", description="Test", unit="u", quantity=2.0, priceTotal=100.0, priceMaterial=50.0, priceLabor=0.0)
    chapter = Chapter(name="C1", items=[item], subtotal=100.0)
    valid_budget = ExtractedBudget(chapters=[chapter], total_price=100.0)
    
    # Mock returns the perfect budget
    mock_reader.extract_budget.return_value = valid_budget
    
    use_case = ExtractBudgetFromPdfUseCase(pdf_reader=mock_reader)
    dummy_file = BytesIO(b"dummy pdf bytes")

    # 2. Act
    result = use_case.execute(dummy_file)

    # 3. Assert
    mock_reader.extract_budget.assert_called_once_with(dummy_file)
    assert result.total_price == 100.0

def test_extract_budget_fails_domain_validation_due_to_leak():
    # 1. Arrange
    mock_reader = MagicMock(spec=IPdfReader)
    
    # Create an INVALID budget (reader screwed up and leaked data)
    item = LineItem(code="1", description="Test", unit="u", quantity=2.0, priceTotal=100.0)
    chapter = Chapter(name="C1", items=[item], subtotal=150.0) # Subtotal is WRONG (Data Leak)
    invalid_budget = ExtractedBudget(chapters=[chapter], total_price=150.0)
    
    mock_reader.extract_budget.return_value = invalid_budget
    use_case = ExtractBudgetFromPdfUseCase(pdf_reader=mock_reader)
    dummy_file = BytesIO(b"dummy pdf bytes")

    # 2. Act & Assert
    with pytest.raises(MathematicalValidationError, match="Chapter 'C1' math failed"):
        use_case.execute(dummy_file)

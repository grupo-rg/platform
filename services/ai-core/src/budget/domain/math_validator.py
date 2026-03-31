from typing import List, Dict, Any

class MathValidator:
    """Domain service to validate that budget math is exactly correct to the cent."""

    @staticmethod
    def calculate_total(quantity: float, unit_price: float) -> float:
        """Calculates total price rounded to 2 decimals."""
        return round(quantity * unit_price, 2)

    @staticmethod
    def validate_line_item(item: Dict[str, Any]) -> bool:
        """Validates that a single line item's math is correct."""
        expected_total = MathValidator.calculate_total(item.get("quantity", 0), item.get("unitPrice", 0))
        actual_total = round(item.get("totalPrice", 0), 2)
        return abs(expected_total - actual_total) < 0.02 # Allow small float rounding differences
    
    @staticmethod
    def validate_chapter(chapter_items: List[Dict[str, Any]], declared_chapter_total: float) -> bool:
        """Validates that the sum of line items matches the chapter total."""
        calculated_total = sum(item.get("totalPrice", 0) for item in chapter_items)
        return abs(round(calculated_total, 2) - round(declared_chapter_total, 2)) < 0.02

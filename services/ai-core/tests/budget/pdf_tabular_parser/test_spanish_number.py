"""Tests para spanish_number.parse_spanish_number."""
from __future__ import annotations

import pytest

from src.budget.pdf_tabular_parser.application.spanish_number import parse_spanish_number


@pytest.mark.parametrize(
    "raw,expected",
    [
        # Casos típicos coma decimal española.
        ("10,000", 10.0),
        ("10,00", 10.0),
        ("1,5", 1.5),
        ("0,00", 0.0),
        ("0", 0.0),
        ("10", 10.0),
        # Miles con punto, decimal con coma.
        ("1.234,56", 1234.56),
        ("12.345.678,90", 12345678.90),
        # Solo punto (anglo) — decimal claro.
        ("3.14", 3.14),
        ("3.1", 3.1),
        ("3.145", 3.145),
        # Whitespace tolerado.
        ("  10,5  ", 10.5),
        # Espacios internos (raros pero observados).
        ("1 234,56", 1234.56),
        # Casos inválidos.
        ("abc", None),
        ("", None),
        ("10..5", None),
        ("1,2,3", None),  # multiple commas inválido
        (None, None),
    ],
)
def test_parse_spanish_number(raw, expected):
    result = parse_spanish_number(raw)
    if expected is None:
        assert result is None, f"Esperaba None para {raw!r}, obtuve {result}"
    else:
        assert result == pytest.approx(expected), (
            f"Esperaba {expected} para {raw!r}, obtuve {result}"
        )


def test_negative_numbers():
    assert parse_spanish_number("-10,5") == pytest.approx(-10.5)
    assert parse_spanish_number("-1.234,56") == pytest.approx(-1234.56)


def test_non_string_input_robustness():
    """parse_spanish_number debe tolerar None y entrada vacía sin excepciones."""
    assert parse_spanish_number(None) is None
    assert parse_spanish_number("") is None
    assert parse_spanish_number("   ") is None

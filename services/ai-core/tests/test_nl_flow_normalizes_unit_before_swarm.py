"""Fase 5.C — el flujo NL → Budget normaliza la unidad antes del Swarm.

Problema: `_task_to_restructured()` en `generate_budget_from_nl_uc.py` construye
un `RestructuredItem` a partir de una `DecomposedTask` del Architect. A diferencia
del flujo PDF (que pasa por `InlinePdfExtractorService.extract()`, donde 5.B ya
normaliza), el flujo NL NO pasa por el extractor — va directo del Architect al
Swarm. Sin normalización explícita aquí, `unit_normalized` y `unit_dimension`
quedarían en `None` y el Swarm perdería el filtro dimensional.

Este test fija que la misma normalización determinista de 5.B también ocurre
en el boundary Architect→Swarm del flujo NL.
"""

from __future__ import annotations

import pytest

from src.budget.application.services.architect_service import DecomposedTask
from src.budget.application.use_cases.generate_budget_from_nl_uc import (
    _task_to_restructured,
)


def _task(unit: str) -> DecomposedTask:
    return DecomposedTask(
        taskId=1,
        dependsOn=[],
        chapter="FABRICAS Y TABIQUES",
        subchapter=None,
        reasoning="Test",
        task="Partida de prueba",
        userSpecificMaterial=None,
        isExplicitlyRequested=False,
        estimatedParametricUnit=unit,
        estimatedParametricQuantity=12.0,
    )


@pytest.mark.parametrize(
    "raw_unit, expected_canonical, expected_dimension",
    [
        ("Ud", "ud", "discreto"),
        ("m²", "m2", "superficie"),
        ("M3", "m3", "volumen"),
        ("mts", "ml", "lineal"),
        ("Kg", "kg", "masa"),
    ],
)
def test_task_to_restructured_normalizes_unit_and_derives_dimension(
    raw_unit: str, expected_canonical: str, expected_dimension: str
) -> None:
    item = _task_to_restructured(_task(raw_unit))
    assert item.unit_normalized == expected_canonical
    assert item.unit_dimension == expected_dimension


def test_task_to_restructured_leaves_fields_none_for_unknown_unit() -> None:
    """Unidad irreconocible → `unit_normalized` y `unit_dimension` en None.
    Comportamiento consistente con 5.B (no crash, sin degradar; el Swarm decide)."""
    item = _task_to_restructured(_task("xyz"))
    assert item.unit_normalized is None
    assert item.unit_dimension is None


def test_task_to_restructured_preserves_code_description_and_quantity() -> None:
    """La normalización no debe romper los campos existentes del boundary."""
    task = DecomposedTask(
        taskId=7,
        dependsOn=[1, 2],
        chapter="CARPINTERIA DE MADERA",
        subchapter="Puertas interiores",
        reasoning="Cliente pidió carpintería oculta",
        task="Puerta de madera maciza acabado mate",
        userSpecificMaterial="roble americano",
        isExplicitlyRequested=True,
        estimatedParametricUnit="Ud",
        estimatedParametricQuantity=5.0,
    )
    item = _task_to_restructured(task)

    assert item.code == "NL-7"
    assert "Puerta de madera" in item.description
    assert "[MATERIAL EXPLÍCITO: roble americano]" in item.description
    assert item.quantity == 5.0
    assert item.chapter == "CARPINTERIA DE MADERA"
    # Y la normalización 5.C aplicada:
    assert item.unit_normalized == "ud"
    assert item.unit_dimension == "discreto"

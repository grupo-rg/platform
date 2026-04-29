"""Entidades del subdominio `catalog`.

Hoy solo contiene `LaborRate`. En fases futuras se añadirán
`MaterialBase` y `EquipmentRate` siguiendo el mismo patrón.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


LaborCategory = Literal[
    "oficial_1a",
    "oficial_2a",
    "peon_ordinario",
    "peon_especialista",
    "capataz",
    "ayudante",
]


class LaborRate(BaseModel):
    """Tarifa oficial COAATMCA 2025 de mano de obra por categoría y oficio.

    Fuente: cuadros base de las páginas 6-10 del libro COAATMCA 2025.
    Se usa cuando el Judge debe componer una partida sin match 1:1 en el
    libro vectorizado (ej: partida "tabique de adobe tradicional").
    """

    id: str = Field(min_length=1)
    category: LaborCategory
    trade: Optional[str] = None
    label_es: str = Field(min_length=1)
    rate_eur_hour: float = Field(gt=0.0)
    unit: str = "h"
    source_book: str = Field(min_length=1)
    source_page: int = Field(ge=1)
    aliases: list[str] = Field(default_factory=list)

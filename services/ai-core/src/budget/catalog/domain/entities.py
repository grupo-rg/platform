"""Entidades del subdominio `catalog`.

Contiene `LaborRate` (mano de obra) y `MachineryRate` (maquinaria por
alquiler €/h). En fases futuras se añadirá `MaterialBase` siguiendo el
mismo patrón.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


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


class MachineryRate(BaseModel):
    """Tarifa de ALQUILER de maquinaria por hora (€/h), NO precio de compra.

    Sigue el mismo patrón determinista que `LaborRate`: el compositor
    `from_scratch` valora una máquina como ``rate_eur_hour × horas`` en vez de
    usar el precio de COMPRA del catálogo de materiales (que inflaba el precio
    de la partida).

    ``rate_eur_hour`` es ``Optional`` a propósito: los registros de scaffolding
    se siembran como PLACEHOLDER con ``rate_eur_hour = None`` y
    ``is_placeholder = True`` hasta que el operador rellene la tarifa real de
    alquiler COAATMCA. Mientras esté a None, el compositor marca la partida
    ``needs_human_review`` (nunca cae al precio de compra).
    """

    id: str = Field(min_length=1)
    category: str = Field(min_length=1, description="Familia de maquinaria (ej. 'excavacion', 'compactacion', 'elevacion')")
    label_es: str = Field(min_length=1)
    # Tarifa de ALQUILER €/h. None = placeholder pendiente de rellenar por el operador.
    rate_eur_hour: Optional[float] = Field(default=None)
    unit: str = "h"
    is_placeholder: bool = Field(
        default=False,
        description="True mientras la tarifa real no esté validada; el compositor la trata como sin tarifa (review).",
    )
    source_book: Optional[str] = None
    source_page: Optional[int] = None
    aliases: list[str] = Field(default_factory=list)

    @field_validator("rate_eur_hour")
    @classmethod
    def _rate_positive_when_present(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0.0:
            raise ValueError("rate_eur_hour debe ser > 0 cuando está presente (o None si es placeholder)")
        return v

    @property
    def has_rate(self) -> bool:
        """True solo si hay una tarifa de alquiler real utilizable."""
        return self.rate_eur_hour is not None and self.rate_eur_hour > 0.0 and not self.is_placeholder

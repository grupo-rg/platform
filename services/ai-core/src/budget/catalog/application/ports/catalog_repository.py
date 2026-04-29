"""Port `ICatalogRepository` — interfaz de persistencia del subdominio catalog."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from src.budget.catalog.domain.entities import LaborRate


class ICatalogRepository(ABC):
    """Persistencia de entidades del catalog (LaborRate y futuros MaterialBase / EquipmentRate)."""

    @abstractmethod
    async def get_labor_rate_by_id(self, id: str) -> Optional[LaborRate]:
        """Devuelve la tarifa con ese id exacto, o None si no existe."""

    @abstractmethod
    async def find_labor_rates(
        self,
        query: str,
        trade: Optional[str] = None,
        limit: int = 5,
    ) -> list[LaborRate]:
        """Fuzzy match por category/aliases, opcionalmente filtrado por trade."""

    @abstractmethod
    async def save_labor_rate(self, labor_rate: LaborRate) -> None:
        """Upsert de una tarifa."""

    @abstractmethod
    async def save_labor_rates_batch(self, rates: list[LaborRate]) -> None:
        """Upsert atómico de varias tarifas a la vez (usado por el seed)."""

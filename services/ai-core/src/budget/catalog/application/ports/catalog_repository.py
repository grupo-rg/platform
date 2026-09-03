"""Port `ICatalogRepository` — interfaz de persistencia del subdominio catalog."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from src.budget.catalog.domain.entities import LaborRate, MachineryRate


class ICatalogRepository(ABC):
    """Persistencia de entidades del catalog (LaborRate, MachineryRate y futuro MaterialBase)."""

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

    # ---- Maquinaria (tarifa de ALQUILER €/h, no precio de compra) ---------

    @abstractmethod
    async def get_machinery_rate_by_id(self, id: str) -> Optional[MachineryRate]:
        """Devuelve la tarifa de maquinaria con ese id exacto, o None."""

    @abstractmethod
    async def find_machinery_rates(
        self,
        query: str,
        category: Optional[str] = None,
        limit: int = 5,
    ) -> list[MachineryRate]:
        """Fuzzy match por category/aliases/label, opcionalmente filtrado por category."""

    @abstractmethod
    async def save_machinery_rate(self, machinery_rate: MachineryRate) -> None:
        """Upsert de una tarifa de maquinaria."""

    @abstractmethod
    async def save_machinery_rates_batch(self, rates: list[MachineryRate]) -> None:
        """Upsert atómico de varias tarifas de maquinaria (usado por el seed)."""

"""Regla de ajuste de precio de material por porcentaje.

Espejo del modelo TS `MaterialPriceRule`: el lado TypeScript (admin SDK)
escribe estos documentos en la colección Firestore `material_price_rules`
usando claves camelCase; este módulo Python SOLO los lee (el compositor de
pricing aplicará el factor resultante — cableado en otra wave).

Un material recibe UNA sola regla: la más específica que le aplique. La
resolución vive en `material_price_resolver.resolve_material_factor`.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# Ámbito de la regla, de más específico a menos: budget > client > material >
# category > global. El texto literal de estos valores es paridad con el TS.
MaterialPriceRuleScope = Literal["global", "category", "material", "client", "budget"]


class MaterialPriceRuleTarget(BaseModel):
    """Objetivo de una regla según su `scope`.

    Solo el campo correspondiente al scope está poblado (el resto None):
      - category → `category` (texto libre "Padre > Hijo")
      - material → `sku`
      - client   → `leadId`
      - budget   → `budgetId`
      - global   → todos None
    """

    category: Optional[str] = None
    sku: Optional[str] = None
    leadId: Optional[str] = None
    budgetId: Optional[str] = None


class MaterialPriceRule(BaseModel):
    """Regla de ajuste de precio de material por porcentaje (con signo).

    `adjustmentPct` es el porcentaje CON SIGNO (+/-): el factor multiplicador
    aplicado al precio del material es ``1 + adjustmentPct / 100``.

    Los nombres de campo son camelCase a propósito (paridad con los documentos
    Firestore que escribe el lado TypeScript). `populate_by_name` permite además
    construir la entidad con esos mismos nombres desde código Python.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    scope: MaterialPriceRuleScope
    target: MaterialPriceRuleTarget = Field(default_factory=MaterialPriceRuleTarget)
    adjustmentPct: float
    active: bool
    note: Optional[str] = None
    createdBy: str
    createdAt: str
    updatedBy: str
    updatedAt: str

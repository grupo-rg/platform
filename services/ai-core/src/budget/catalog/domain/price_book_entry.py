"""Entries del price_book v005 (padre item + N hijos breakdown).

Cada item del JSON fuente `docs/2025_variable_final.json` se explota en:
  - 1 `PriceBookItemEntry` (el padre, con `kind="item"`).
  - N `PriceBookBreakdownEntry` (uno por cada breakdown, con `kind="breakdown"`).

Todos se escriben en la colección `price_book_2025`. El campo `kind`
discrimina a nivel de lectura qué tipo es el documento. El `code` del
breakdown es `{parent_code}#{idx:02d}` — doc_id determinista → seed
idempotente.

`EmbeddingTextBuilder` centraliza cómo se construye el texto a embedear
por kind, para que A/B testing de variantes de embedding no toque el
transformer ni el adapter.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class PriceBookItemEntry(BaseModel):
    """Documento padre en `price_book_2025` — una partida del libro."""

    kind: Literal["item"] = "item"
    code: str = Field(min_length=1)
    chapter: str
    section: str = ""
    description: str
    unit_raw: str
    unit_normalized: Optional[str] = None
    unit_dimension: Optional[str] = None
    priceTotal: float
    breakdown_ids: list[str] = Field(default_factory=list)
    source_page: Optional[int] = None
    source_book: str = "COAATMCA_2025"


class PriceBookBreakdownEntry(BaseModel):
    """Documento hijo en `price_book_2025` — un componente de un item.

    Fase 12 — el `code` es el del catálogo COAATMCA original (`mt21veg011aa`,
    `mo055`, `mq05pdm`, `%`) para que el filtrado por prefijo del editor
    funcione end-to-end. El `doc_id` compound (`{parent_code}#{idx:02d}`) se
    usa como Firestore document key para garantizar unicidad: un mismo
    componente del catálogo (ej. `mo055` "oficial 1ª") aparece en cientos de
    items con `parent_description` distinto, y necesitamos preservar todos.
    """

    kind: Literal["breakdown"] = "breakdown"
    code: str = Field(min_length=1)  # original COAATMCA: "mt21veg011aa", "mo055", "%", ...
    doc_id: Optional[str] = None  # compound `{parent}#{idx:02d}` para uniqueness en Firestore
    parent_code: str = Field(min_length=1)
    parent_description: str
    parent_unit: str
    chapter: str
    description: str
    unit_raw: str
    unit_normalized: Optional[str] = None
    unit_dimension: Optional[str] = None
    quantity: float = 1.0
    price_unit: float = 0.0
    price: float = 0.0
    is_variable: bool = False
    source_book: str = "COAATMCA_2025"


class EmbeddingTextBuilder:
    """Construye el texto que se envía al modelo de embedding para cada kind.

    Convención de formato (afecta directamente la calidad del vector search):
      - Item padre:     `"{chapter} > {section} | {unit} | {description}"`
      - Breakdown hijo: `"{chapter} > {parent_description} | componente: {description} ({unit})"`

    El unit usado es el normalizado si existe, si no el raw (para que la
    jerga del aparejador no contamine el embedding del libro oficial).
    """

    @staticmethod
    def for_item(item: PriceBookItemEntry) -> str:
        unit = item.unit_normalized or item.unit_raw
        section = item.section or ""
        return f"{item.chapter} > {section} | {unit} | {item.description}"

    @staticmethod
    def for_breakdown(bk: PriceBookBreakdownEntry) -> str:
        unit = bk.unit_normalized or bk.unit_raw
        return (
            f"{bk.chapter} > {bk.parent_description} | "
            f"componente: {bk.description} ({unit})"
        )

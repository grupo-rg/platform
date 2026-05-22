"""Entidades del dominio BC3.

Cada entidad mapea 1:1 a un tipo de record FIEBDC-3.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple


class Bc3ConceptKind(str, Enum):
    """Tipo de concepto inferido por estructura.

    BC3 no marca explícitamente si un `~C` es capítulo, partida o componente:
    se deduce por:
      - Si tiene `~M` que lo referencia → es partida medida.
      - Si tiene `~D` (descomposición) y es referenciado por otra `~D` → componente.
      - Si tiene `~D` y NO es referenciado → capítulo o partida.
      - Si el código contiene `##` o termina en separadores → capítulo raíz.
    """

    CHAPTER = "chapter"
    PARTIDA = "partida"
    COMPONENT = "component"
    UNKNOWN = "unknown"


@dataclass
class Bc3Concept:
    """Record `~C|code|unit|description|price|date|type|`.

    Representa cualquier nodo del árbol BC3 (capítulo, partida o componente).
    """

    code: str
    unit: str = ""
    description: str = ""
    price: Optional[float] = None
    kind: Bc3ConceptKind = Bc3ConceptKind.UNKNOWN
    long_description: str = ""  # rellenado por `~T`


@dataclass
class Bc3Decomposition:
    """Record `~D|parent_code|child_code\\factor\\quantity\\...`.

    Una decomposición lista los hijos (componentes) de un concepto padre,
    cada uno con su factor (cantidad por unidad del padre) y quantity opcional.
    """

    parent_code: str
    children: List[Tuple[str, float]] = field(default_factory=list)
    # (child_code, factor) — factor es cantidad de child por unidad de parent


@dataclass
class Bc3Measurement:
    """Record `~M|parent_code\\child_code|...|total_quantity|parciales_text|`.

    Mediciones aplicadas a una partida. El campo `total_quantity` es el
    número de unidades totales de la partida (autoritativo, escrito por el
    medidor humano).
    """

    parent_code: str
    code: str  # código de la partida medida
    total_quantity: float
    parciales_text: str = ""


@dataclass
class Bc3Tree:
    """Resultado del parseo: árbol completo de conceptos + relaciones."""

    version: str = ""  # ej. "FIEBDC-3/2002"
    encoding: str = ""  # ej. "ANSI" (declarado en ~V)
    currency: str = "EUR"
    concepts: Dict[str, Bc3Concept] = field(default_factory=dict)
    decompositions: Dict[str, Bc3Decomposition] = field(default_factory=dict)
    measurements: Dict[str, Bc3Measurement] = field(default_factory=dict)
    root_codes: List[str] = field(default_factory=list)

    def get_concept(self, code: str) -> Optional[Bc3Concept]:
        return self.concepts.get(code)

    def get_quantity(self, code: str) -> Optional[float]:
        """Cantidad medida de un concepto, si está disponible."""
        m = self.measurements.get(code)
        return m.total_quantity if m else None

    def is_chapter(self, code: str) -> bool:
        """Heurística: un concepto es capítulo si tiene `~D` y NO tiene `~M`.

        Las partidas son las hojas medidas; los capítulos agrupan partidas.
        """
        has_decomp = code in self.decompositions
        has_measure = code in self.measurements
        return has_decomp and not has_measure

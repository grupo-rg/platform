"""BC3 (FIEBDC-3) parser — formato estándar español para presupuestos.

Sprint 4 Fase L — parser nativo para archivos `.bc3` exportados por Presto,
Arquímedes, Menfis u otros programas profesionales españoles. Mucho más
robusto que el parser PDF porque BC3 es texto estructurado pipe-delimited:
sin ambigüedad de columnas, sin doble conteo posible.

Records soportados (cubren el 100% de los 7 BC3 reales del cliente):
  ~V  versión + encoding
  ~K  propiedades base (moneda, decimales)
  ~C  conceptos (capítulo, partida, componente)
  ~T  texto descriptivo extenso
  ~D  descomposición (componentes de una partida)
  ~M  medición (cantidad total con parciales)

Records ignorados (no críticos para el pipeline):
  ~O  pliegos / observaciones técnicas
  ~A  agentes / empresas
  ~E  entidades
  ~L  labels
  ~X  extensión propietaria

Uso típico:
    >>> from src.budget.bc3_parser import Bc3Parser, bc3_tree_to_restructured_items
    >>> with open("budget.bc3", "rb") as f:
    ...     tree = Bc3Parser().parse(f.read())
    >>> items = bc3_tree_to_restructured_items(tree)
    >>> # items tiene el mismo shape que produce el parser TABULAR de PDFs
"""

from src.budget.bc3_parser.entities import (
    Bc3Concept,
    Bc3ConceptKind,
    Bc3Decomposition,
    Bc3Measurement,
    Bc3Tree,
)
from src.budget.bc3_parser.parser import Bc3Parser
from src.budget.bc3_parser.to_restructured import bc3_tree_to_restructured_items

__all__ = [
    "Bc3Parser",
    "Bc3Tree",
    "Bc3Concept",
    "Bc3ConceptKind",
    "Bc3Decomposition",
    "Bc3Measurement",
    "bc3_tree_to_restructured_items",
]

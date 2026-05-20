"""TabularColumn — representación de una columna detectada en la cabecera.

La cabecera de PDFs PRESTO/CIFRE tiene 10 conceptos canónicos (en español):

    CÓDIGO  RESUMEN  UDS  LONGITUD  ANCHURA  ALTURA  PARCIALES  CANTIDAD  PRECIO  IMPORTE

Cada concepto ocupa un rango horizontal (x_min, x_max). Para cada palabra
de las filas subsiguientes, asignamos la palabra a la columna cuyo x_center
está más cerca del x_center de la palabra (asignación por nearest center).
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class ColumnConcept(str, Enum):
    """Conceptos canónicos de las columnas de la cabecera PRESTO/CIFRE.

    El orden coincide con el orden en que aparecen en la cabecera real.
    """

    CODIGO = "codigo"
    RESUMEN = "resumen"
    UDS = "uds"
    LONGITUD = "longitud"
    ANCHURA = "anchura"
    ALTURA = "altura"
    PARCIALES = "parciales"
    CANTIDAD = "cantidad"
    PRECIO = "precio"
    IMPORTE = "importe"

    @classmethod
    def from_header_word(cls, word: str) -> Optional["ColumnConcept"]:
        """Intenta mapear una palabra de la cabecera a un concepto canónico.

        Tolera variantes con/sin acento, mayúsculas/minúsculas, plural.
        Retorna None si la palabra no encaja con ningún concepto.
        """
        normalized = _normalize_header_word(word)
        return _HEADER_WORD_TO_CONCEPT.get(normalized)


def _normalize_header_word(word: str) -> str:
    """Normaliza una palabra de cabecera: sin acentos, lowercase, sin espacios."""
    if not word:
        return ""
    s = word.strip().lower()
    replacements = {
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u",
        "ñ": "n", " ": "", ".": "", ":": "",
    }
    for src, dst in replacements.items():
        s = s.replace(src, dst)
    return s


# Mapping word → concept. Tolerante a variantes plural/abreviadas.
_HEADER_WORD_TO_CONCEPT: dict[str, ColumnConcept] = {
    "codigo": ColumnConcept.CODIGO,
    "cod": ColumnConcept.CODIGO,
    "resumen": ColumnConcept.RESUMEN,
    "descripcion": ColumnConcept.RESUMEN,
    "uds": ColumnConcept.UDS,
    "ud": ColumnConcept.UDS,
    "unid": ColumnConcept.UDS,
    "longitud": ColumnConcept.LONGITUD,
    "long": ColumnConcept.LONGITUD,
    "anchura": ColumnConcept.ANCHURA,
    "anch": ColumnConcept.ANCHURA,
    "altura": ColumnConcept.ALTURA,
    "alt": ColumnConcept.ALTURA,
    "parciales": ColumnConcept.PARCIALES,
    "parcial": ColumnConcept.PARCIALES,
    "cantidad": ColumnConcept.CANTIDAD,
    "cant": ColumnConcept.CANTIDAD,
    "precio": ColumnConcept.PRECIO,
    "importe": ColumnConcept.IMPORTE,
    "total": ColumnConcept.IMPORTE,
}


@dataclass(frozen=True)
class TabularColumn:
    """Una columna detectada en la cabecera tabular.

    Atributos:
      concept: concepto canónico (CÓDIGO, RESUMEN, ...).
      x_min: borde izquierdo (en pt, coordenadas PDF).
      x_max: borde derecho.
      x_center: punto medio horizontal — usado para asignación por nearest.
      header_word: el texto raw original que vio el detector (debug).
      page_number: 1-indexed; útil para telemetría.
    """

    concept: ColumnConcept
    x_min: float
    x_max: float
    x_center: float
    header_word: str
    page_number: int

    def contains_x(self, x: float, tolerance: float = 0.0) -> bool:
        """¿El x dado cae dentro del rango (con tolerancia opcional)?"""
        return (self.x_min - tolerance) <= x <= (self.x_max + tolerance)

    def distance_to(self, x: float) -> float:
        """Distancia absoluta entre x y el centro de la columna."""
        return abs(x - self.x_center)

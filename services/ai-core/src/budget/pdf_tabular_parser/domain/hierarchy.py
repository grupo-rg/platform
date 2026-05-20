"""ChapterHierarchy — cursor jerárquico actualizado durante el parseo.

Detecta y mantiene los 3 niveles típicos PRESTO:

- Nivel 1: CAPÍTULO XX <NOMBRE_MAYUS>
- Nivel 2: SUBCAPÍTULO XX.YY <Nombre>
- Nivel 3: APARTADO XX.YY.ZZ <Nombre>

Cada partida hereda el último capítulo/subcapítulo/apartado visto en orden
de aparición en el flujo del documento.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class HierarchyLevel(int, Enum):
    """Nivel jerárquico de un nodo organizativo."""

    CAPITULO = 1
    SUBCAPITULO = 2
    APARTADO = 3


@dataclass
class ChapterHierarchy:
    """Cursor mutable de la jerarquía actual durante el parseo.

    Cada vez que se detecta una declaración (`set_capitulo`, ...) se
    actualiza el nivel correspondiente Y se limpian los niveles inferiores
    (porque cambiar de capítulo invalida el subcapítulo previo).
    """

    capitulo_code: Optional[str] = None
    capitulo_name: Optional[str] = None
    subcapitulo_code: Optional[str] = None
    subcapitulo_name: Optional[str] = None
    apartado_code: Optional[str] = None
    apartado_name: Optional[str] = None

    def set_capitulo(self, code: str, name: str) -> None:
        """Set capítulo y limpia niveles inferiores."""
        self.capitulo_code = code
        self.capitulo_name = name
        self.subcapitulo_code = None
        self.subcapitulo_name = None
        self.apartado_code = None
        self.apartado_name = None

    def set_subcapitulo(self, code: str, name: str) -> None:
        """Set subcapítulo y limpia apartado (no toca capítulo)."""
        self.subcapitulo_code = code
        self.subcapitulo_name = name
        self.apartado_code = None
        self.apartado_name = None

    def set_apartado(self, code: str, name: str) -> None:
        """Set apartado (no toca niveles superiores)."""
        self.apartado_code = code
        self.apartado_name = name

    def get_chapter_label(self) -> str:
        """Devuelve el label del capítulo nivel 1 actual (formato `XX NOMBRE`)
        — compatible con el campo `chapter` de RestructuredItem.
        """
        if not self.capitulo_code and not self.capitulo_name:
            return "Sin Capítulo"
        parts = []
        if self.capitulo_code:
            parts.append(self.capitulo_code)
        if self.capitulo_name:
            parts.append(self.capitulo_name)
        return " ".join(parts).strip() or "Sin Capítulo"

    def get_sub_chapter_label(self) -> Optional[str]:
        """Devuelve subcapítulo en formato `XX.YY Nombre`, o None si no hay."""
        if not self.subcapitulo_code and not self.subcapitulo_name:
            return None
        parts = []
        if self.subcapitulo_code:
            parts.append(self.subcapitulo_code)
        if self.subcapitulo_name:
            parts.append(self.subcapitulo_name)
        label = " ".join(parts).strip()
        return label or None

    def has_any(self) -> bool:
        """¿Hay al menos un nivel definido?"""
        return bool(self.capitulo_code or self.capitulo_name)

    def snapshot(self) -> "ChapterHierarchy":
        """Copia inmutable de la jerarquía actual — para asignar a un partida."""
        return ChapterHierarchy(
            capitulo_code=self.capitulo_code,
            capitulo_name=self.capitulo_name,
            subcapitulo_code=self.subcapitulo_code,
            subcapitulo_name=self.subcapitulo_name,
            apartado_code=self.apartado_code,
            apartado_name=self.apartado_name,
        )

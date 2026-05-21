"""TabularExtractionResult — output del parser TABULAR.

Encapsula partidas extraídas + métricas de viabilidad. El caller usa
`is_viable()` para decidir si seguir con el resultado o caer a LLM Vision.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from src.budget.pdf_tabular_parser.domain.hierarchy import ChapterHierarchy


@dataclass
class TabularPartida:
    """Partida individual extraída por el parser TABULAR.

    Estructura intermedia (no es RestructuredItem todavía — la conversión
    final ocurre en el adapter al pipeline).
    """

    code: str
    description: str
    unit: str
    quantity: Optional[float]  # None = no se pudo extraer (NO 1.0 default — explicit fail)
    chapter: str               # capítulo nivel 1, formato `XX NOMBRE`
    sub_chapter: Optional[str] = None  # subcapítulo nivel 2, formato `XX.YY Nombre`
    apartado: Optional[str] = None     # apartado nivel 3, formato `XX.YY.ZZ Nombre`
    page_number: Optional[int] = None  # 1-indexed
    notes: Optional[str] = None
    # Hierarchy snapshot al momento de extraer la partida — debugging.
    hierarchy_snapshot: Optional[ChapterHierarchy] = None


@dataclass
class PageMetrics:
    """Métricas de extracción de una sola página."""

    page_number: int
    has_header: bool
    rows_found: int
    partidas_extracted: int
    qty_found: int  # cuántas partidas tienen qty != None


@dataclass
class TabularExtractionResult:
    """Resultado del parseo tabular completo de un PDF.

    `is_viable()` aplica las heurísticas A6 del spec:
    - ≥80% partidas con qty real (no None).
    - ≥80% partidas con capítulo detectado.
    - Si NO se encontró cabecera en ninguna página → no viable, `reason=no_header`.
    """

    partidas: List[TabularPartida] = field(default_factory=list)
    page_metrics: List[PageMetrics] = field(default_factory=list)
    duration_seconds: float = 0.0
    pages_total: int = 0
    pages_with_header: int = 0
    reason: Optional[str] = None  # filled if not viable
    annexed: bool = False  # True si se usó el modo PRESTO ANNEXED (Fase D)
    annexed_transition_page: Optional[int] = None  # página donde inician los totales
    annexed_totals_found: int = 0  # nº de totales detectados en fase ANNEXED
    annexed_matched: int = 0  # nº de cabeceras que matchean con totals
    annexed_orphans: int = 0  # nº de cabeceras sin match en totals
    # Modo del parser: "INLINE" (Fase A), "ANNEXED" (Fase D) o "MU02_INLINE" (Fase E).
    # Si None, el parser no completó (typically antes de la decisión de modo).
    mode: Optional[str] = None
    # Métricas específicas MU02 (Fase E).
    mu02_pages_with_header: int = 0
    # Sprint 4 Fase F — metadata del documento extraída de las primeras líneas
    # de la página 1. Útil para el título del Budget downstream y para el operador
    # que valida en la UI. Si no se pudo extraer, queda None.
    # Ejemplos reales:
    #   document_title="Roger de lluria_OBRA CIVIL" (RdLL)
    #   document_title="REFORMA DE LOCAL DESTINADO A CLINICA DENTAL"
    #     document_address="SITO EN C. BARÓ DE PINOPAR, 9 - 07012 PALMA DE MALLORCA"
    #   document_title="MU02-"
    #     document_address="Pol.11-Parc.213"
    document_title: Optional[str] = None
    document_address: Optional[str] = None

    @property
    def partidas_count(self) -> int:
        return len(self.partidas)

    @property
    def qty_rate(self) -> float:
        """Fracción de partidas con qty no-None (sobre total partidas).

        Si no hay partidas, retorna 0.0 (no NaN, no excepciones).
        """
        if not self.partidas:
            return 0.0
        with_qty = sum(1 for p in self.partidas if p.quantity is not None)
        return with_qty / len(self.partidas)

    @property
    def chapter_rate(self) -> float:
        """Fracción de partidas con capítulo no-vacío y no-"Sin Capítulo"."""
        if not self.partidas:
            return 0.0
        with_chapter = sum(
            1 for p in self.partidas
            if p.chapter and p.chapter.strip() and p.chapter != "Sin Capítulo"
        )
        return with_chapter / len(self.partidas)

    def is_viable(self) -> bool:
        """¿El resultado es lo suficientemente bueno para reemplazar LLM Vision?

        Criterios estándar (modo INLINE/TABULAR):
        - Al menos una página tiene cabecera detectada.
        - qty_rate >= 0.80.
        - chapter_rate >= 0.80.
        - partidas_count >= 1 (no es trivialmente vacío).

        Criterios ANNEXED (Fase D — más relajados al inicio porque el match
        rate puede ser bajo si hay desalineamiento entre cabeceras y totales):
        - partidas_count >= 1.
        - qty_rate >= 0.50 (al menos 50% de cabeceras tienen quantity asignada
          via mapping con totals dict).
        - chapter_rate NO se exige (en ANNEXED puede ser legítimamente bajo si
          el aparejador no usa capítulos explícitos).
        """
        if self.partidas_count == 0:
            self.reason = "no_partidas_extracted"
            return False

        if self.mode == "MU02_INLINE":
            # MU02_INLINE (Fase E): qty_rate >= 0.80, chapter_rate sin umbral
            # (MU02 siempre tiene capítulos numerados explícitos, pero por
            # robustez aceptamos extracción aunque algunos no se mapeen).
            if self.qty_rate < 0.80:
                self.reason = f"low_qty_rate_mu02 ({self.qty_rate:.2%} < 80%)"
                return False
            self.reason = None
            return True

        if self.annexed:
            # ANNEXED: relax qty threshold to 0.50, no chapter requirement.
            if self.qty_rate < 0.50:
                self.reason = f"low_qty_rate_annexed ({self.qty_rate:.2%} < 50%)"
                return False
            self.reason = None
            return True

        # Modo estándar (INLINE/TABULAR).
        if self.pages_with_header == 0:
            self.reason = "no_header_detected"
            return False
        if self.qty_rate < 0.80:
            self.reason = f"low_qty_rate ({self.qty_rate:.2%} < 80%)"
            return False
        if self.chapter_rate < 0.80:
            self.reason = f"low_chapter_rate ({self.chapter_rate:.2%} < 80%)"
            return False
        self.reason = None
        return True

    def to_restructured_items(self):
        """Conversión a `RestructuredItem` del pipeline existente.

        Import lazy para no acoplar el dominio al adapter en import time.
        """
        from src.budget.pdf_tabular_parser.application.restructured_adapter import (
            tabular_to_restructured_items,
        )

        return tabular_to_restructured_items(self.partidas)

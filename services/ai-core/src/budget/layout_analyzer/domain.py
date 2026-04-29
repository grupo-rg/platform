"""Modelos de dominio del Layout Analyzer (Fase 9 spike)."""
from __future__ import annotations

from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field


# Taxonomía calibrada empíricamente sobre los 3 goldens disponibles.
# - INLINE_WITH_TITLES: cada partida (código + título + tipo + unidad) viene seguida
#   de su bloque descriptivo INLINE en el flujo del documento, mediciones al final
#   de la descripción. Ej: SANITAS DENTAL (C01.01 Partida m2 TITULO + párrafo +
#   medidas), MU02 (1.1 Ud TITULO + Incluye: + 1,00 Ud).
# - TABLE_TABULAR: partidas en filas de tabla regular con columnas
#   [Código, Resumen, Ud, Cantidad, Precio]. Comunes en exports Excel.
# - TWO_PHASE_ANNEXED: descripciones en una sección, sumatorios en sección
#   separada (típicamente al final). El extractor ANNEXED actual asume esto.
# - UNKNOWN: nada cuadra con confianza ≥ 0.5.
LayoutType = Literal[
    "INLINE_WITH_TITLES",
    "TABLE_TABULAR",
    "TWO_PHASE_ANNEXED",
    "UNKNOWN",
]


class PartidaCandidate(BaseModel):
    """Una partida detectada por heurísticas determinísticas (sin LLM)."""

    code: str = Field(description='Ej. "C04.02", "1.1", "10.02.04"')
    title: str = Field(description="Título nominal extraído de la fila tabular")
    unit: Optional[str] = Field(default=None, description="m2, m3, ud, ml, kg, h, PA…")
    quantity: Optional[float] = Field(default=None, description="Cantidad si fue detectable")
    description: Optional[str] = Field(
        default=None,
        description="Bloque descriptivo concatenado si está disponible inline",
    )
    page: int = Field(description="Página 1-indexed donde se detectó")
    method: Literal["regex_inline", "regex_tabular", "regex_with_continuation"] = Field(
        description="Cómo se extrajo (telemetría)",
    )


class ChapterEntry(BaseModel):
    """Capítulo detectado en el documento."""

    prefix: str = Field(description='Ej. "C01", "C02", "1"')
    name: str = Field(description="Nombre del capítulo, sin el prefijo")
    partidas_count: int = Field(default=0, description="Cuántas partidas pertenecen")
    page_first_seen: int = Field(description="Primera página donde apareció")


class CrossPageCandidate(BaseModel):
    """Partida cuya descripción potencialmente está cortada por salto de página."""

    partida_code: str
    header_page: int = Field(description="Página donde se vio solo el título tabular")
    description_page_estimated: int = Field(description="Página donde empezaría el bloque descriptivo")
    reason: str = Field(description="Por qué se sospecha (description corta, sin verbo de obra, etc.)")


class LayoutClassification(BaseModel):
    type: LayoutType
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: List[str] = Field(
        default_factory=list,
        description="Lista de razones que sostienen la clasificación, en lenguaje natural",
    )


class LayoutFingerprint(BaseModel):
    """Resultado del LayoutAnalyzer. Serializable a JSON + Markdown."""

    file: str
    pages: int
    text_extractable: bool
    layout: LayoutClassification

    detected_partidas_count: int
    extracted_via_heuristics_count: int
    needs_llm_count: int
    partidas_sample: List[PartidaCandidate] = Field(
        default_factory=list,
        description="Primeras 10 partidas detectadas, para inspección",
    )

    chapters: List[ChapterEntry] = Field(default_factory=list)
    cross_page_candidates: List[CrossPageCandidate] = Field(default_factory=list)
    anomalies: List[str] = Field(
        default_factory=list,
        description="Hallazgos legibles para el operador: capítulos duplicados, partidas sin descripción, etc.",
    )

    def to_markdown(self) -> str:
        """Render legible del fingerprint para inspección manual."""
        lines: List[str] = []
        lines.append(f"# Layout Analysis — {self.file}")
        lines.append("")
        lines.append(f"- **Pages**: {self.pages}")
        lines.append(f"- **Text extractable**: {self.text_extractable}")
        lines.append(
            f"- **Layout detected**: `{self.layout.type}` "
            f"(confidence {self.layout.confidence:.2f})"
        )
        lines.append("")
        if self.layout.evidence:
            lines.append("### Evidence")
            for ev in self.layout.evidence:
                lines.append(f"- {ev}")
            lines.append("")

        lines.append("## Partidas")
        lines.append(f"- Detected: **{self.detected_partidas_count}**")
        lines.append(f"- Heuristic extracted (no LLM): **{self.extracted_via_heuristics_count}**")
        lines.append(f"- Needs LLM (ambiguous): **{self.needs_llm_count}**")
        lines.append("")

        if self.partidas_sample:
            lines.append("### Sample partidas")
            lines.append("| Code | Unit | Qty | Page | Method | Title |")
            lines.append("|---|---|---|---|---|---|")
            for p in self.partidas_sample:
                title_short = (p.title[:60] + "…") if len(p.title) > 60 else p.title
                lines.append(
                    f"| {p.code} | {p.unit or '—'} | {p.quantity or '—'} | "
                    f"{p.page} | {p.method} | {title_short} |"
                )
            lines.append("")

        if self.chapters:
            lines.append("## Chapters detected")
            lines.append("| Prefix | Name | Partidas | First page |")
            lines.append("|---|---|---|---|")
            for ch in self.chapters:
                lines.append(
                    f"| {ch.prefix} | {ch.name} | {ch.partidas_count} | {ch.page_first_seen} |"
                )
            lines.append("")

        if self.cross_page_candidates:
            lines.append("## Cross-page description candidates")
            lines.append("| Code | Header page | Description (est.) page | Reason |")
            lines.append("|---|---|---|---|")
            for c in self.cross_page_candidates:
                lines.append(
                    f"| {c.partida_code} | {c.header_page} | "
                    f"{c.description_page_estimated} | {c.reason} |"
                )
            lines.append("")

        if self.anomalies:
            lines.append("## Anomalies")
            for a in self.anomalies:
                lines.append(f"- {a}")
            lines.append("")

        return "\n".join(lines)

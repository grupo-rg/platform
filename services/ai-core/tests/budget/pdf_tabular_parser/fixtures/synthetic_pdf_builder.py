"""Generador de PDFs sintéticos con layout PRESTO TABULAR conocido.

Reportlab no es dependencia productiva — solo de tests. Si no está disponible,
los tests que lo usan se skipean.

Cada PDF generado expone:
- Una cabecera tabular en cada página.
- N capítulos / partidas / mediciones / summary rows configurables.
- Coordenadas estables (mismo ancho por columna) para validación determinista.

Uso típico:

    from .synthetic_pdf_builder import build_presto_tabular_pdf

    pdf_bytes = build_presto_tabular_pdf(
        chapters=[
            ("01", "ACTUACIONES PREVIAS", [
                ("01.01", "ud", "Replanteo general", 1.0),
                ("01.02", "m2", "Limpieza de obra", 100.5),
            ]),
        ]
    )
"""
from __future__ import annotations

import io
from typing import List, Optional, Tuple

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False


# --- Layout constants — coordenadas en pt (A4 = 595×842). ---
PAGE_WIDTH, PAGE_HEIGHT = A4 if REPORTLAB_AVAILABLE else (595.0, 842.0)

# X-coords de cada columna (calibradas para parecerse a PRESTO real).
COL_X = {
    "codigo": 30,
    "resumen": 90,
    "uds": 260,
    "longitud": 300,
    "anchura": 340,
    "altura": 380,
    "parciales": 420,
    "cantidad": 470,
    "precio": 510,
    "importe": 550,
}

HEADER_Y_OFFSET = 30  # top margin
LINE_HEIGHT = 14


# A list of partidas grouped under a chapter:
#   [(code, name, partidas: [(code, unit, title, qty), ...])]
ChapterSpec = Tuple[str, str, List[Tuple[str, str, str, Optional[float]]]]


def build_presto_tabular_pdf(
    chapters: List[ChapterSpec],
    include_header_per_page: bool = True,
    page_break_every: int = 30,
) -> bytes:
    """Genera un PDF con layout PRESTO TABULAR.

    Args:
        chapters: lista de capítulos. Cada capítulo es `(code, name, partidas)`.
        include_header_per_page: si True, repite la cabecera al inicio de cada
            página (comportamiento real PRESTO).
        page_break_every: rompe página cada N partidas para forzar multi-page.

    Returns:
        bytes del PDF generado.
    """
    if not REPORTLAB_AVAILABLE:
        raise RuntimeError("reportlab not installed; install to run synthetic PDF tests")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 9)

    y_cursor = PAGE_HEIGHT - HEADER_Y_OFFSET
    partidas_in_page = 0

    def draw_header():
        nonlocal y_cursor
        c.setFont("Helvetica-Bold", 9)
        c.drawString(COL_X["codigo"], y_cursor, "CÓDIGO")
        c.drawString(COL_X["resumen"], y_cursor, "RESUMEN")
        c.drawString(COL_X["uds"], y_cursor, "UDS")
        c.drawString(COL_X["longitud"], y_cursor, "LONGITUD")
        c.drawString(COL_X["anchura"], y_cursor, "ANCHURA")
        c.drawString(COL_X["altura"], y_cursor, "ALTURA")
        c.drawString(COL_X["parciales"], y_cursor, "PARCIALES")
        c.drawString(COL_X["cantidad"], y_cursor, "CANTIDAD")
        c.drawString(COL_X["precio"], y_cursor, "PRECIO")
        c.drawString(COL_X["importe"], y_cursor, "IMPORTE")
        c.setFont("Helvetica", 9)
        y_cursor -= LINE_HEIGHT * 1.5

    def maybe_page_break():
        nonlocal y_cursor, partidas_in_page
        if y_cursor < 80 or partidas_in_page >= page_break_every:
            c.showPage()
            c.setFont("Helvetica", 9)
            y_cursor = PAGE_HEIGHT - HEADER_Y_OFFSET
            if include_header_per_page:
                draw_header()
            partidas_in_page = 0

    if include_header_per_page:
        draw_header()

    for chap_code, chap_name, partidas in chapters:
        # Declaración de capítulo. Formato: "CAPÍTULO 01 ACTUACIONES PREVIAS".
        c.drawString(COL_X["codigo"], y_cursor, f"CAPÍTULO {chap_code} {chap_name}")
        y_cursor -= LINE_HEIGHT
        partidas_in_page += 0  # capítulo no cuenta como partida

        for p_code, p_unit, p_title, p_qty in partidas:
            maybe_page_break()

            # Cabecera de partida: "01.01 m2 Demolición de tabique".
            # La ponemos a través del code, con unit y title después.
            c.drawString(COL_X["codigo"], y_cursor, p_code)
            c.drawString(COL_X["resumen"], y_cursor, f"{p_unit} {p_title}")
            y_cursor -= LINE_HEIGHT

            # Fila de medición.
            if p_qty is not None:
                c.drawString(COL_X["resumen"], y_cursor, "Zona descripción")
                c.drawString(COL_X["uds"], y_cursor, "1")
                c.drawString(COL_X["longitud"], y_cursor, f"{p_qty:.2f}".replace(".", ","))
                c.drawString(COL_X["cantidad"], y_cursor, f"{p_qty:.3f}".replace(".", ","))
                y_cursor -= LINE_HEIGHT

                # Summary row "CANT PRECIO IMPORTE".
                c.drawString(
                    COL_X["cantidad"], y_cursor, f"{p_qty:.3f}".replace(".", ","),
                )
                c.drawString(COL_X["precio"], y_cursor, "0,00")
                c.drawString(COL_X["importe"], y_cursor, "0,00")
                y_cursor -= LINE_HEIGHT * 1.5

            partidas_in_page += 1

    c.save()
    return buf.getvalue()

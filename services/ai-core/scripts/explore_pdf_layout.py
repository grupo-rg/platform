"""Sprint 3.B Fase A0 — exploración del layout del PDF original COAATMCA.

Objetivo: ANTES de escribir el parser de extracción, mapear con datos REALES
cómo está estructurado el PDF (`docs/Palma47_2025_COAATMCA.pdf`). El parser
de extracción del catálogo (Fase A) se construirá según el spec que salga de
esta exploración.

Estrategia:
  1. Lee N páginas muestra (seleccionadas para cubrir casos típicos + edge).
  2. Para cada página extrae con pdfplumber: words (con coords), lines
     (horizontales), tables (si las hay).
  3. Clasifica regiones: header (top ~10%), body (middle), footer (bottom).
  4. Detecta candidatos a:
        - Códigos de partida    (regex `^[A-Z]{2,4}\\d{3,4}[a-z]?$`)
        - Códigos de breakdown   (regex `^(mt|mo|mq)\\w+$` o `^%$`)
        - Sub-capítulos          (texto en negrita / underline dentro del body)
        - Footer de capítulo     (texto en bottom con formato `CATEGORIA  /  Subsección`)
        - Paginación             (`Página \\d+`)
  5. Output JSON con TODO lo encontrado, para análisis manual posterior.

NO escribe spec ni parser — solo descubre. El spec se redacta a mano leyendo
este output.

Uso:
    python services/ai-core/scripts/explore_pdf_layout.py
        --pdf docs/Palma47_2025_COAATMCA.pdf
        --pages 12,100,250,436,437,444,471,474,477
        --output data/catalog_source/layout_exploration.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import pdfplumber
except ImportError:
    print("[ERROR] pdfplumber no está instalado. Ejecuta con services/ai-core/venv/Scripts/python.exe")
    sys.exit(2)


# ---------------------------------------------------------------------------
# Regex de detección
# ---------------------------------------------------------------------------

# Códigos de partida: 2-4 letras MAYÚSCULAS + 3-4 dígitos + opcional letra minúscula.
# Ejemplos vistos: DQC040, LVC010, XFB010, 0XA110b, YMM010, YMM011.
# El "0XA110b" sugiere que también empieza con dígito a veces.
RE_ITEM_CODE = re.compile(r"^[A-Z0-9]{1,4}[A-Z]{1,3}\d{2,4}[a-z]?$")

# Códigos de breakdown: empiezan con mt / mo / mq / au seguidos de alfanum,
# o solo "%" para medios auxiliares.
RE_BREAKDOWN_CODE = re.compile(r"^(mt|mo|mq|au|MT|MO|MQ|AU)[\w]+$|^%$")

# Paginación: "Página \\d+" generalmente al final.
RE_PAGE_NUMBER = re.compile(r"^P[áa]gina\s+\d+$", re.IGNORECASE)

# Unidades canónicas que aparecen junto al código (m², m³, ml, u, kg, t, h, l).
RE_UNIT = re.compile(r"^(m[²23]?|ud?|kg|t|h|l|ml|%|pa)$", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Layout regions
# ---------------------------------------------------------------------------

def region_of(word_y: float, page_height: float) -> str:
    """Clasifica una y-coord en header / body / footer."""
    rel = word_y / page_height
    if rel < 0.10:
        return "header"
    if rel > 0.92:
        return "footer"
    return "body"


# ---------------------------------------------------------------------------
# Análisis por página
# ---------------------------------------------------------------------------

def analyze_page(page: "pdfplumber.page.Page", page_no: int) -> Dict[str, Any]:
    """Extrae estructura cruda + candidatos clasificados de UNA página."""
    height = page.height
    width = page.width

    # Words con coordenadas + atributos de font.
    raw_words = page.extract_words(
        x_tolerance=2,
        y_tolerance=3,
        keep_blank_chars=False,
        use_text_flow=False,
        extra_attrs=["fontname", "size"],
    )

    # Convertir cada word a estructura ligera con region tag.
    words: List[Dict[str, Any]] = []
    for w in raw_words:
        words.append({
            "text": w["text"],
            "x0": round(w["x0"], 2),
            "x1": round(w["x1"], 2),
            "y0": round(w["top"], 2),
            "y1": round(w["bottom"], 2),
            "font": w.get("fontname", ""),
            "size": round(w.get("size", 0.0), 2),
            "region": region_of(w["top"], height),
        })

    # Líneas horizontales (separadores).
    horizontal_lines = [
        {"x0": round(l["x0"], 2), "x1": round(l["x1"], 2),
         "y0": round(l["top"], 2), "y1": round(l["bottom"], 2),
         "width": round(l["x1"] - l["x0"], 2)}
        for l in page.lines
        if abs(l["bottom"] - l["top"]) < 1.0  # casi-horizontal
        and (l["x1"] - l["x0"]) > 100  # suficientemente largas
    ]

    # Tablas detectadas (si las hay).
    try:
        tables = page.extract_tables() or []
    except Exception:
        tables = []
    tables_meta: List[Dict[str, Any]] = []
    for i, tbl in enumerate(tables):
        if not tbl:
            continue
        # Solo bbox y dimensión, no el contenido completo (lo capturamos
        # via words igualmente y mantenemos el JSON manejable).
        rows = len(tbl)
        cols = max((len(r) for r in tbl), default=0)
        tables_meta.append({
            "index": i,
            "rows": rows,
            "cols": cols,
            "first_row_preview": [str(c)[:60] if c else "" for c in tbl[0]],
        })

    # Candidatos: para cada word, ver si matchea un patrón conocido.
    candidates = {
        "item_codes": [],
        "breakdown_codes": [],
        "units": [],
        "page_numbers": [],
        "potential_chapter_headers": [],  # words grandes en region=header
        "potential_subchapters": [],       # words negrita en region=body, en líneas cortas
    }

    # Para detectar líneas: agrupar words por y-coord (≈línea de texto).
    lines_by_y: Dict[int, List[Dict[str, Any]]] = {}
    for w in words:
        ykey = int(round(w["y0"] / 2)) * 2  # agrupar con tolerancia ±1
        lines_by_y.setdefault(ykey, []).append(w)
    # Sort cada línea por x.
    for k in lines_by_y:
        lines_by_y[k].sort(key=lambda w: w["x0"])
    # Sort líneas por y.
    sorted_y_keys = sorted(lines_by_y.keys())

    # Words con font size > avg + std → potenciales headers.
    sizes = [w["size"] for w in words if w["size"] > 0]
    avg_size = sum(sizes) / max(1, len(sizes))

    for w in words:
        t = w["text"]
        if RE_ITEM_CODE.match(t):
            candidates["item_codes"].append({
                "text": t, "x0": w["x0"], "y0": w["y0"], "region": w["region"],
            })
        if RE_BREAKDOWN_CODE.match(t):
            candidates["breakdown_codes"].append({
                "text": t, "x0": w["x0"], "y0": w["y0"], "region": w["region"],
            })
        if RE_UNIT.match(t) and w["region"] == "body":
            candidates["units"].append({
                "text": t, "x0": w["x0"], "y0": w["y0"],
            })
        if w["region"] == "footer" and "agina" in t.lower():
            # Construir contexto: word + siguientes 2 en misma y.
            ykey = int(round(w["y0"] / 2)) * 2
            same_line = lines_by_y.get(ykey, [])
            joined = " ".join(x["text"] for x in same_line if abs(x["y0"] - w["y0"]) < 4)
            candidates["page_numbers"].append({"text": joined, "y0": w["y0"]})
        if w["region"] == "header" and w["size"] > avg_size * 1.2 and len(t) > 3:
            candidates["potential_chapter_headers"].append({
                "text": t, "x0": w["x0"], "y0": w["y0"], "size": w["size"], "font": w["font"],
            })
        if (
            w["region"] == "body"
            and ("Bold" in w["font"] or "bold" in w["font"])
            and w["size"] >= avg_size
            and len(t) > 3
            and not RE_ITEM_CODE.match(t)
            and not RE_BREAKDOWN_CODE.match(t)
        ):
            candidates["potential_subchapters"].append({
                "text": t, "x0": w["x0"], "y0": w["y0"], "size": w["size"], "font": w["font"],
            })

    # Footer context: las líneas en los últimos 8% de la página (excepto Página N).
    footer_lines: List[str] = []
    for ykey in sorted_y_keys:
        line_words = lines_by_y[ykey]
        if not line_words:
            continue
        if region_of(line_words[0]["y0"], height) != "footer":
            continue
        line_text = " ".join(w["text"] for w in line_words)
        if RE_PAGE_NUMBER.match(line_text.strip()):
            continue
        if line_text.strip():
            footer_lines.append(line_text)

    return {
        "page": page_no,
        "dim": {"width": round(width, 2), "height": round(height, 2)},
        "stats": {
            "word_count": len(words),
            "header_words": sum(1 for w in words if w["region"] == "header"),
            "body_words": sum(1 for w in words if w["region"] == "body"),
            "footer_words": sum(1 for w in words if w["region"] == "footer"),
            "avg_font_size": round(avg_size, 2),
            "horizontal_lines_count": len(horizontal_lines),
            "tables_detected": len(tables_meta),
        },
        "candidates": candidates,
        "horizontal_lines": horizontal_lines,
        "tables": tables_meta,
        "footer_lines": footer_lines,
        # Sample de las primeras 30 líneas de body para revisión humana.
        "body_lines_sample": [
            " ".join(w["text"] for w in lines_by_y[ykey])
            for ykey in sorted_y_keys
            if lines_by_y[ykey] and region_of(lines_by_y[ykey][0]["y0"], height) == "body"
        ][:30],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Explore PDF layout for COAATMCA catalog parser design.")
    parser.add_argument(
        "--pdf",
        default="docs/Palma47_2025_COAATMCA.pdf",
        help="Path al PDF del catálogo.",
    )
    parser.add_argument(
        "--pages",
        default="12,100,250,436,437,444,471,474,477",
        help="Comma-separated 1-based page numbers a explorar.",
    )
    parser.add_argument(
        "--output",
        default="data/catalog_source/layout_exploration.json",
        help="JSON de salida con el análisis.",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f"[ERROR] PDF no encontrado: {pdf_path}", file=sys.stderr)
        return 1

    page_nos = [int(p.strip()) for p in args.pages.split(",") if p.strip()]

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Abriendo {pdf_path} ...")
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        print(f"PDF: {total} páginas totales.")

        analyses: List[Dict[str, Any]] = []
        for pno in page_nos:
            if pno < 1 or pno > total:
                print(f"  [skip] página {pno} fuera de rango (1-{total}).")
                continue
            print(f"  analizando página {pno} ...")
            page = pdf.pages[pno - 1]
            analyses.append(analyze_page(page, pno))

    summary = {
        "pdf": str(pdf_path),
        "total_pages": total,
        "explored_pages": [a["page"] for a in analyses],
        "pages": analyses,
    }

    output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nOutput escrito en: {output_path}")
    print(f"  {len(analyses)} páginas analizadas, {sum(a['stats']['word_count'] for a in analyses)} words totales.")
    print(f"\nResumen rápido por página:")
    for a in analyses:
        c = a["candidates"]
        print(
            f"  p{a['page']:>3d}: "
            f"items={len(c['item_codes']):>3d}, "
            f"breakdowns={len(c['breakdown_codes']):>3d}, "
            f"chapters_hdr={len(c['potential_chapter_headers']):>2d}, "
            f"subch_bold={len(c['potential_subchapters']):>2d}, "
            f"footer={a['footer_lines']!r}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Utilidad one-off: extrae los cuadros base del PDF del libro COAATMCA.

Este script es el **Intento 1** que menciona el plan (sección 3). No es el
camino principal de producción — el camino principal es el JSON versionado
en `data/coaatmca_2025_cuadros_base.json` + `seed_labor_rates_2025.py`.

Uso:
  python scripts/extract_coaatmca_cuadros_base.py --pdf "C:/ruta/al/libro.pdf"
  python scripts/extract_coaatmca_cuadros_base.py --pdf <path> --pages 6-10

Comportamiento:
  1. Abre el PDF con pdfplumber.
  2. Para cada página solicitada, extrae tablas y texto plano.
  3. Pinta a stdout lo que encuentra, en un formato cercano al schema
     LaborRate para que un humano lo pueda copiar/mergear al JSON.
  4. Si ninguna tabla se detecta (PDF de imagen/escaneo), lo dice y
     recomienda el fallback manual.

No escribe al JSON automáticamente. Toda edición del JSON pasa por humano
y revisión en PR — los precios son contractualmente sensibles.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import pdfplumber

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def parse_pages(spec: str) -> list[int]:
    """'6-10' -> [6,7,8,9,10]; '6,7,10' -> [6,7,10]."""
    pages: list[int] = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            pages.extend(range(int(a), int(b) + 1))
        else:
            pages.append(int(chunk))
    return pages


def extract_page(pdf_path: Path, page_num: int) -> dict:
    """Devuelve tablas + texto plano detectados en la página (1-indexed)."""
    with pdfplumber.open(str(pdf_path)) as pdf:
        if page_num - 1 >= len(pdf.pages):
            raise IndexError(f"Página {page_num} fuera de rango (PDF tiene {len(pdf.pages)}).")
        page = pdf.pages[page_num - 1]
        tables = page.extract_tables() or []
        text = page.extract_text() or ""
    return {"page": page_num, "tables": tables, "text": text}


def heuristic_labor_rate_rows(table: list[list[str]]) -> list[dict]:
    """Heurística mínima: una fila es una labor rate si hay un precio/€ y un label.

    Output: lista de candidatos con la forma del schema LaborRate. El humano
    valida y corrige IDs, categories (enum), trades, aliases.
    """
    candidates: list[dict] = []
    for row in table:
        if not row or all(not c for c in row):
            continue
        cells = [str(c).strip() if c else "" for c in row]
        # Buscamos algo que parezca un precio: un número con decimal + "€" o "/h".
        price_cell = next(
            (c for c in cells if _looks_like_price(c)),
            None,
        )
        label_cell = next((c for c in cells if len(c) > 3 and not _looks_like_price(c)), None)
        if price_cell and label_cell:
            candidates.append({
                "label_es_raw": label_cell,
                "rate_raw": price_cell,
                "row_cells": cells,
            })
    return candidates


def _looks_like_price(cell: str) -> bool:
    c = cell.replace(" ", "")
    if not c:
        return False
    if "€" in c or "/h" in c.lower():
        return True
    # Un número con coma decimal (estilo europeo): "28,50"
    import re
    return bool(re.fullmatch(r"\d{1,3}([.,]\d{1,2})?", c))


def main() -> int:
    parser = argparse.ArgumentParser(description="Extrae cuadros base del PDF COAATMCA.")
    parser.add_argument("--pdf", required=True, help="Ruta al PDF del libro COAATMCA.")
    parser.add_argument("--pages", default="6-10", help="Páginas a extraer (ej. '6-10' o '6,7,10').")
    args = parser.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        logger.error(f"PDF no encontrado: {pdf_path}")
        return 1

    pages = parse_pages(args.pages)
    logger.info(f"Procesando páginas {pages} de {pdf_path.name}")

    total_candidates = 0
    for pnum in pages:
        try:
            data = extract_page(pdf_path, pnum)
        except Exception as e:
            logger.error(f"Página {pnum}: fallo extracción ({e}).")
            continue

        tables = data["tables"]
        if not tables:
            logger.warning(
                f"Página {pnum}: no se detectaron tablas. "
                f"El PDF puede ser imagen/escaneo. Usa el fallback manual "
                f"(data/coaatmca_2025_cuadros_base.json)."
            )
            continue

        print(f"\n=== PÁGINA {pnum} — {len(tables)} tabla(s) detectada(s) ===")
        for t_idx, table in enumerate(tables):
            candidates = heuristic_labor_rate_rows(table)
            total_candidates += len(candidates)
            print(f"--- Tabla {t_idx + 1}: {len(candidates)} candidato(s) de labor rate ---")
            for c in candidates:
                print(json.dumps(c, ensure_ascii=False, indent=2))

    if total_candidates == 0:
        logger.warning(
            "No se extrajo ninguna labor rate. "
            "Probable fallback: editar data/coaatmca_2025_cuadros_base.json manualmente."
        )
        return 1

    logger.info(f"✅ {total_candidates} candidatos pintados. Revisa manualmente y mergea al JSON.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

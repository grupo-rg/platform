"""Sprint 4 Fase D — analiza patrones de mediciones en PDFs de estados de
mediciones del cliente Grupo RG.

Para cada PDF identifica:
  - Donde viven las CABECERAS de partidas (regex code XX.YY + opcional "Partida"
    + unidad + titulo).
  - Donde viven las FILAS DE MEDICION (factor longitud ancho alto = parcial,
    todas decimales en una linea).
  - Donde viven los TOTALES (`Total <CODE> <qty>`).
  - Formato del codigo de Total (prefijo, niveles).

Output: tabla por PDF + resumen agregado para diseñar el parser ANNEXED.
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

import pdfplumber

REPO_ROOT = Path(__file__).resolve().parents[3]
PDFS_DIR = Path(r"C:\Users\Usuario\Documents\Grupo RG\test - mediciones\grupo-rg\estados-de-mediciones")

# Cabecera de partida con palabra "Partida" o sin ella.
RE_PARTIDA_HEADER = re.compile(r'^(\d{1,3}\.\d{1,3}(?:\.\d{1,3})?)(?:\s+(?:Partida|partida))?\s+([A-Za-z\xc0-\xff%\xb2\xb3²³]{1,4})\s+(.+)$')

# Fila tabular de medicion: 2-5 numeros decimales separados por espacio.
RE_MEASUREMENT_ROW = re.compile(r'^\s*\d+[,.]\d+(?:\s+\d+[,.]\d+){1,4}\s*$')

# Total: "Total <CODE> <qty> [0,00 0,00]"
RE_TOTAL_FLEX = re.compile(r'^Total\s+(?P<code>[\w.-]+)\s+(?P<qty>\d+[,.]\d+)')

# Capitulo: "XX [Capítulo] NOMBRE"
RE_CHAPTER = re.compile(r'^(\d{1,3}(?:PC\d+)?(?:\.\d+)?)\s+(?:Cap[\xed\xed]tulo\s+)?([A-Z\xc1\xc9\xcd\xd3\xda\xd1][^\n]{2,80})$')


def analyze_pdf(pdf_path: Path) -> None:
    print(f"\n{'=' * 78}")
    print(f"PDF: {pdf_path.name}")
    print(f"{'=' * 78}")

    pages_with_headers = []  # paginas con cabeceras de partida
    pages_with_measurements = []
    pages_with_totals = []
    total_codes_format: Counter[str] = Counter()  # patrón de prefijo
    sample_totals = []

    with pdfplumber.open(pdf_path) as pdf:
        n = len(pdf.pages)
        print(f"  Total pages: {n}")
        for i, page in enumerate(pdf.pages, start=1):
            t = page.extract_text() or ''
            lines = t.split('\n')
            n_part = sum(1 for l in lines if RE_PARTIDA_HEADER.match(l))
            n_meas = sum(1 for l in lines if RE_MEASUREMENT_ROW.match(l))
            n_total = 0
            for l in lines:
                m = RE_TOTAL_FLEX.match(l)
                if m:
                    n_total += 1
                    code = m.group('code')
                    # Clasificar prefijo
                    if '-' in code:
                        prefix = code.split('-', 1)[0]
                    elif code[0].isalpha():
                        prefix = re.match(r'[A-Za-z]+', code).group(0)
                    else:
                        prefix = '<numeric>'
                    total_codes_format[prefix] += 1
                    if len(sample_totals) < 8:
                        sample_totals.append((i, l.strip()[:80]))
            if n_part > 0:
                pages_with_headers.append(i)
            if n_meas > 0:
                pages_with_measurements.append(i)
            if n_total > 0:
                pages_with_totals.append(i)

    def page_summary(pages):
        if not pages:
            return "(none)"
        return f"{len(pages)} pp (range {min(pages)}-{max(pages)})"

    print(f"  Páginas con cabeceras de partida: {page_summary(pages_with_headers)}")
    print(f"  Páginas con filas de medición:    {page_summary(pages_with_measurements)}")
    print(f"  Páginas con totales:               {page_summary(pages_with_totals)}")
    print()
    if total_codes_format:
        print(f"  Formato de codigos en totales (prefijo -> count):")
        for prefix, count in total_codes_format.most_common():
            print(f"    {prefix!r:>15s}  {count:>4d}")
    if sample_totals:
        print(f"  Muestra de líneas Total (primeras 8):")
        for pno, line in sample_totals:
            print(f"    p{pno:>3d}:  {line}")


def main() -> int:
    if not PDFS_DIR.exists():
        print(f"[ERROR] {PDFS_DIR} no existe.", file=sys.stderr)
        return 1
    pdfs = sorted(PDFS_DIR.glob("*.pdf")) + sorted(PDFS_DIR.glob("*.PDF"))
    pdfs = [p for p in pdfs if p.is_file()]
    print(f"Encontrados {len(pdfs)} PDFs en {PDFS_DIR}")
    for pdf in pdfs:
        analyze_pdf(pdf)
    return 0


if __name__ == "__main__":
    sys.exit(main())

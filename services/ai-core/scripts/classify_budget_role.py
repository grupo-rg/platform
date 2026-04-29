"""Fase 5.H.0b — Clasifica cada PDF del histórico como INPUT (mediciones sin
precios, listo para alimentar el pipeline) u OUTPUT (presupuesto tasado por
Grupo RG, verdad humana).

Estrategia determinista sin LLM:
  - Abre las primeras 3 y últimas 3 páginas de cada PDF con pdfplumber.
  - Busca señales de "output" (precios, totales): "PEM", "PEC", "Gastos
    Generales", "Beneficio Industrial", "Total Presupuesto", "IVA 21",
    "€" en líneas con números decimales, patrones "xxx,xx €".
  - Si la densidad de señales supera un umbral → OUTPUT. Si no → INPUT.
  - Casos sin texto extraíble (PDFs escaneados) → UNKNOWN (decisión manual).

Output:
  C:\\Users\\Usuario\\Documents\\consultorIA\\basis\\presupuestos-organizados\\
  budget_roles.csv  —  filename;role;price_signal_score;sample_hits;pages_read.
"""
from __future__ import annotations

import argparse
import csv
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import pdfplumber

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


DEFAULT_TARGET = Path(
    r"C:\Users\Usuario\Documents\consultorIA\basis\presupuestos-organizados"
)

# Patrones. Los que miden "precio en el PDF" suben el score; los que miden
# "mediciones puras" no restan, solo sirven como negative evidence si no hay
# señales de precio.

PRICE_KEYWORDS = [
    r"\bPEM\b",
    r"\bPEC\b",
    r"Presupuesto de Ejecución Material",
    r"Presupuesto de Ejecución por Contrata",
    r"Gastos Generales",
    r"Beneficio Industrial",
    r"Total Presupuesto",
    r"Total Ejecución",
    r"IVA\s*21\s*%",
    r"Base Imponible",
    r"Importe Total",
    r"\bTOTAL\s+[\d.,]+\s*€",
]

# Patrón de "precio formateado": 1.234,56 € o 1234,56€ al final de línea
PRICE_NUMBER = re.compile(
    r"\d{1,3}(?:\.\d{3})*,\d{2}\s*€|\d+,\d{2}\s*€"
)

# Patrón de columnas de cantidad + unidad (mediciones)
MEASUREMENT_COL = re.compile(
    r"\d+[,.]?\d*\s*(m2|m²|m3|m³|ml|ud|u\.|kg|t|l\.|pa|h)\s*$",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass
class ClassificationResult:
    filename: str
    role: str  # INPUT | OUTPUT | UNKNOWN
    price_signal_score: int
    measurement_signal_score: int
    sample_hits: List[str]
    pages_read: int
    error: Optional[str] = None


def _classify_text(text: str) -> Tuple[int, int, List[str]]:
    """Devuelve (price_score, measurement_score, sample_hits)."""
    price_score = 0
    sample_hits: List[str] = []

    for kw in PRICE_KEYWORDS:
        m = re.search(kw, text, re.IGNORECASE)
        if m:
            price_score += 2
            if len(sample_hits) < 3:
                sample_hits.append(m.group())

    number_matches = PRICE_NUMBER.findall(text)
    if number_matches:
        price_score += min(len(number_matches), 10)  # cap
        if len(sample_hits) < 3:
            sample_hits.append(f"{len(number_matches)} precios €")

    meas_score = len(MEASUREMENT_COL.findall(text))
    return price_score, meas_score, sample_hits


def classify_pdf(path: Path, max_pages: int = 6) -> ClassificationResult:
    if not path.exists() or path.suffix.lower() != ".pdf":
        return ClassificationResult(
            filename=path.name, role="UNKNOWN", price_signal_score=0,
            measurement_signal_score=0, sample_hits=[], pages_read=0,
            error="no pdf",
        )
    try:
        with pdfplumber.open(path) as pdf:
            n = len(pdf.pages)
            # Leemos primeras y últimas (los totales siempre aparecen al final)
            idx_first = list(range(min(3, n)))
            idx_last = list(range(max(0, n - 3), n))
            idx = sorted(set(idx_first + idx_last))
            pages_read = len(idx)
            text_parts: List[str] = []
            for i in idx:
                try:
                    t = pdf.pages[i].extract_text() or ""
                    text_parts.append(t)
                except Exception:
                    continue
            text = "\n".join(text_parts)
    except Exception as e:
        return ClassificationResult(
            filename=path.name, role="UNKNOWN", price_signal_score=0,
            measurement_signal_score=0, sample_hits=[], pages_read=0,
            error=str(e)[:80],
        )

    if not text.strip():
        return ClassificationResult(
            filename=path.name, role="UNKNOWN", price_signal_score=0,
            measurement_signal_score=0, sample_hits=[], pages_read=pages_read,
            error="no text (scanned?)",
        )

    price_score, meas_score, hits = _classify_text(text)

    # Decisión: ≥ 3 → OUTPUT. 0 + mediciones ≥ 3 → INPUT. resto UNKNOWN.
    if price_score >= 3:
        role = "OUTPUT"
    elif price_score == 0 and meas_score >= 3:
        role = "INPUT"
    elif price_score <= 2 and meas_score >= 5:
        # Pocas señales de precio pero muchas mediciones → probable INPUT
        role = "INPUT"
    else:
        role = "UNKNOWN"

    return ClassificationResult(
        filename=path.name,
        role=role,
        price_signal_score=price_score,
        measurement_signal_score=meas_score,
        sample_hits=hits,
        pages_read=pages_read,
    )


def run(source: Path, target: Path, csv_filter: Optional[Path] = None) -> None:
    if not source.exists():
        raise FileNotFoundError(source)

    if csv_filter and csv_filter.exists():
        # Solo los filenames que aparezcan en la col "filename" del CSV
        with csv_filter.open(encoding="utf-8") as fh:
            names = {r["filename"] for r in csv.DictReader(fh, delimiter=";")}
        files = [source / n for n in names if (source / n).exists() and n.lower().endswith(".pdf")]
    else:
        files = [p for p in source.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"]

    logger.info(f"Clasificando {len(files)} PDFs desde {source}")

    results: List[ClassificationResult] = []
    for i, p in enumerate(files, 1):
        if i % 25 == 0:
            logger.info(f"  {i}/{len(files)}...")
        results.append(classify_pdf(p))

    target.mkdir(parents=True, exist_ok=True)
    out = target / "budget_roles.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["filename", "role", "price_score", "meas_score",
                    "sample_hits", "pages_read", "error"])
        for r in results:
            w.writerow([
                r.filename, r.role, r.price_signal_score,
                r.measurement_signal_score,
                " | ".join(r.sample_hits),
                r.pages_read,
                r.error or "",
            ])

    # Resumen por rol
    from collections import Counter
    c = Counter(r.role for r in results)
    for role, n in c.most_common():
        logger.info(f"  {role}: {n} archivos")
    logger.info(f"→ CSV: {out}")


def _parse_cli():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", type=Path, default=Path(
        r"C:\Users\Usuario\Documents\consultorIA\basis\presupuestos-a-organizar"))
    ap.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    ap.add_argument("--only-golden", action="store_true",
                    help="Solo procesa archivos que están en golden según project_groups.csv")
    return ap.parse_args()


if __name__ == "__main__":
    args = _parse_cli()
    csv_filter: Optional[Path] = None
    if args.only_golden:
        # Filtrar por project_groups.csv → category=00-golden-candidates-2025
        pg = args.target / "project_groups.csv"
        if pg.exists():
            tmp = args.target / "_only_golden.csv"
            with pg.open(encoding="utf-8") as src_fh, tmp.open(
                    "w", newline="", encoding="utf-8") as tgt_fh:
                reader = csv.DictReader(src_fh, delimiter=";")
                writer = csv.DictWriter(tgt_fh, fieldnames=reader.fieldnames,
                                        delimiter=";")
                writer.writeheader()
                for row in reader:
                    if row["category"] == "00-golden-candidates-2025":
                        writer.writerow(row)
            csv_filter = tmp
    run(args.source, args.target, csv_filter=csv_filter)

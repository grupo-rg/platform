"""Fase 5.H (Golden 001) — parser determinista de presupuestos Presto.

Consume `P030326.pdf` (o cualquier PDF del mismo formato) y produce un
`expected.json` estructurado listo para el benchmark `eval_golden_budgets.py`.

Formato Presto detectado (ver tests/test_parse_p030326.py para fixtures):

  Capítulo nº {num} {NOMBRE}
  Nº Ud Descripción Medición Precio Importe
  {num_dotted} {code} {unit} {descripción multi-línea...}
  [opcional subtotales: "Uds. Largo Ancho Alto Parcial Subtotal" + líneas zona]
  Total {unit} : {quantity} {unitPrice} € {totalPrice} €
  ...
  Presupuesto de ejecución material
  {chapter_num} {NOMBRE} {total} €
  ...
  Total .........: {PEM} €

Uso:
    venv/Scripts/python.exe scripts/parse_p030326_to_expected.py \\
        --input evals/golden_budgets/001-mu02-p030326/expected_raw.pdf \\
        --output evals/golden_budgets/001-mu02-p030326/expected.json
"""
from __future__ import annotations

import argparse
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# -------- Entities ----------------------------------------------------------


@dataclass
class Partida:
    num: str                    # "1.1", "4.1.9"
    code: str                   # "ACCESO", "EHV030b"
    chapter_num: int            # 1, 4, ...
    unit: str                   # "Ud", "M²", "M³", "m", ...
    description: str            # multi-línea concatenada
    quantity: float
    unitPrice: float
    totalPrice: float


@dataclass
class Chapter:
    num: int
    name: str
    total: Optional[float] = None  # del resumen final de PEM


# -------- Regex -------------------------------------------------------------

# "Capítulo nº 1 ACTUACIONES PREVIAS"
RE_CHAPTER_HEADER = re.compile(r"Cap[ií]tulo\s+n[º°]?\s+(\d+)\s+(.+?)$", re.MULTILINE)

# "1.1 ACCESO Ud Acondicioanmiento..."
# "4.1.9 EHV030b M³ Formación..."
# "1.2 VALLADO M Vallado..."
# "1.1 ACCESO� Ud ..." — algunos PDFs meten un superscript/replacement char
# pegado al code; lo aceptamos con `[^\s]*` después del grupo alfanumérico y
# descartamos la basura (solo queda el grupo capturado).
RE_PARTIDA_START = re.compile(
    r"^(\d+(?:\.\d+){1,3})\s+([A-Za-z0-9]+)[^\s]*\s+"
    r"(M[²³]?|Ud|UD|ud|PA|pa|m|ml|Kg|kg|t|H|h|€)\s+(.*)$"
)

# "Total Ud : 1,00 1.210,00 € 1.210,00 €"
# "Total m² : 720,00 2,15 € 1.548,00 €"
# Acepta variantes "m" "M²" "M³" "Ud" "ud" etc.
RE_TOTAL_LINE = re.compile(
    r"^Total\s+(M[²³]?|m[²³]?|Ud|UD|ud|PA|pa|m|ml|Kg|kg|t|H|h)\s*:\s*"
    r"([\d.,]+)\s+([\d.,]+)\s*€\s+([\d.,]+)\s*€"
)

# Línea del resumen final: "1 ACTUACIONES PREVIAS 9.695,00 €"
# O "4.1.- ESTRUCTURA VIVIENDA 80.124,17 €" (sub-capítulos con "4.1.-")
RE_SUMMARY_CHAPTER = re.compile(
    r"^(\d+)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-z0-9\s,/]+?)\s+([\d.,]+)\s*€\s*$"
)

# "Total .........: 549.636,90 €"
RE_PEM_TOTAL = re.compile(r"Total\s*\.*\s*:\s*([\d.,]+)\s*€")


def _parse_es_number(s: str) -> float:
    """Convierte '1.210,00' o '720,00' o '2,15' a float."""
    s = s.strip().replace(".", "").replace(",", ".")
    return float(s)


def parse_presto_text(text: str) -> Dict[str, Any]:
    """Devuelve {chapters, partidas, pem_total}."""
    lines = text.split("\n")
    partidas: List[Partida] = []
    chapters: Dict[int, Chapter] = {}
    pem_total: Optional[float] = None

    current_chapter: Optional[int] = None
    # Estado cuando estamos acumulando descripción de una partida abierta:
    pending: Optional[Dict[str, Any]] = None  # {num, code, unit, chapter_num, desc_lines}

    for raw_line in lines:
        line = raw_line.rstrip()
        if not line.strip():
            continue

        # ¿Cabecera de capítulo?
        m = RE_CHAPTER_HEADER.search(line)
        if m:
            num = int(m.group(1))
            name = m.group(2).strip()
            current_chapter = num
            if num not in chapters:
                chapters[num] = Chapter(num=num, name=name)
            # Si estábamos en una partida sin cerrar, la descartamos (defensive).
            pending = None
            continue

        # ¿PEM total al final?
        m = RE_PEM_TOTAL.search(line)
        if m and "Presupuesto" not in line:
            # Solo aceptamos si la línea dice realmente "Total ......: X €"
            # y no algo como "Total m² : ...". La distinción: RE_TOTAL_LINE
            # requiere unidad tras Total, así que este match es válido solo
            # si no casa también como total de partida.
            if not RE_TOTAL_LINE.match(line):
                try:
                    pem_total = _parse_es_number(m.group(1))
                except ValueError:
                    pass
            # Fallthrough: puede ser también línea de resumen.

        # ¿Línea del resumen final por capítulo? "1 ACTUACIONES PREVIAS 9.695,00 €"
        # Solo la aplicamos si NO hay partida abierta y NO casa Partida start.
        if pending is None and not RE_PARTIDA_START.match(line):
            m = RE_SUMMARY_CHAPTER.match(line)
            if m:
                try:
                    cnum = int(m.group(1))
                    cname = m.group(2).strip()
                    ctotal = _parse_es_number(m.group(3))
                    # Solo escribimos el total; nombre puede variar ligeramente del header.
                    ch = chapters.setdefault(cnum, Chapter(num=cnum, name=cname))
                    ch.total = ctotal
                    continue
                except (ValueError, IndexError):
                    pass

        # ¿Inicio de partida?
        m = RE_PARTIDA_START.match(line)
        if m:
            # Si había una partida pendiente sin cerrar (no debería, pero defensive),
            # la descartamos — solo guardamos las que tienen Total explícito.
            if current_chapter is None:
                continue  # no hay chapter todavía, skip
            pending = {
                "num": m.group(1),
                "code": m.group(2),
                "unit": m.group(3),
                "chapter_num": current_chapter,
                "desc_lines": [m.group(4).strip()],
            }
            continue

        # ¿Total de partida que cierra la partida pendiente?
        m = RE_TOTAL_LINE.match(line)
        if m and pending is not None:
            try:
                qty = _parse_es_number(m.group(2))
                unit_price = _parse_es_number(m.group(3))
                total_price = _parse_es_number(m.group(4))
            except ValueError:
                pending = None
                continue

            description = " ".join(
                l.strip() for l in pending["desc_lines"] if l.strip()
            )
            partidas.append(Partida(
                num=pending["num"],
                code=pending["code"],
                chapter_num=pending["chapter_num"],
                unit=pending["unit"],
                description=description,
                quantity=qty,
                unitPrice=unit_price,
                totalPrice=total_price,
            ))
            pending = None
            continue

        # Si estamos dentro de una partida, acumulamos descripción.
        # Filtramos líneas ruido (cabeceras de tabla de zonas, números sueltos).
        if pending is not None:
            lower = line.lower().strip()
            if lower.startswith("uds. largo") or lower.startswith("uds.largo"):
                continue  # header de tabla de zonas
            # Líneas de desglose por zona tienen muchos números — las saltamos.
            # Heurística: línea casi enteramente numérica (≥50 % dígitos).
            digits = sum(1 for c in line if c.isdigit())
            if len(line) > 0 and digits / len(line) > 0.35:
                continue
            pending["desc_lines"].append(line.strip())

    return {
        "chapters": list(chapters.values()),
        "partidas": partidas,
        "pem_total": pem_total,
    }


# -------- PDF integration ---------------------------------------------------


def parse_pdf(path: Path) -> Dict[str, Any]:
    import pdfplumber
    parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return parse_presto_text("\n".join(parts))


def emit_expected_json(result: Dict[str, Any], out_path: Path) -> None:
    chapters = [asdict(c) for c in result["chapters"]]
    partidas = [asdict(p) for p in result["partidas"]]

    # Marcamos el caso canónico (partida 1.1 ACCESO de acondicionamiento).
    # El PDF original tiene el typo "Acondicioanmiento" (con 'a' de más),
    # por eso el check es "acondicio" y no "acondicion".
    for p in partidas:
        p["canonical_case"] = (
            p["num"] == "1.1"
            and p["chapter_num"] == 1
            and "acondicio" in p["description"].lower()
        )

    payload = {
        "golden_id": "001-mu02-p030326",
        "source": "P030326.pdf",
        "pem_total": result["pem_total"],
        "chapters": chapters,
        "partidas": partidas,
        "partidas_count": len(partidas),
    }
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(f"Escrito {out_path} con {len(partidas)} partidas, "
                f"PEM total = {result['pem_total']}")


def _parse_cli() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--input", type=Path, required=True,
                    help="PDF de entrada (p.ej. expected_raw.pdf)")
    ap.add_argument("--output", type=Path, required=True,
                    help="expected.json de salida")
    return ap.parse_args()


if __name__ == "__main__":
    args = _parse_cli()
    result = parse_pdf(args.input)
    emit_expected_json(result, args.output)

"""Fase 5.H.0 — Organización determinista del histórico de presupuestos.

Clasifica los archivos de `C:\\Users\\Usuario\\Documents\\consultorIA\\basis\\
presupuestos-a-organizar` en 4 carpetas temáticas dentro de
`presupuestos-organizados/`, agrupando por proyecto y detectando la versión
"final" de cada uno:

  00-golden-candidates-2025/  → proyectos con fecha 2025, última versión, con
                                posible hermano .xlsx / .bc3 para expected.json.
  01-aprobados-pre-2025/      → lo mismo pero años anteriores (valor didáctico).
  02-borradores-sin-cierre/   → versiones intermedias (V1 con un V2+ superior).
  99-formato-raro/            → .zip .dwg .pzh y archivos sin fecha reconocible.

Decisiones:
  - NO usa LLM: todo determinista por regex + slug normalizado. Rápido, gratis,
    reproducible. Coexiste con `organize_budgets_folder.py` que sí usa Gemini.
  - NO destruye el origen: siempre copia con shutil.copy2 (stat preservado).
  - --dry-run imprime el plan sin tocar el disco.
  - Emite `project_groups.csv` con el mapping completo + `CANDIDATES.md` con
    un checklist para el operador.
"""
from __future__ import annotations

import argparse
import csv
import logging
import re
import shutil
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logging.basicConfig(
    level=logging.INFO, format="%(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)


DEFAULT_SOURCE = Path(
    r"C:\Users\Usuario\Documents\consultorIA\basis\presupuestos-a-organizar"
)
DEFAULT_TARGET = Path(
    r"C:\Users\Usuario\Documents\consultorIA\basis\presupuestos-organizados"
)

# Regex de la fecha YYYYMMDD al principio (con opcional separador), aceptando
# prefijos laxos ("05.06.24_..." lo tratamos luego como no-fecha estándar).
DATE_AT_START = re.compile(r"^(20\d{2})[-_.\s]?(\d{2})[-_.\s]?(\d{2})[\s_-]+")

# Palabras que son ruido para el slug (minúsculas). Se eliminan antes de tokenizar.
STOPWORDS = {
    "pdf", "xlsx", "xls", "bc3", "doc", "docx", "zip", "dwg", "pzh",
    "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8",
    "rev01", "rev02", "rev03", "rev1", "rev2", "rev",
    "revisado", "revisada", "corregido", "corregida", "firma",
    "definitivo", "final", "anexo", "sinmaterial", "sin", "material",
    "copia", "de", "y", "a", "la", "el", "los", "las",
    "ppto", "presupuesto", "mediciones", "medicion",
}
VERSION_ANYWHERE = re.compile(
    r"(?:^|[\s_\-\(])(v\d+|rev\s*0?\d+|revisad[oa]\d?)(?=[\s_\-\)\.]|$)",
    re.IGNORECASE,
)


@dataclass
class ParsedFile:
    path: Path
    name: str
    ext: str                      # ".pdf" | ".xlsx" | ".bc3" | ...
    date: Optional[date]          # YYYYMMDD del nombre si existe
    version_num: int              # versión numérica extraída del sufijo (0 si no hay)
    project_slug: str             # tokens clave en snake_case
    is_raw_format: bool = False   # .zip/.dwg/.pzh → al 99
    raw_tail: str = ""            # para debug: lo que quedó tras parsear


def _normalize_slug(raw: str) -> str:
    """Convierte tokens del nombre en un slug estable.

    "REFORMA HOTEL MARTE - TIBIDOY" → "hotel_marte_tibidoy_reforma"
    "CP LLUIS MARTI" → "cp_lluis_marti"
    """
    stripped = raw.lower()
    # Reemplazar separadores por espacio
    for ch in "-_.()/\\,":
        stripped = stripped.replace(ch, " ")
    tokens = [t for t in stripped.split() if t and t not in STOPWORDS]
    # Filtrar tokens numéricos sueltos (residuos de fecha) excepto códigos 2-letras+num
    tokens = [t for t in tokens if not t.isdigit() or len(t) <= 3]
    # Quitar duplicados preservando orden
    seen: set[str] = set()
    uniq: list[str] = []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            uniq.append(t)
    # Ordenar alfabéticamente los primeros tokens para estabilidad de grouping:
    # así "reforma hotel marte" y "hotel marte reforma" colisionan al mismo slug.
    uniq_sorted = sorted(uniq)
    return "_".join(uniq_sorted[:6])  # cap a 6 tokens para evitar slugs gigantes


def _extract_version(tail: str) -> Tuple[str, int]:
    """Devuelve (tail_sin_versión ni descripción post-versión, n).

    Ejemplos:
      "CP LLUIS MARTI V6_solo local" → ("CP LLUIS MARTI", 6)
      "TIBIDOY-VALLDEMOSSA_rev2"     → ("TIBIDOY-VALLDEMOSSA", 2)
      "HOTEL BELLVER"                → ("HOTEL BELLVER", 0)

    Cualquier texto después del token de versión se descarta para el slug,
    porque suele ser metadata de la revisión ("_solo local", "_sin_materiales").
    """
    m = VERSION_ANYWHERE.search(tail)
    if not m:
        return tail, 0
    token = m.group(1).lower()
    digits = re.search(r"\d+", token)
    num = int(digits.group()) if digits else 1
    # Corta antes del token (descarta versión + post-versión).
    return tail[: m.start()].rstrip(), num


def parse_filename(path: Path) -> ParsedFile:
    name = path.name
    ext = path.suffix.lower()
    is_raw = ext in {".zip", ".dwg", ".pzh", ".docx", ".doc"}

    # Separamos la extensión
    base = path.stem

    # Fecha al inicio
    file_date: Optional[date] = None
    m = DATE_AT_START.match(base)
    rest = base
    if m:
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            file_date = date(y, mo, d)
            rest = base[m.end():]
        except ValueError:
            pass  # fecha inválida, se ignora

    # Versión al final
    rest_no_version, version_num = _extract_version(rest)

    # Slug a partir de lo que queda
    slug = _normalize_slug(rest_no_version) or "sin_titulo"

    return ParsedFile(
        path=path,
        name=name,
        ext=ext,
        date=file_date,
        version_num=version_num,
        project_slug=slug,
        is_raw_format=is_raw,
        raw_tail=rest_no_version,
    )


# ----------------- Grouping -----------------

YEAR_GOLDEN = 2025  # date.year >= YEAR_GOLDEN → candidato a golden.


@dataclass
class ProjectGroup:
    slug: str
    files: List[ParsedFile] = field(default_factory=list)

    @property
    def latest(self) -> ParsedFile:
        """El archivo más nuevo: por fecha, luego versión, luego extensión (pdf > xlsx > bc3)."""
        ext_priority = {".pdf": 3, ".xlsx": 2, ".xls": 2, ".bc3": 1}
        return max(
            self.files,
            key=lambda f: (
                f.date or date.min,
                f.version_num,
                ext_priority.get(f.ext.lower(), 0),
            ),
        )

    @property
    def latest_date(self) -> Optional[date]:
        return self.latest.date

    def companions(self, primary: ParsedFile) -> Dict[str, List[ParsedFile]]:
        """Archivos hermanos agrupados por extensión, excluyendo el primary."""
        out: Dict[str, List[ParsedFile]] = defaultdict(list)
        for f in self.files:
            if f is primary:
                continue
            out[f.ext.lower()].append(f)
        return dict(out)


def group_by_project(parsed: List[ParsedFile]) -> List[ProjectGroup]:
    buckets: Dict[str, ProjectGroup] = {}
    for p in parsed:
        if p.is_raw_format:
            # Formatos raros no entran al grouping — van directos al 99.
            continue
        g = buckets.setdefault(p.project_slug, ProjectGroup(slug=p.project_slug))
        g.files.append(p)
    return sorted(buckets.values(), key=lambda g: g.slug)


# ----------------- Clasificación a carpetas -----------------

GOLDEN = "00-golden-candidates-2025"
APPROVED_PRE_2025 = "01-aprobados-pre-2025"
INTERMEDIATE = "02-borradores-sin-cierre"
RAW = "99-formato-raro"


def classify(parsed: List[ParsedFile]) -> Dict[str, List[Tuple[Path, str]]]:
    """Mapping categoría → lista de (src_file, slug_carpeta_destino)."""
    plan: Dict[str, List[Tuple[Path, str]]] = defaultdict(list)

    # 1. Formatos raros directo al 99 (sin agrupar).
    for f in parsed:
        if f.is_raw_format:
            plan[RAW].append((f.path, "_"))

    # 2. Resto, agrupado por proyecto.
    groups = group_by_project([f for f in parsed if not f.is_raw_format])
    for g in groups:
        latest = g.latest
        for f in g.files:
            if f is latest:
                if latest.date and latest.date.year >= YEAR_GOLDEN:
                    category = GOLDEN
                elif latest.date:
                    category = APPROVED_PRE_2025
                else:
                    # Sin fecha → al intermediate porque no podemos fecharlo.
                    category = INTERMEDIATE
                plan[category].append((f.path, g.slug))
            else:
                # Versión no-latest → intermediate, guardada bajo el slug del grupo
                # para que el operador vea las iteraciones juntas.
                plan[INTERMEDIATE].append((f.path, g.slug))

    return dict(plan)


# ----------------- Ejecución -----------------


def copy_plan(
    plan: Dict[str, List[Tuple[Path, str]]],
    target: Path,
    dry_run: bool,
) -> Dict[str, int]:
    """Ejecuta la copia (o imprime qué haría)."""
    counts: Dict[str, int] = defaultdict(int)
    for category, items in plan.items():
        for src, slug in items:
            if category == RAW:
                dest_dir = target / category
            else:
                dest_dir = target / category / slug
            dest = dest_dir / src.name

            if dry_run:
                logger.info(f"[DRY] {category}/{slug}/  <  {src.name}")
            else:
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
            counts[category] += 1
    return dict(counts)


def write_project_groups_csv(
    parsed: List[ParsedFile],
    plan: Dict[str, List[Tuple[Path, str]]],
    target: Path,
) -> Path:
    """CSV con filename, project_slug, date, version, destination."""
    # Invertir el plan para saber destino por filename
    dest_by_name: Dict[str, Tuple[str, str]] = {}
    for cat, items in plan.items():
        for src, slug in items:
            dest_by_name[src.name] = (cat, slug)

    csv_path = target / "project_groups.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, delimiter=";")
        writer.writerow([
            "filename", "project_slug", "date", "version",
            "ext", "category", "destination_slug"
        ])
        for p in parsed:
            cat, slug = dest_by_name.get(p.name, ("?", "?"))
            writer.writerow([
                p.name,
                p.project_slug,
                p.date.isoformat() if p.date else "",
                p.version_num,
                p.ext,
                cat,
                slug,
            ])
    return csv_path


def write_candidates_md(
    plan: Dict[str, List[Tuple[Path, str]]],
    target: Path,
) -> Path:
    """Checklist markdown para que el operador marque ✅ en los golden finales."""
    md_path = target / GOLDEN / "CANDIDATES.md"
    md_path.parent.mkdir(parents=True, exist_ok=True)

    # Agrupar golden candidates por slug
    golden_by_slug: Dict[str, List[Path]] = defaultdict(list)
    for src, slug in plan.get(GOLDEN, []):
        golden_by_slug[slug].append(src)

    lines: List[str] = [
        "# Golden candidates 2025 — checklist de revisión humana",
        "",
        "Marca ✅ en los presupuestos que cumplen **todos** estos criterios:",
        "",
        "- [x] Firmado y/o facturado con el cliente",
        "- [x] La verdad humana (precios, cantidades) es la que defenderíais hoy",
        "- [x] Tenéis el Excel o BC3 hermano con el detalle de partidas",
        "",
        "Flujo: INLINE (PDF con mediciones inline) / ANNEXED (PDF con hoja de "
        "mediciones al final) / NL (sin PDF, solo brief textual).",
        "",
        "| ✅ | Proyecto | Archivos | Flujo (INLINE/ANNEXED/NL) | Excel/BC3 hermano | Notas |",
        "|---|---|---|---|---|---|",
    ]
    for slug in sorted(golden_by_slug):
        files = golden_by_slug[slug]
        files_str = "<br>".join(f"`{p.name}`" for p in files[:4])
        if len(files) > 4:
            files_str += f"<br>… ({len(files) - 4} más)"
        lines.append(f"| [ ] | `{slug}` | {files_str} |  |  |  |")

    lines.extend([
        "",
        "---",
        "",
        "**Objetivo**: 5 filas marcadas ✅ con mix 2 INLINE + 2 ANNEXED + 1 NL.",
        "Si no hay NL puro, marca el mejor candidato INLINE — crearemos un brief "
        "sintético que reproduzca ese presupuesto.",
    ])

    md_path.write_text("\n".join(lines), encoding="utf-8")
    return md_path


def run(source: Path, target: Path, dry_run: bool) -> None:
    if not source.exists():
        logger.error(f"Carpeta origen no existe: {source}")
        sys.exit(2)

    files = sorted(p for p in source.iterdir() if p.is_file())
    logger.info(f"{len(files)} archivos encontrados en {source}")

    parsed = [parse_filename(p) for p in files]
    plan = classify(parsed)

    # Reporte resumido
    logger.info(f"Plan de clasificación (dry_run={dry_run}):")
    for cat in [GOLDEN, APPROVED_PRE_2025, INTERMEDIATE, RAW]:
        items = plan.get(cat, [])
        slugs = {slug for _, slug in items if slug != "_"}
        logger.info(f"  {cat}: {len(items)} archivos / {len(slugs)} proyectos")

    counts = copy_plan(plan, target, dry_run=dry_run)

    if not dry_run:
        csv_path = write_project_groups_csv(parsed, plan, target)
        md_path = write_candidates_md(plan, target)
        logger.info(f"→ CSV mapping: {csv_path}")
        logger.info(f"→ Checklist:   {md_path}")

    total = sum(counts.values())
    action = "Planificadas" if dry_run else "Copiadas"
    logger.info(f"{action} {total} operaciones.")


def _parse_cli() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    ap.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    ap.add_argument("--dry-run", action="store_true", default=False)
    return ap.parse_args()


if __name__ == "__main__":
    args = _parse_cli()
    run(args.source, args.target, dry_run=args.dry_run)

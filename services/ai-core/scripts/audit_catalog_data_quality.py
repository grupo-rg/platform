"""Sprint 3 — S3-01: Catalog Data Quality Audit.

Escanea la colección Firestore `price_book_2025` (1,658 items + breakdowns
aprox.) buscando problemas de data quality que expliquen el ~50% de matches
con `from_scratch` o `confidence < 0.85` observado en smokes Sprint 1+2.

Issues detectadas:
  1. `unit_normalized` raros o vacíos: items sin unidad o con unidad no
     estándar (fuera de `{m2, m3, ml, kg, ud, h, l, t, %, pa}`).
  2. Descripciones DUPLICADAS pero con `code` diferente: posibles entradas dupes.
  3. Descripciones MUY SIMILARES (Levenshtein < 5 o normalizadas idénticas):
     candidatos a fusión.
  4. `chapter` NO listado en `data/construction_dag_2025.json` (huérfanos).
  5. Items sin breakdowns desglosados (priceTotal sin componentes).
  6. Items donde `priceTotal != sum(breakdowns.price)` con margen ±2%.

Output: CSV con `issue_type | code | description | current_value |
suggested_fix | severity`.

Severities:
  - `error`: matemática inconsistente, descripción vacía.
  - `warning`: similar a otra, unidad rara.
  - `info`: chapter huérfano del DAG (no es necesariamente un bug — algunos
    capítulos del libro COAATMCA quedan fuera del DAG por diseño).

Uso:
  $env:GOOGLE_APPLICATION_CREDENTIALS = "path\\to\\sa.json"
  python services/ai-core/scripts/audit_catalog_data_quality.py \
      --output audit_catalog_report.csv

Para usar credenciales explícitas vía .env:
  python services/ai-core/scripts/audit_catalog_data_quality.py
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
sys.path.insert(0, str(ROOT))

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tipos y constantes
# ---------------------------------------------------------------------------

# Conjunto canónico de unidades — alineado con `Unit.SYNONYMS` en
# `src/budget/catalog/domain/unit.py`. Las unidades fuera de aquí se marcan
# como "warning: unidad rara".
CANONICAL_UNITS = {"ud", "m2", "m3", "ml", "kg", "t", "h", "l", "%", "pa"}

# Margen relativo permitido entre `priceTotal` y `sum(breakdown.price)`.
PRICE_MISMATCH_TOLERANCE = 0.02  # ±2%

# Issue types — strings consistentes para que el CSV se filtre fácil.
ISSUE_UNIT_RARE_OR_EMPTY = "unit_rare_or_empty"
ISSUE_DUPLICATE_DESCRIPTION = "duplicate_description"
ISSUE_SIMILAR_DESCRIPTION = "similar_description"
ISSUE_CHAPTER_NOT_IN_DAG = "chapter_not_in_dag"
ISSUE_NO_BREAKDOWNS = "item_without_breakdowns"
ISSUE_PRICE_MISMATCH = "price_total_mismatch"
ISSUE_EMPTY_DESCRIPTION = "empty_description"

# Severities (sortable por orden de criticidad).
SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"
_SEVERITY_ORDER = {SEVERITY_ERROR: 0, SEVERITY_WARNING: 1, SEVERITY_INFO: 2}


# ---------------------------------------------------------------------------
# Firebase admin SDK bootstrap (mismo patrón que peek_vector_db.py).
# ---------------------------------------------------------------------------


def _init_firebase_admin() -> None:
    """Inicializa Firebase Admin SDK desde .env o ADC.

    Prefiere `GOOGLE_APPLICATION_CREDENTIALS` si está seteado (estándar GCP).
    Si no, usa las vars `FIREBASE_*` del .env y construye un Service Account
    en memoria. Fallback final: Application Default Credentials.
    """
    load_dotenv(ROOT / ".env")
    if firebase_admin._apps:
        return  # ya inicializado

    sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if sa_path and Path(sa_path).is_file():
        firebase_admin.initialize_app(credentials.Certificate(sa_path))
        logger.info(f"Firebase admin inicializado vía GOOGLE_APPLICATION_CREDENTIALS={sa_path}")
        return

    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")

    if project_id and client_email and private_key:
        info = {
            "type": "service_account",
            "project_id": project_id,
            "private_key_id": "auto",
            "private_key": private_key,
            "client_email": client_email,
            "client_id": "auto",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": (
                f"https://www.googleapis.com/robot/v1/metadata/x509/"
                f"{client_email.replace('@', '%40')}"
            ),
        }
        firebase_admin.initialize_app(credentials.Certificate(info))
        logger.info("Firebase admin inicializado vía FIREBASE_* env vars (.env).")
        return

    # Fallback: ADC.
    firebase_admin.initialize_app()
    logger.info("Firebase admin inicializado vía Application Default Credentials.")


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def _load_dag_chapters() -> set[str]:
    """Carga los `key` de los nodos del DAG. El audit compara cada `chapter`
    de Firestore contra esta lista (case-insensitive)."""
    dag_path = ROOT / "data" / "construction_dag_2025.json"
    if not dag_path.is_file():
        logger.warning(f"DAG no encontrado en {dag_path} — saltando check de chapter huérfano.")
        return set()
    with dag_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    keys: set[str] = set()
    for node in data.get("nodes", []):
        key = node.get("key")
        if key:
            keys.add(_normalize_chapter_str(key))
    # También incluimos los transversal_chapters declarados explícitamente.
    for tch in data.get("transversal_chapters", []):
        keys.add(_normalize_chapter_str(tch))
    logger.info(f"DAG cargado: {len(keys)} chapters reconocidos.")
    return keys


def _normalize_chapter_str(s: str) -> str:
    """Normaliza un nombre de capítulo para comparación tolerante:
    quita tildes, colapsa espacios, lowercase."""
    if not s:
        return ""
    # Decompose unicode and strip combining marks.
    decomposed = unicodedata.normalize("NFKD", s)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", stripped.strip().lower())


# ---------------------------------------------------------------------------
# Description similarity (Levenshtein with early-exit cutoff).
# ---------------------------------------------------------------------------


def _normalize_description(s: str) -> str:
    """Normalización agresiva para detección de duplicados:
    - Sin tildes.
    - Lowercase.
    - Sin puntuación.
    - Espacios colapsados.
    """
    if not s:
        return ""
    decomposed = unicodedata.normalize("NFKD", s)
    no_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    no_punct = re.sub(r"[^\w\s]", " ", no_accents.lower())
    return re.sub(r"\s+", " ", no_punct).strip()


def _levenshtein(a: str, b: str, max_distance: int = 5) -> int:
    """Distancia de Levenshtein con early-exit si supera `max_distance`.

    Algoritmo iterativo O(len_a * len_b) — suficiente para nuestro caso
    (descripciones de 50-150 chars). El early-exit asegura que cuando
    estamos comparando todos contra todos en N=1,658, los pares disimilares
    se descartan en O(min(len_a, len_b) * max_distance).
    """
    if a == b:
        return 0
    if abs(len(a) - len(b)) > max_distance:
        return max_distance + 1
    if len(a) < len(b):
        a, b = b, a

    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        min_in_row = curr[0]
        for j, cb in enumerate(b):
            cost = 0 if ca == cb else 1
            curr.append(min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost))
            if curr[-1] < min_in_row:
                min_in_row = curr[-1]
        if min_in_row > max_distance:
            return max_distance + 1
        prev = curr
    return prev[-1]


# ---------------------------------------------------------------------------
# Issue dataclass-lite
# ---------------------------------------------------------------------------


def _row(
    issue_type: str,
    code: str,
    description: str,
    current_value: str,
    suggested_fix: str,
    severity: str,
) -> Dict[str, str]:
    return {
        "issue_type": issue_type,
        "code": code,
        "description": description,
        "current_value": current_value,
        "suggested_fix": suggested_fix,
        "severity": severity,
    }


# ---------------------------------------------------------------------------
# Audit functions
# ---------------------------------------------------------------------------


def audit_unit_normalized(items: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Check 1: items sin unidad o con unidad fuera del canonical set."""
    rows: List[Dict[str, str]] = []
    for it in items:
        code = it.get("code", "")
        desc = (it.get("description") or "")[:200]
        unit_norm = it.get("unit_normalized")
        unit_raw = it.get("unit_raw", "")
        if unit_norm is None or unit_norm == "" or unit_norm not in CANONICAL_UNITS:
            rows.append(_row(
                issue_type=ISSUE_UNIT_RARE_OR_EMPTY,
                code=code,
                description=desc,
                current_value=f"unit_normalized={unit_norm!r}, unit_raw={unit_raw!r}",
                suggested_fix=(
                    "Revisar y mapear a una unidad canonical "
                    "(ud, m2, m3, ml, kg, t, h, l, %, pa)."
                ),
                severity=SEVERITY_WARNING,
            ))
    return rows


def audit_empty_descriptions(items: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Check: items con descripción vacía (severity=error)."""
    rows: List[Dict[str, str]] = []
    for it in items:
        code = it.get("code", "")
        desc = (it.get("description") or "").strip()
        if not desc:
            rows.append(_row(
                issue_type=ISSUE_EMPTY_DESCRIPTION,
                code=code,
                description="",
                current_value="description vacía",
                suggested_fix="Eliminar el item o reescribir la descripción.",
                severity=SEVERITY_ERROR,
            ))
    return rows


def audit_duplicate_descriptions(items: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Check 2: descripciones normalizadas IDÉNTICAS con código distinto."""
    rows: List[Dict[str, str]] = []
    norm_to_codes: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
    for it in items:
        code = it.get("code", "")
        desc = it.get("description") or ""
        norm = _normalize_description(desc)
        if not norm or not code:
            continue
        norm_to_codes[norm].append((code, desc))

    for norm, occurrences in norm_to_codes.items():
        unique_codes = {c for c, _ in occurrences}
        if len(unique_codes) > 1:
            sample_desc = occurrences[0][1][:200]
            other_codes = sorted(unique_codes)
            for code, desc in occurrences:
                # Reportar una fila por código duplicado.
                others = [c for c in other_codes if c != code]
                rows.append(_row(
                    issue_type=ISSUE_DUPLICATE_DESCRIPTION,
                    code=code,
                    description=desc[:200],
                    current_value=f"description normalizada idéntica a códigos: {others}",
                    suggested_fix=(
                        "Verificar si son entradas duplicadas y fusionar; "
                        "si son legítimamente distintas (variantes, libros), "
                        "diferenciar la descripción."
                    ),
                    severity=SEVERITY_WARNING,
                ))
    return rows


def audit_similar_descriptions(
    items: List[Dict[str, Any]],
    *,
    max_distance: int = 5,
    sample_cap_per_bucket: int = 50,
) -> List[Dict[str, str]]:
    """Check 3: descripciones MUY similares (Levenshtein ≤ `max_distance`).

    Optimización: comparamos solo dentro del mismo chapter — descripciones
    de capítulos distintos casi nunca son confusiones.

    Para evitar O(N²) total sobre 1,658, dentro de cada chapter limitamos
    a `sample_cap_per_bucket` comparaciones por item (las más cercanas en
    longitud — heurística).
    """
    rows: List[Dict[str, str]] = []
    by_chapter: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for it in items:
        chapter = it.get("chapter") or "Sin Capítulo"
        by_chapter[chapter].append(it)

    seen_pairs: set[Tuple[str, str]] = set()
    for chapter, bucket in by_chapter.items():
        if len(bucket) < 2:
            continue
        # Orden por longitud de descripción para heurística (similar length = similar text).
        sorted_bucket = sorted(
            [
                (it.get("code", ""), it.get("description") or "")
                for it in bucket
            ],
            key=lambda x: len(x[1]),
        )
        n = len(sorted_bucket)
        for i, (code_a, desc_a) in enumerate(sorted_bucket):
            norm_a = _normalize_description(desc_a)
            if not norm_a:
                continue
            for j in range(i + 1, min(i + sample_cap_per_bucket, n)):
                code_b, desc_b = sorted_bucket[j]
                norm_b = _normalize_description(desc_b)
                if not norm_b:
                    continue
                if norm_a == norm_b:
                    continue  # se reporta en duplicate_descriptions
                dist = _levenshtein(norm_a, norm_b, max_distance=max_distance)
                if dist <= max_distance:
                    pair_key = tuple(sorted([code_a, code_b]))
                    if pair_key in seen_pairs:
                        continue
                    seen_pairs.add(pair_key)
                    rows.append(_row(
                        issue_type=ISSUE_SIMILAR_DESCRIPTION,
                        code=code_a,
                        description=desc_a[:200],
                        current_value=f"Levenshtein={dist} contra código {code_b}: {desc_b[:120]!r}",
                        suggested_fix=(
                            "Verificar si son la misma partida con typos / "
                            "puntuación distinta. Fusionar si procede."
                        ),
                        severity=SEVERITY_WARNING,
                    ))
    return rows


def audit_chapter_not_in_dag(
    items: List[Dict[str, Any]], dag_keys: set[str],
) -> List[Dict[str, str]]:
    """Check 4: items cuyo `chapter` no está en `construction_dag_2025.json`."""
    if not dag_keys:
        return []
    rows: List[Dict[str, str]] = []
    seen_chapters: set[str] = set()
    for it in items:
        chapter = (it.get("chapter") or "").strip()
        if not chapter:
            continue
        norm = _normalize_chapter_str(chapter)
        if norm in dag_keys:
            continue
        if chapter in seen_chapters:
            continue  # un solo report por chapter huérfano
        seen_chapters.add(chapter)
        code = it.get("code", "")
        desc = (it.get("description") or "")[:200]
        rows.append(_row(
            issue_type=ISSUE_CHAPTER_NOT_IN_DAG,
            code=code,
            description=desc,
            current_value=f"chapter={chapter!r}",
            suggested_fix=(
                "Añadir el capítulo a construction_dag_2025.json, o "
                "renombrar el campo `chapter` del item para que coincida "
                "con un key existente del DAG."
            ),
            severity=SEVERITY_INFO,
        ))
    return rows


def audit_items_without_breakdowns(
    items: List[Dict[str, Any]],
    breakdowns_by_parent: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, str]]:
    """Check 5: items con `priceTotal` > 0 pero sin breakdowns desglosados."""
    rows: List[Dict[str, str]] = []
    for it in items:
        code = it.get("code", "")
        desc = (it.get("description") or "")[:200]
        price_total = float(it.get("priceTotal") or 0.0)
        if price_total <= 0:
            continue
        bks = breakdowns_by_parent.get(code, [])
        if not bks:
            rows.append(_row(
                issue_type=ISSUE_NO_BREAKDOWNS,
                code=code,
                description=desc,
                current_value=f"priceTotal={price_total:.2f}, breakdowns=0",
                suggested_fix=(
                    "Verificar si el item tiene componentes en el JSON fuente y "
                    "están siendo ingeridos. Si es una partida alzada legítima, "
                    "marcarla con is_lump_sum=true."
                ),
                severity=SEVERITY_WARNING,
            ))
    return rows


def audit_price_mismatch(
    items: List[Dict[str, Any]],
    breakdowns_by_parent: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, str]]:
    """Check 6: `priceTotal` vs `sum(breakdown.price)` con margen ±2%."""
    rows: List[Dict[str, str]] = []
    for it in items:
        code = it.get("code", "")
        desc = (it.get("description") or "")[:200]
        price_total = float(it.get("priceTotal") or 0.0)
        if price_total <= 0:
            continue
        bks = breakdowns_by_parent.get(code, [])
        if not bks:
            continue  # cubierto por audit_items_without_breakdowns
        bk_sum = sum(float(b.get("price") or 0.0) for b in bks)
        if bk_sum <= 0:
            # breakdowns con precio cero → reportable, pero no como mismatch.
            continue
        rel_diff = abs(price_total - bk_sum) / max(price_total, bk_sum)
        if rel_diff > PRICE_MISMATCH_TOLERANCE:
            rows.append(_row(
                issue_type=ISSUE_PRICE_MISMATCH,
                code=code,
                description=desc,
                current_value=(
                    f"priceTotal={price_total:.4f}, sum(breakdown.price)={bk_sum:.4f}, "
                    f"diff_rel={rel_diff:.2%}"
                ),
                suggested_fix=(
                    "Revisar el ingest del item: o el priceTotal está mal "
                    "asignado o falta(n) breakdown(s). Si la diferencia es "
                    "intencional (margen/redondeos), documentar."
                ),
                severity=SEVERITY_ERROR,
            ))
    return rows


# ---------------------------------------------------------------------------
# Firestore I/O
# ---------------------------------------------------------------------------


def fetch_price_book(db: Any) -> Tuple[List[Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]:
    """Lee toda la colección `price_book_2025` en una sola pasada.

    Devuelve:
      - items: lista de docs con `kind=='item'`.
      - breakdowns_by_parent: mapping `parent_code → [breakdown dicts]`.
    """
    items: List[Dict[str, Any]] = []
    breakdowns_by_parent: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    col = db.collection("price_book_2025")
    count = 0
    for snap in col.stream():
        data = snap.to_dict() or {}
        # No leer el embedding (heavy, ~30 KB por doc).
        data.pop("embedding", None)
        kind = data.get("kind", "item")
        if kind == "breakdown":
            parent = data.get("parent_code", "")
            if parent:
                breakdowns_by_parent[parent].append(data)
        else:
            items.append(data)
        count += 1
        if count % 200 == 0:
            logger.info(f"  ...leídos {count} docs")

    logger.info(
        f"price_book_2025: {count} docs totales — "
        f"{len(items)} items, "
        f"{sum(len(v) for v in breakdowns_by_parent.values())} breakdowns."
    )
    return items, breakdowns_by_parent


# ---------------------------------------------------------------------------
# CSV writer
# ---------------------------------------------------------------------------


def write_csv(rows: List[Dict[str, str]], output_path: Path) -> None:
    """Escribe el CSV ordenado por severity (error → warning → info) y luego
    por issue_type."""
    rows_sorted = sorted(
        rows,
        key=lambda r: (
            _SEVERITY_ORDER.get(r["severity"], 99),
            r["issue_type"],
            r["code"],
        ),
    )
    fieldnames = ["issue_type", "code", "description", "current_value", "suggested_fix", "severity"]
    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows_sorted:
            writer.writerow(r)
    logger.info(f"CSV escrito en {output_path} ({len(rows_sorted)} filas).")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def run(output_path: Path) -> int:
    _init_firebase_admin()
    db = firestore.client()

    dag_keys = _load_dag_chapters()

    logger.info("Cargando price_book_2025 desde Firestore...")
    items, breakdowns_by_parent = fetch_price_book(db)

    if not items:
        logger.error("No se encontraron items en price_book_2025. ¿Está la colección poblada?")
        return 1

    logger.info("Ejecutando audits...")
    rows: List[Dict[str, str]] = []
    rows += audit_empty_descriptions(items)
    rows += audit_unit_normalized(items)
    rows += audit_duplicate_descriptions(items)
    rows += audit_similar_descriptions(items)
    rows += audit_chapter_not_in_dag(items, dag_keys)
    rows += audit_items_without_breakdowns(items, breakdowns_by_parent)
    rows += audit_price_mismatch(items, breakdowns_by_parent)

    # Pintar resumen por issue_type y severity.
    by_issue: Dict[str, int] = defaultdict(int)
    by_severity: Dict[str, int] = defaultdict(int)
    for r in rows:
        by_issue[r["issue_type"]] += 1
        by_severity[r["severity"]] += 1

    logger.info("=" * 60)
    logger.info("Resumen:")
    for issue, n in sorted(by_issue.items()):
        logger.info(f"  {issue:<35s} {n:>5d}")
    logger.info("---")
    for sev, n in sorted(by_severity.items(), key=lambda kv: _SEVERITY_ORDER.get(kv[0], 99)):
        logger.info(f"  [{sev:<8s}] {n:>5d}")
    logger.info("=" * 60)

    write_csv(rows, output_path)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit catalog data quality (price_book_2025).")
    parser.add_argument(
        "--output", "-o",
        default="audit_catalog_report.csv",
        help="Ruta de salida del CSV (default: audit_catalog_report.csv).",
    )
    args = parser.parse_args()
    output_path = Path(args.output)
    return run(output_path)


if __name__ == "__main__":
    sys.exit(main())

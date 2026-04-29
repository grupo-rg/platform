"""Fase 11.D.5 — Auditoría one-shot del catálogo `price_book_2025` para
verificar coherencia entre las tres señales que usa `categorize_component`:

  1. Prefijo del `code` (mo*, mt*, mq*, %, ci*).
  2. Campo `type` (LABOR/MATERIAL/MACHINERY/OTHER) si presente.
  3. Flag `is_variable` (bool).

Reporta inconsistencias visibles:
  - mo* con `is_variable=True` (mano de obra debería ser fija).
  - mt* sin `is_variable` definido (no podemos refinar a fixed/variable).
  - code sin prefijo conocido.
  - type ≠ categoría derivada del code prefix.

Output: tabla en `services/ai-core/evals/catalog_audit_2026_04_27.md`.
NO modifica datos. Si las incoherencias > 5 % se documenta para v007.

Uso:
    python scripts/validate_breakdown_categorization.py
"""

from __future__ import annotations

import logging
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.budget.catalog.domain.breakdown_category import (  # noqa: E402
    BreakdownCategory,
    categorize_component,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

OUTPUT_PATH = ROOT / "evals" / f"catalog_audit_{datetime.now().strftime('%Y_%m_%d')}.md"


def _init_firebase_admin() -> None:
    load_dotenv(ROOT / ".env")
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
    if not (project_id and client_email and private_key):
        raise SystemExit(
            "Faltan FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY en .env"
        )
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
        "client_x509_cert_url": f"https://www.googleapis.com/robot/v1/metadata/x509/{client_email.replace('@', '%40')}",
    }
    try:
        firebase_admin.initialize_app(credentials.Certificate(info))
    except ValueError:
        pass


def _audit_breakdown_doc(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Devuelve un dict con las inconsistencias detectadas, o None si está limpio."""
    code = doc.get("code") or ""
    type_ = doc.get("type")
    is_variable = doc.get("is_variable")
    issues: List[str] = []

    derived = categorize_component(code, type_, is_variable)

    code_lower = code.lower().strip()
    if not code_lower:
        issues.append("code vacío")
    elif not any(
        code_lower.startswith(p) for p in ("mo", "mt", "mq", "%", "ci", "dq")
    ):
        issues.append(f"prefijo desconocido en code='{code}'")

    if code_lower.startswith("mo") and is_variable is True:
        issues.append("mo* con is_variable=True (mano de obra no debería ser variable)")

    if code_lower.startswith("mt") and is_variable is None:
        issues.append("mt* sin is_variable definido")

    if type_ and code_lower.startswith("mo") and type_.upper() != "LABOR":
        issues.append(f"mo* pero type={type_} (esperado LABOR)")

    if type_ and code_lower.startswith("mq") and type_.upper() != "MACHINERY":
        issues.append(f"mq* pero type={type_} (esperado MACHINERY)")

    if not issues:
        return None
    return {
        "id": doc.get("__doc_id") or "?",
        "code": code,
        "type": type_,
        "is_variable": is_variable,
        "derived_category": derived.value,
        "issues": issues,
    }


def main() -> int:
    _init_firebase_admin()
    db = firestore.client()

    logger.info("Leyendo colección price_book_2025 (kind=breakdown)…")
    docs = list(
        db.collection("price_book_2025").where("kind", "==", "breakdown").stream()
    )
    logger.info(f"  Total breakdowns: {len(docs)}")

    inconsistencies: List[Dict[str, Any]] = []
    category_counts: Counter[BreakdownCategory] = Counter()
    issue_counts: Counter[str] = Counter()

    for snap in docs:
        data = snap.to_dict() or {}
        data["__doc_id"] = snap.id

        code = data.get("code") or ""
        category = categorize_component(code, data.get("type"), data.get("is_variable"))
        category_counts[category] += 1

        finding = _audit_breakdown_doc(data)
        if finding:
            inconsistencies.append(finding)
            for issue in finding["issues"]:
                issue_counts[issue.split(" ")[0]] += 1

    pct_inconsistent = (len(inconsistencies) / max(len(docs), 1)) * 100

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines: List[str] = []
    lines.append(f"# Audit del catálogo `price_book_2025` (Fase 11.D.5)\n")
    lines.append(f"_Generado: {datetime.now(timezone.utc).isoformat()}_\n")
    lines.append("\n## Resumen\n")
    lines.append(f"- Total docs (kind=breakdown): **{len(docs)}**\n")
    lines.append(f"- Docs con inconsistencias: **{len(inconsistencies)} ({pct_inconsistent:.1f} %)**\n")

    lines.append("\n## Distribución por categoría derivada\n")
    lines.append("| Categoría | Count | % |\n")
    lines.append("|---|---:|---:|\n")
    for category, count in category_counts.most_common():
        pct = (count / max(len(docs), 1)) * 100
        lines.append(f"| {category.value} | {count} | {pct:.1f} % |\n")

    lines.append("\n## Tipos de inconsistencia (resumen)\n")
    lines.append("| Tipo | Casos |\n|---|---:|\n")
    for issue_kind, count in issue_counts.most_common():
        lines.append(f"| {issue_kind} | {count} |\n")

    lines.append("\n## Top 30 inconsistencias\n")
    lines.append("| doc_id | code | type | is_variable | derived | issues |\n")
    lines.append("|---|---|---|---|---|---|\n")
    for f in inconsistencies[:30]:
        issues_str = "; ".join(f["issues"])
        lines.append(
            f"| `{f['id']}` | `{f['code']}` | {f['type'] or '?'} | "
            f"{f['is_variable']} | {f['derived_category']} | {issues_str} |\n"
        )

    if pct_inconsistent > 5.0:
        lines.append(
            f"\n> ⚠️ **{pct_inconsistent:.1f} %** supera el umbral del 5 %. "
            "Abrir tarea de saneamiento del seed para v007.\n"
        )
    else:
        lines.append(
            f"\n> ✅ {pct_inconsistent:.1f} % bajo el umbral del 5 %. Categorización estable.\n"
        )

    OUTPUT_PATH.write_text("".join(lines), encoding="utf-8")
    logger.info(f"✅ Reporte escrito en: {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

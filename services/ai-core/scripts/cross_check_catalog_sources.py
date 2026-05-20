"""Sprint 3.B Fase A — Cross-check catalog sources.

Compares three sources of the COAATMCA 2025 catalogue:

  1. PDF-extracted (``data/catalog_source/pdf_extracted_catalog.json``) —
     produced by ``extract_catalog_from_pdf.py``. Source of truth.
  2. JSON ingest (``prices/coaatmca_2025_price_book.json``) — used by the
     Firestore ingest script.
  3. Firestore production (collection ``price_book_2025``) — via Firebase
     admin SDK.

Outputs ``data/catalog_source/coverage_report.json`` with:

    {
      "pdf_items": int,
      "json_items": int,
      "firestore_items": int,
      "in_all_three": int,
      "in_pdf_only": [...],
      "in_json_only": [...],
      "in_firestore_only": [...],
      "in_pdf_and_json_not_firestore": [...],
      "in_pdf_and_firestore_not_json": [...],
      "in_json_and_firestore_not_pdf": [...],
      "per_chapter_counts": {...}
    }

Uso:
  # Solo PDF vs JSON (sin Firestore):
  python services/ai-core/scripts/cross_check_catalog_sources.py --no-firestore

  # PDF + JSON + Firestore (requiere .env con FIREBASE_* o GOOGLE_APPLICATION_CREDENTIALS):
  python services/ai-core/scripts/cross_check_catalog_sources.py
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set


logger = logging.getLogger("cross_check_catalog_sources")


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_pdf_catalog(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return {
        "codes": {it["code"] for it in data.get("items", [])},
        "items": {it["code"]: it for it in data.get("items", [])},
        "raw": data,
    }


def load_json_catalog(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    codes: Set[str] = set()
    items: Dict[str, Dict[str, Any]] = {}
    for chap in data:
        for it in chap.get("items", []):
            code = it.get("code")
            if code:
                codes.add(code)
                items[code] = it
    return {"codes": codes, "items": items, "raw": data}


def load_firestore_catalog() -> Optional[Dict[str, Any]]:
    """Lee la colección ``price_book_2025`` de Firestore vía admin SDK.

    Devuelve None si no se puede conectar (sin credenciales). Imita el patrón
    de inicialización de ``audit_catalog_data_quality.py``.
    """
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
        from dotenv import load_dotenv
    except ImportError:
        logger.warning("firebase_admin / dotenv no instalados — skip Firestore.")
        return None

    repo_root = Path(__file__).resolve().parents[3]
    load_dotenv(repo_root / ".env")
    if not firebase_admin._apps:
        sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if sa_path and Path(sa_path).is_file():
            firebase_admin.initialize_app(credentials.Certificate(sa_path))
        else:
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
            else:
                try:
                    firebase_admin.initialize_app()
                except Exception as e:  # pragma: no cover
                    logger.warning(f"No se pudo inicializar Firebase admin: {e}")
                    return None

    try:
        db = firestore.client()
        docs = db.collection("price_book_2025").stream()
        codes: Set[str] = set()
        items: Dict[str, Dict[str, Any]] = {}
        for d in docs:
            data = d.to_dict() or {}
            code = data.get("code") or d.id
            codes.add(code)
            items[code] = data
        return {"codes": codes, "items": items}
    except Exception as e:
        logger.warning(f"No se pudo leer Firestore: {e}")
        return None


# ---------------------------------------------------------------------------
# Cross-check
# ---------------------------------------------------------------------------


def per_chapter_counts(catalog: Dict[str, Any], code_key: str, chapter_key: str) -> Dict[str, int]:
    counter: Counter = Counter()
    for it in catalog["items"].values():
        ch = it.get(chapter_key) or "UNKNOWN"
        counter[ch] += 1
    return dict(counter)


def cross_check(
    pdf: Dict[str, Any],
    json_cat: Dict[str, Any],
    firestore: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    pdf_codes = pdf["codes"]
    json_codes = json_cat["codes"]
    fs_codes = firestore["codes"] if firestore else set()

    report: Dict[str, Any] = {
        "pdf_items": len(pdf_codes),
        "json_items": len(json_codes),
        "firestore_items": len(fs_codes) if firestore else None,
        "in_all_three": (
            sorted(pdf_codes & json_codes & fs_codes) if firestore else None
        ),
        "in_pdf_only": sorted(pdf_codes - json_codes - fs_codes) if firestore else sorted(pdf_codes - json_codes),
        "in_json_only": sorted(json_codes - pdf_codes - fs_codes) if firestore else sorted(json_codes - pdf_codes),
        "in_firestore_only": sorted(fs_codes - pdf_codes - json_codes) if firestore else None,
        "in_pdf_and_json_not_firestore": (
            sorted((pdf_codes & json_codes) - fs_codes) if firestore else None
        ),
        "in_pdf_and_firestore_not_json": (
            sorted((pdf_codes & fs_codes) - json_codes) if firestore else None
        ),
        "in_json_and_firestore_not_pdf": (
            sorted((json_codes & fs_codes) - pdf_codes) if firestore else None
        ),
    }

    # Per-chapter counts.
    pdf_by_chapter = per_chapter_counts(pdf, "code", "chapter")
    json_by_chapter: Dict[str, int] = {}
    for chap in json_cat["raw"]:
        ch_name = chap.get("chapter") or "UNKNOWN"
        json_by_chapter[ch_name] = json_by_chapter.get(ch_name, 0) + len(chap.get("items", []))

    report["per_chapter_counts"] = {
        "pdf": pdf_by_chapter,
        "json": json_by_chapter,
    }
    if firestore:
        fs_by_chapter: Counter = Counter()
        for it in firestore["items"].values():
            fs_by_chapter[it.get("chapter") or "UNKNOWN"] += 1
        report["per_chapter_counts"]["firestore"] = dict(fs_by_chapter)

    # Resumen ejecutivo.
    report["summary"] = {
        "pdf_total": report["pdf_items"],
        "json_total": report["json_items"],
        "firestore_total": report["firestore_items"],
        "common_pdf_json": len(pdf_codes & json_codes),
        "common_all_three": (
            len(pdf_codes & json_codes & fs_codes) if firestore else None
        ),
        "json_missing_from_pdf_count": len(report["in_json_only"]),
        "pdf_missing_from_json_count": len(report["in_pdf_only"]),
        "firestore_missing_from_pdf_count": (
            len(report["in_firestore_only"]) if firestore else None
        ),
    }

    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    repo_root_default = Path(__file__).resolve().parents[3]
    p = argparse.ArgumentParser(description="Cross-check PDF / JSON / Firestore catalog sources.")
    p.add_argument(
        "--pdf-catalog",
        default=str(repo_root_default / "data" / "catalog_source" / "pdf_extracted_catalog.json"),
        help="Path al PDF-extracted catalog JSON.",
    )
    p.add_argument(
        "--json-catalog",
        default=str(repo_root_default / "prices" / "coaatmca_2025_price_book.json"),
        help="Path al JSON ingest file.",
    )
    p.add_argument(
        "--output",
        default=str(repo_root_default / "data" / "catalog_source" / "coverage_report.json"),
        help="Path al report JSON output.",
    )
    p.add_argument(
        "--no-firestore",
        action="store_true",
        help="Skip Firestore comparison (cuando no hay credenciales).",
    )
    p.add_argument("--verbose", action="store_true")
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    pdf_path = Path(args.pdf_catalog)
    if not pdf_path.is_file():
        logger.error(f"PDF catalog no encontrado en {pdf_path} — corre extract_catalog_from_pdf.py primero.")
        return 1
    json_path = Path(args.json_catalog)
    if not json_path.is_file():
        logger.error(f"JSON catalog no encontrado en {json_path}.")
        return 1
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Cargando PDF catalog: {pdf_path}")
    pdf = load_pdf_catalog(pdf_path)
    logger.info(f"  → {len(pdf['codes'])} códigos")

    logger.info(f"Cargando JSON catalog: {json_path}")
    json_cat = load_json_catalog(json_path)
    logger.info(f"  → {len(json_cat['codes'])} códigos")

    firestore = None
    if not args.no_firestore:
        logger.info("Cargando Firestore catalog (price_book_2025)...")
        firestore = load_firestore_catalog()
        if firestore is None:
            logger.warning("Firestore no disponible — el reporte omite esa fuente.")
        else:
            logger.info(f"  → {len(firestore['codes'])} códigos")

    report = cross_check(pdf, json_cat, firestore)

    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"Report escrito: {out_path}")

    s = report["summary"]
    logger.info("Summary:")
    logger.info(f"  PDF total                       = {s['pdf_total']}")
    logger.info(f"  JSON total                      = {s['json_total']}")
    logger.info(f"  Firestore total                 = {s['firestore_total']}")
    logger.info(f"  Common PDF ∩ JSON               = {s['common_pdf_json']}")
    logger.info(f"  Common all three                = {s['common_all_three']}")
    logger.info(f"  JSON codes not in PDF           = {s['json_missing_from_pdf_count']}")
    logger.info(f"  PDF codes not in JSON           = {s['pdf_missing_from_json_count']}")
    logger.info(f"  Firestore codes not in PDF      = {s['firestore_missing_from_pdf_count']}")

    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())

"""Script CLI para seed de la colección Firestore `labor_rates_2025`.

Thin wrapper sobre `SeedLaborRatesUseCase` — la lógica testeada vive en el
use case. Aquí solo:
  1. Cargamos credenciales Firebase Admin desde .env.
  2. Leemos `data/coaatmca_2025_cuadros_base.json`.
  3. Pasamos al use case.
  4. Pintamos el report.

Uso:
  # Dry-run (por defecto): NO escribe en Firestore, solo valida el JSON y
  # cuenta entradas. Seguro de ejecutar en cualquier momento.
    python scripts/seed_labor_rates_2025.py

  # Commit real: escribe en la colección labor_rates_2025.
    python scripts/seed_labor_rates_2025.py --commit

Idempotente: re-ejecutar con --commit sobrescribe docs con el mismo id.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore

# Hacemos importable `src.*` al ejecutar desde `services/ai-core/`.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.budget.catalog.application.use_cases.seed_labor_rates_uc import (  # noqa: E402
    SeedLaborRatesUseCase,
)
from src.budget.catalog.infrastructure.adapters.firestore_catalog_repository import (  # noqa: E402
    FirestoreCatalogRepository,
)
from src.budget.catalog.infrastructure.adapters.in_memory_catalog_repository import (  # noqa: E402
    InMemoryCatalogRepository,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

JSON_PATH = ROOT / "data" / "coaatmca_2025_cuadros_base.json"


def _init_firebase_admin() -> None:
    load_dotenv(ROOT / ".env")

    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")

    if not (project_id and client_email and private_key):
        raise SystemExit("Faltan variables FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY en .env")

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
        pass  # ya inicializado


async def run(commit: bool) -> int:
    with JSON_PATH.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    entries = payload["labor_rates"]
    logger.info(f"Cargadas {len(entries)} entradas desde {JSON_PATH.name}")
    meta = payload.get("_meta", {})
    if meta.get("_review_status") == "PENDING_HUMAN_VALIDATION" and commit:
        logger.warning(
            "⚠️  El JSON tiene _review_status=PENDING_HUMAN_VALIDATION. "
            "Confirma con el operador humano que los precios están validados "
            "contra el libro físico antes del commit real."
        )

    if commit:
        _init_firebase_admin()
        repo = FirestoreCatalogRepository(db=firestore.client())
        logger.info("Commit real: escribiendo en Firestore labor_rates_2025…")
    else:
        repo = InMemoryCatalogRepository()
        logger.info("Dry-run: NO se escribirá en Firestore (pasa --commit para escribir).")

    uc = SeedLaborRatesUseCase(repo=repo)
    report = await uc.execute(entries)

    logger.info(f"Saved: {report.saved_count}")
    if report.errors:
        logger.error(f"Errors: {len(report.errors)}")
        for err in report.errors:
            logger.error(f"  [{err.entry_id}] {err.reason[:200]}")
        return 1

    logger.info("✅ Seed completado sin errores.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed de labor_rates_2025 en Firestore.")
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Escribir en Firestore. Por defecto es dry-run.",
    )
    args = parser.parse_args()
    return asyncio.run(run(commit=args.commit))


if __name__ == "__main__":
    sys.exit(main())

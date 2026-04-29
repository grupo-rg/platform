"""Script CLI — reindexa `price_book_2025` al esquema v005.

Thin wrapper sobre `ReindexPriceBookUseCase`. Toda la lógica testeable vive
en el use case; aquí solo:
  1. Cargar credenciales Firebase desde .env.
  2. Cargar el JSON origen `docs/2025_variable_final.json`.
  3. Instanciar `VertexEmbeddingProvider` + `FirestorePriceBookRepository`.
  4. Ejecutar el use case con los flags del operador.
  5. Pintar el report.

Uso:
  # Dry-run: transforma el JSON y cuenta, NO llama a Vertex ni Firestore.
    python scripts/vectorize_catalog_v005.py

  # Commit real (añade a la colección SIN borrar los docs existentes).
    python scripts/vectorize_catalog_v005.py --commit

  # Commit con wipe previo (recomendado para reindex completa).
    python scripts/vectorize_catalog_v005.py --commit --wipe

Idempotente: doc_id = entry.code, así que re-ejecutar con --commit sin --wipe
sobrescribe docs con el mismo id (los viejos se actualizan, no se duplican).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
SOURCE_JSON = REPO_ROOT / "docs" / "2025_variable_final.json"

sys.path.insert(0, str(ROOT))

from src.budget.catalog.application.use_cases.reindex_price_book_uc import (  # noqa: E402
    ReindexPriceBookUseCase,
)
from src.budget.catalog.infrastructure.adapters.firestore_price_book_repository import (  # noqa: E402
    FirestorePriceBookRepository,
)
from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (  # noqa: E402
    GeminiEmbeddingProvider,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _init_firebase_admin() -> None:
    load_dotenv(ROOT / ".env")

    import os
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
        "client_x509_cert_url": (
            f"https://www.googleapis.com/robot/v1/metadata/x509/"
            f"{client_email.replace('@', '%40')}"
        ),
    }
    try:
        firebase_admin.initialize_app(credentials.Certificate(info))
    except ValueError:
        pass  # ya inicializado


async def run(commit: bool, wipe: bool) -> int:
    logger.info(f"Leyendo {SOURCE_JSON.name} (~5MB)…")
    with SOURCE_JSON.open("r", encoding="utf-8") as f:
        source = json.load(f)

    if commit:
        load_dotenv(ROOT / ".env")
        _init_firebase_admin()
        repo = FirestorePriceBookRepository(db=firestore.client())
        embedder = GeminiEmbeddingProvider()
        logger.info("Commit real: Gemini (gemini-embedding-001) → Firestore price_book_2025.")
    else:
        # Dry-run: adapters in-memory + determinista (ningún I/O).
        from src.budget.catalog.infrastructure.adapters.deterministic_embedding_provider import (
            DeterministicEmbeddingProvider,
        )
        from src.budget.catalog.infrastructure.adapters.in_memory_price_book_repository import (
            InMemoryPriceBookRepository,
        )
        repo = InMemoryPriceBookRepository()
        embedder = DeterministicEmbeddingProvider()
        logger.info("Dry-run: NO se llamará a Vertex ni Firestore (pasa --commit para escribir).")

    uc = ReindexPriceBookUseCase(repo=repo, embedder=embedder)
    report = await uc.execute(source=source, wipe=wipe, dry_run=not commit)

    logger.info(f"Items transformados: {report.items_transformed}")
    logger.info(f"Breakdowns transformados: {report.breakdowns_transformed}")
    logger.info(f"Items guardados: {report.items_saved}")
    logger.info(f"Breakdowns guardados: {report.breakdowns_saved}")
    if report.errors:
        logger.error(f"Errors: {len(report.errors)}")
        for e in report.errors:
            logger.error(f"  {e[:200]}")
        return 1

    logger.info("✅ Reindex completado sin errores.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Reindex price_book_2025 al esquema v005.")
    parser.add_argument("--commit", action="store_true", help="Escribir en Firestore (default: dry-run).")
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Borrar todos los docs de price_book_2025 antes de escribir. Requiere --commit.",
    )
    args = parser.parse_args()

    if args.wipe and not args.commit:
        logger.warning("--wipe sin --commit no tiene efecto en dry-run.")

    return asyncio.run(run(commit=args.commit, wipe=args.wipe))


if __name__ == "__main__":
    sys.exit(main())

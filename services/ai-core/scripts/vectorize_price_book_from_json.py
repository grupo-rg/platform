"""Etapa 2 del pipeline del libro de precios — VECTORIZAR desde el enriched JSON.

El proceso es en dos etapas:
  1. (extract+enrich)  PDF → extraer partidas + unir aliases → `<edicion>.enriched.json`
  2. (vectorize, ESTO) enriched.json → transform → embed 768 (Vertex) → Firestore

Este script es la Etapa 2: NO toca el PDF. Lee el corpus enriquecido (que ya
trae `search_aliases` por partida) y lo vectoriza a una colección de precios.
Determinista y reproducible: la fuente de verdad de la edición es el JSON.

Uso:
  # dry-run (transforma + cuenta, sin Vertex ni Firestore)
  python scripts/vectorize_price_book_from_json.py --json docs/2026_variable_final.enriched.json --collection price_book_2026_staging

  # commit real con wipe previo
  python scripts/vectorize_price_book_from_json.py --json docs/2026_variable_final.enriched.json \
      --collection price_book_2026_staging --source-book COAATMCA_2026 --commit --wipe

Auth Vertex en local: usa la SA `firebase-adminsdk` (tiene roles/aiplatform.user)
construida desde las FIREBASE_* del .env → GOOGLE_APPLICATION_CREDENTIALS.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _bootstrap_credentials() -> str:
    """Construye una SA key desde el .env y la deja como GOOGLE_APPLICATION_CREDENTIALS
    (la SA firebase-adminsdk tiene acceso a Vertex + Firestore). Devuelve la ruta."""
    load_dotenv(ROOT.parents[1] / ".env")
    load_dotenv(ROOT / ".env")
    key = {
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    fd, path = tempfile.mkstemp(suffix=".json", prefix="sa_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(key, f)
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = path
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", key["project_id"])
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "europe-southwest1")
    return path


async def _run(args: argparse.Namespace) -> int:
    key_path = _bootstrap_credentials()
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(key_path))
        db = firestore.client()

        source = json.load(open(args.json, encoding="utf-8"))  # [{chapter, items:[...]}]
        n_items = sum(len(c.get("items", [])) for c in source)
        n_alias = sum(1 for c in source for it in c.get("items", []) if it.get("search_aliases"))
        print(f"[vectorize] fuente: {args.json}")
        print(f"[vectorize] capítulos: {len(source)} · partidas: {n_items} · con aliases: {n_alias}")

        from src.budget.catalog.application.use_cases.reindex_price_book_uc import (
            ReindexPriceBookUseCase,
        )
        from src.budget.catalog.infrastructure.adapters.firestore_price_book_repository import (
            FirestorePriceBookRepository,
        )
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )

        repo = FirestorePriceBookRepository(db, collection=args.collection)
        embedder = GeminiEmbeddingProvider()
        uc = ReindexPriceBookUseCase(repo, embedder)

        report = await uc.execute(
            source,
            wipe=args.wipe,
            dry_run=not args.commit,
            source_book=args.source_book,
        )
        print(
            f"[vectorize] {'DRY-RUN' if not args.commit else 'COMMIT'} → "
            f"items_transformed={report.items_transformed} "
            f"breakdowns_transformed={report.breakdowns_transformed} "
            f"items_saved={report.items_saved} breakdowns_saved={report.breakdowns_saved}"
        )
        if report.errors:
            print(f"[vectorize] errores: {len(report.errors)} (primeros 3: {report.errors[:3]})")
        return 0
    finally:
        try:
            os.remove(key_path)
        except OSError:
            pass


def main() -> int:
    p = argparse.ArgumentParser(description="Vectoriza el libro de precios desde el enriched JSON.")
    p.add_argument("--json", required=True, help="Ruta al enriched JSON ([{chapter, items:[...]}]).")
    p.add_argument("--collection", required=True, help="Colección Firestore destino.")
    p.add_argument("--source-book", default="COAATMCA_2026", help="Sello source_book de las entries.")
    p.add_argument("--commit", action="store_true", help="Escribe de verdad (embed + Firestore).")
    p.add_argument("--wipe", action="store_true", help="Vacía la colección antes de escribir.")
    return asyncio.run(_run(p.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())

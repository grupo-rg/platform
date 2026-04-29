"""Seed de HeuristicFragments demo en `heuristic_fragments` (Firestore).

Objetivo: tener datos reales para que el loop ICL (Fase 6.C) se active al
correr el pipeline. Sin estos fragments, `find_relevant(min_count=2)` siempre
devuelve [] hasta que el aparejador capture correcciones desde el editor.

Los fragments inyectados aquí son ejemplos del corpus Grupo RG típico: patrones
repetidos de descuentos de proveedor y ajustes de calidad que el Judge debe
aprender a reproducir.

Uso:
  # Dry-run (por defecto): enumera los fragments que se escribirían, no toca Firestore.
    python scripts/seed_heuristic_fragments.py

  # Commit real:
    python scripts/seed_heuristic_fragments.py --commit

Idempotente — reutiliza `build_demo_fragments()` (ids estables).
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.budget.domain.entities import (  # noqa: E402
    HeuristicAIInferenceTrace,
    HeuristicContext,
    HeuristicFragment,
    HeuristicHumanCorrection,
)
from src.budget.learning.infrastructure.adapters.firestore_heuristic_fragment_repository import (  # noqa: E402
    FirestoreHeuristicFragmentRepository,
)
from src.budget.learning.infrastructure.adapters.in_memory_heuristic_fragment_repository import (  # noqa: E402
    InMemoryHeuristicFragmentRepository,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# -------- Demo corpus -----------------------------------------------------------------

# Base time fija: 60 días atrás del momento de ejecutar este módulo. Como el
# timestamp entra en el id hash, es determinista por invocación — pero los ids
# dentro de la misma invocación son consistentes.
_BASE_TIME = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=60)


def _stable_id(*parts: str) -> str:
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:10]
    return f"frag-seed-{digest}"


def _make_fragment(
    *,
    chapter: str,
    reason: str,
    description: str,
    ai_price: float,
    human_price: float,
    unit: str,
    quantity: float,
    note: str,
    days_ago: int,
) -> HeuristicFragment:
    fid = _stable_id(chapter, reason, description, f"{ai_price:.2f}", f"{human_price:.2f}")
    return HeuristicFragment(
        id=fid,
        sourceType="internal_admin",
        status="golden",
        context=HeuristicContext(
            budgetId="seed-demo",
            originalDescription=description,
            originalQuantity=quantity,
            originalUnit=unit,
        ),
        aiInferenceTrace=HeuristicAIInferenceTrace(
            proposedUnitPrice=ai_price,
            aiReasoning="Precio base del libro COAATMCA",
        ),
        humanCorrection=HeuristicHumanCorrection(
            correctedUnitPrice=human_price,
            correctedUnit=unit,
            heuristicRule=f"{reason}: {note}",
            correctedByUserId="seed-admin",
        ),
        tags=[f"chapter:{chapter}", f"reason:{reason}"],
        timestamp=_BASE_TIME - timedelta(days=days_ago),
    )


def build_demo_fragments() -> List[HeuristicFragment]:
    """Corpus demo determinista. ≥ 2 fragments por bucket (chapter, reason)
    para que el retrieval del Swarm (min_count=2) encuentre evidencia real."""
    return [
        # --- DEMOLICIONES / volumen (2 ejemplos) ---
        _make_fragment(
            chapter="DEMOLICIONES",
            reason="volumen",
            description="Demolición de alicatado en paredes de baño reforma",
            ai_price=25.0,
            human_price=21.5,
            unit="m2",
            quantity=20.0,
            note="descuento proveedor al superar 15 m² por obra",
            days_ago=30,
        ),
        _make_fragment(
            chapter="DEMOLICIONES",
            reason="volumen",
            description="Demolición alicatado paredes reforma integral baño",
            ai_price=25.5,
            human_price=22.0,
            unit="m2",
            quantity=18.0,
            note="descuento proveedor al superar 15 m²",
            days_ago=15,
        ),
        # --- FONTANERIA Y GAS / descuento_proveedor (2 ejemplos) ---
        _make_fragment(
            chapter="FONTANERIA Y GAS",
            reason="descuento_proveedor",
            description="Instalación completa de tomas de agua fría y caliente",
            ai_price=180.0,
            human_price=160.0,
            unit="ud",
            quantity=1.0,
            note="oferta activa con distribuidor habitual",
            days_ago=45,
        ),
        _make_fragment(
            chapter="FONTANERIA Y GAS",
            reason="descuento_proveedor",
            description="Renovación tomas de fontanería agua fría caliente",
            ai_price=175.0,
            human_price=155.0,
            unit="ud",
            quantity=1.0,
            note="precio acordado con proveedor",
            days_ago=10,
        ),
        # --- SOLADOS Y ALICATADOS / calidad_premium (1 ejemplo — por debajo de min_count=2 adrede) ---
        # Demuestra que el Swarm NO inyectará este solo hasta que hayan ≥ 2.
        _make_fragment(
            chapter="SOLADOS Y ALICATADOS",
            reason="calidad_premium",
            description="Suministro de porcelánico premium para suelo baño",
            ai_price=30.0,
            human_price=45.0,
            unit="m2",
            quantity=5.0,
            note="cliente pidió gama alta catalogo B",
            days_ago=20,
        ),
    ]


# -------- CLI / Firebase init ---------------------------------------------------------


def _init_firebase_admin() -> None:
    load_dotenv(ROOT / ".env")
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
    if not (project_id and client_email and private_key):
        raise SystemExit(
            "Faltan variables FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY en .env"
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
        pass  # already initialised


async def run(commit: bool) -> int:
    fragments = build_demo_fragments()
    logger.info(f"Generados {len(fragments)} fragments demo desde build_demo_fragments().")

    if commit:
        _init_firebase_admin()
        repo = FirestoreHeuristicFragmentRepository(db=firestore.client())
        logger.info("Commit real: escribiendo en Firestore heuristic_fragments…")
    else:
        repo = InMemoryHeuristicFragmentRepository()
        logger.info("Dry-run: NO se escribirá en Firestore (pasa --commit para escribir).")

    for frag in fragments:
        await repo.save(frag)
        chapter = next((t for t in frag.tags if t.startswith("chapter:")), "chapter:?")
        reason = next((t for t in frag.tags if t.startswith("reason:")), "reason:?")
        logger.info(f"  [{frag.id}] {chapter} / {reason} — IA {frag.aiInferenceTrace.proposedUnitPrice}€ → humano {frag.humanCorrection.correctedUnitPrice}€")

    logger.info("✅ Seed completado.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed de heuristic_fragments demo.")
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Escribir en Firestore. Por defecto dry-run.",
    )
    args = parser.parse_args()
    return asyncio.run(run(commit=args.commit))


if __name__ == "__main__":
    sys.exit(main())

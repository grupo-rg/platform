"""Sprint 4 — mini-agent AISLADO para diagnosticar la regresion del matcher.

Reutiliza el codigo PRODUCTIVO del FirestorePriceBookAdapter + Gemini embedding,
pero EN MODO READ-ONLY:

  - Solo find_nearest sobre `price_book_2025` (no writes).
  - Solo embed_content sobre Gemini (cuesta ~$0.0001 por query).
  - NO invoca Swarm, NO crea Budget, NO emite eventos SSE.
  - NO toca pipeline_jobs ni pipeline_telemetry.

Permite responder: con la MISMA descripcion que llega al matcher productivo,
¿que candidatos del catalogo serian devueltos? Y comparar con descripcion
TRUNCADA (al primer punto) para validar la hipotesis de regresion por
desc largas (commit 0e9e89a).

CLI uso:

  # Buscar con texto literal
  python mini_agent_match.py search "Picado hormigon danado" --top-k 10

  # Buscar con chapter filter
  python mini_agent_match.py search "..." --chapter "21 PATOLOGIAS GRAVES"

  # Ver detalle de un code del catalogo
  python mini_agent_match.py detail DRF020

  # Comparar: una partida de un Budget, busca con desc full vs truncada
  python mini_agent_match.py compare-budget 2faf5fc3-... --code 1.2.12

  # Listar partidas de un capitulo del catalogo
  python mini_agent_match.py list-chapter "3 CIMENTACIONES" --max 20
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add service root to path so we can import the productive code.
SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

# Read .env from repo root (same convention as the rest of the system).
def _load_env() -> None:
    repo_root = SERVICE_ROOT.parent.parent
    env_path = repo_root / ".env"
    if not env_path.exists():
        print(f"[WARN] .env not found at {env_path}", file=sys.stderr)
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


_load_env()

# --- After env is loaded, init firebase_admin (singleton). -----------------
import firebase_admin
from firebase_admin import credentials, firestore

if not firebase_admin._apps:
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
    if project_id and client_email and private_key:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": project_id,
            "client_email": client_email,
            "private_key": private_key,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        firebase_admin.initialize_app(cred, {"projectId": project_id})
    else:
        # Try ADC
        firebase_admin.initialize_app()

db = firestore.client()


# --- Reuse productive code for vector search + embedding. ------------------
from src.budget.infrastructure.adapters.databases.firestore_price_book import (
    FirestorePriceBookAdapter,
)

_adapter = FirestorePriceBookAdapter(db=db)


def _embed(text: str) -> List[float]:
    """Genera embedding 768-dim con Gemini embedding-001 (mismo que el sistema)."""
    from google import genai

    api_key = os.environ.get("GOOGLE_GENAI_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_GENAI_API_KEY no esta en el env")

    client = genai.Client(api_key=api_key)
    result = client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config={"output_dimensionality": 768},
    )
    # google-genai returns ContentEmbedding objects
    emb = result.embeddings[0]
    return list(emb.values)


# --- CLI commands ---------------------------------------------------------

def cmd_search(args: argparse.Namespace) -> int:
    """Search en el catalogo con un query de texto + chapter opcional."""
    query_text = args.text
    print(f"[query_text] {query_text}")
    print(f"[len chars]  {len(query_text)}")
    print(f"[chapter_filter] {args.chapter or '(none)'}")
    print()
    print("Generando embedding (Gemini 768-dim)...")
    vec = _embed(query_text)
    print(f"[embedding_dim] {len(vec)}")
    print()
    print(f"Buscando top {args.top_k} en price_book_2025 (find_nearest, COSINE)...")
    chapter_filters = [args.chapter] if args.chapter else None
    candidates = _adapter.search_similar_items(
        query_vector=vec,
        query_text=query_text,
        limit=args.top_k,
        chapter_filters=chapter_filters,
    )
    print()
    print(f"=== Top {len(candidates)} candidatos ===")
    for i, c in enumerate(candidates, 1):
        score = c.get("matchScore", 0.0)
        kind = c.get("kind", "?")
        code = c.get("code") or c.get("id", "?")
        chapter = c.get("chapter") or ""
        unit = c.get("unit") or "?"
        desc = (c.get("description") or "")[:120]
        print(f"  {i:>2d}. [{kind:>10s}] {code:<20s} score={score:.4f} unit={unit:<8s} chap={chapter[:40]}")
        print(f"      {desc}")
    return 0


def cmd_detail(args: argparse.Namespace) -> int:
    """Muestra detalle de un code del catalogo."""
    code = args.code
    # Buscar por code (no por id) — fetch all docs with kind=item and matching code.
    docs = db.collection("price_book_2025").where(
        filter=firestore.firestore_v1.base_query.FieldFilter("code", "==", code),
    ).limit(5).get() if False else None
    # Use simple approach: query by doc id when item code = id (the price_book_2025 ids are codes).
    doc = db.collection("price_book_2025").document(code).get()
    if not doc.exists:
        # Try with embeddings ids (code might be stored under field 'code' but id is hash).
        results = list(
            db.collection("price_book_2025")
            .where("code", "==", code)
            .limit(5)
            .stream()
        )
        if not results:
            print(f"[NOT FOUND] No doc with code={code}")
            return 1
        for r in results:
            d = r.to_dict()
            d.pop("embedding", None)
            print(json.dumps({"id": r.id, **d}, indent=2, ensure_ascii=False, default=str))
        return 0
    d = doc.to_dict()
    d.pop("embedding", None)
    print(json.dumps({"id": doc.id, **d}, indent=2, ensure_ascii=False, default=str))
    return 0


def cmd_compare_budget(args: argparse.Namespace) -> int:
    """Compara: para una partida de un budget, busca con desc full y desc truncada."""
    budget_id = args.budget_id
    partida_code = args.code

    # 1. Read budget chapters/partidas from Firestore.
    chapters = list(db.collection("budgets").document(budget_id).collection("chapters").stream())
    if not chapters:
        print(f"[ERROR] Budget {budget_id} no tiene chapters")
        return 1

    target_partida = None
    for ch_doc in chapters:
        ch = ch_doc.to_dict()
        for it in ch.get("items", []):
            orig = it.get("original_item", {})
            code = orig.get("code") or it.get("code")
            if code == partida_code:
                target_partida = {
                    "code": code,
                    "description": orig.get("description") or it.get("description") or "",
                    "unit": orig.get("unit") or it.get("unit"),
                    "chapter": orig.get("chapter") or "",
                }
                break
        if target_partida:
            break

    if not target_partida:
        print(f"[ERROR] partida code={partida_code} no encontrada en budget {budget_id}")
        return 1

    full_desc = target_partida["description"]
    short_desc = full_desc.split(".")[0].strip()
    if len(short_desc) < 5 or len(short_desc) > 150:
        # Fallback: trim to first 80 chars.
        short_desc = full_desc[:80].strip()

    print(f"=== Partida {partida_code} ===")
    print(f"  unit:    {target_partida['unit']}")
    print(f"  chapter: {target_partida['chapter']}")
    print()
    print(f"FULL desc ({len(full_desc)} chars):")
    print(f"  {full_desc[:300]}{'...' if len(full_desc) > 300 else ''}")
    print()
    print(f"SHORT desc ({len(short_desc)} chars):")
    print(f"  {short_desc}")
    print()

    # Search with FULL desc.
    print(f"--- Top 5 con FULL desc ---")
    vec_full = _embed(full_desc)
    cands_full = _adapter.search_similar_items(
        query_vector=vec_full, query_text=full_desc, limit=5,
    )
    for i, c in enumerate(cands_full, 1):
        score = c.get("matchScore", 0.0)
        code = c.get("code") or c.get("id", "?")
        desc = (c.get("description") or "")[:80]
        print(f"  {i}. {code:<18s} score={score:.4f}  {desc}")

    print()
    print(f"--- Top 5 con SHORT desc ---")
    vec_short = _embed(short_desc)
    cands_short = _adapter.search_similar_items(
        query_vector=vec_short, query_text=short_desc, limit=5,
    )
    for i, c in enumerate(cands_short, 1):
        score = c.get("matchScore", 0.0)
        code = c.get("code") or c.get("id", "?")
        desc = (c.get("description") or "")[:80]
        print(f"  {i}. {code:<18s} score={score:.4f}  {desc}")

    return 0


def cmd_list_chapter(args: argparse.Namespace) -> int:
    """Lista las primeras N partidas de un capitulo del catalogo."""
    chapter = args.chapter
    max_n = args.max
    docs = (
        db.collection("price_book_2025")
        .where("chapter", "==", chapter)
        .where("kind", "==", "item")
        .limit(max_n)
        .stream()
    )
    count = 0
    for doc in docs:
        d = doc.to_dict()
        code = d.get("code", doc.id)
        desc = (d.get("description") or "")[:100]
        unit = d.get("unit", "?")
        print(f"  {code:<20s} unit={unit:<8s} {desc}")
        count += 1
    print(f"\nTotal: {count} items en chapter '{chapter}'")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Mini agent AISLADO para diagnosticar matcher catalog.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_search = sub.add_parser("search", help="Busqueda directa con texto + chapter opcional")
    p_search.add_argument("text", type=str)
    p_search.add_argument("--top-k", type=int, default=10)
    p_search.add_argument("--chapter", type=str, default=None)
    p_search.set_defaults(func=cmd_search)

    p_detail = sub.add_parser("detail", help="Detalle de un code del catalogo")
    p_detail.add_argument("code", type=str)
    p_detail.set_defaults(func=cmd_detail)

    p_cmp = sub.add_parser("compare-budget", help="Compara desc full vs truncada para 1 partida")
    p_cmp.add_argument("budget_id", type=str)
    p_cmp.add_argument("--code", type=str, required=True)
    p_cmp.set_defaults(func=cmd_compare_budget)

    p_list = sub.add_parser("list-chapter", help="Lista partidas de un chapter")
    p_list.add_argument("chapter", type=str)
    p_list.add_argument("--max", type=int, default=30)
    p_list.set_defaults(func=cmd_list_chapter)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

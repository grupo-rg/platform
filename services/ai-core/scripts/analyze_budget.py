"""Sprint 3.B — Análisis profundo de un budget generado.

Lee un Budget completo desde Firestore + sus chapters + cada partida con su
`ai_resolution.reasoning_trace` (la traza cognitiva del juez) + opcionalmente
los telemetry events asociados al job que lo generó.

Útil para análisis post-mortem de smokes: por qué una partida terminó en
`from_scratch`, qué confidence tenía, qué candidatos vio el reranker, etc.

Estructura del output JSON:
{
  "budget": {
    "id": "...",
    "leadId": "...",
    "title": "...",
    "totalEstimated": ...,
    "createdAt": "...",
    "chapters_count": N,
    "items_count": N,
    "needs_review_count": N,
    "from_scratch_count": N,
    "match_distribution": {"1:1": N, "1:N": N, "from_scratch": N},
    "confidence_distribution": {">90": N, "85-90": N, "40-85": N, "<40": N}
  },
  "chapters": [
    {
      "id": "...",
      "title": "...",
      "subtotal": ...,
      "items": [
        {
          "code": "...",
          "description": "...",
          "unit": "...",
          "quantity": ...,
          "unitPrice": ...,
          "totalPrice": ...,
          "match_kind": "1:1|1:N|from_scratch",
          "confidence_score": 0-100,
          "needs_human_review": bool,
          "reasoning_trace": "Texto completo del juez cognitivo...",
          "ai_resolution": { ... },
          "alternatives": [ ... ],
          "breakdown": [ ... ],
          "original_item": { ... }
        }
      ]
    }
  ],
  "telemetry": {  # solo si --include-telemetry
    "total_events": N,
    "events_by_type": {...},
    "partidas_resolved_v2": [...],
    "job_metrics_final": {...}
  }
}

Uso:
    python analyze_budget.py <budget_id> [--output budget_report] [--include-telemetry] [--markdown]

  - `<budget_id>` también funciona como job_id para measurements jobs.
  - `--output` base name (sin extensión). Se generan .json y/o .md.
  - `--include-telemetry`: lee también pipeline_telemetry/{id}/events.
  - `--markdown`: genera también un MD legible para humanos.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
sys.path.insert(0, str(ROOT))

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

BUDGETS_COLLECTION = "budgets"
TELEMETRY_COLLECTION = "pipeline_telemetry"


# ---------------------------------------------------------------------------
# Firebase init (idéntico al audit script)
# ---------------------------------------------------------------------------

def _init_firebase_admin() -> None:
    if firebase_admin._apps:
        return
    load_dotenv(ROOT / ".env")
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and Path(cred_path).exists():
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        return
    project_id = os.environ.get("FIREBASE_PROJECT_ID") or os.environ.get("GCLOUD_PROJECT")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY")
    if project_id and client_email and private_key:
        private_key = private_key.replace("\\n", "\n")
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": project_id,
            "private_key": private_key,
            "client_email": client_email,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        firebase_admin.initialize_app(cred)
        return
    firebase_admin.initialize_app()


# ---------------------------------------------------------------------------
# Lectura del Budget + chapters
# ---------------------------------------------------------------------------

def fetch_budget(db: Any, budget_id: str) -> Optional[Dict[str, Any]]:
    """Lee budgets/{id} + subcollection chapters/* y reconstruye el árbol."""
    doc_ref = db.collection(BUDGETS_COLLECTION).document(budget_id)
    doc = doc_ref.get()
    if not doc.exists:
        return None
    budget = doc.to_dict() or {}
    budget["id"] = budget_id

    chapters_snap = doc_ref.collection("chapters").stream()
    chapters: List[Dict[str, Any]] = []
    for chap_doc in chapters_snap:
        chap = chap_doc.to_dict() or {}
        chap["_doc_id"] = chap_doc.id
        chapters.append(chap)
    budget["chapters"] = chapters
    return budget


def fetch_telemetry_events(db: Any, job_id: str) -> List[Dict[str, Any]]:
    """Lee pipeline_telemetry/{job_id}/events ordenado por timestamp."""
    events_snap = (
        db.collection(TELEMETRY_COLLECTION)
        .document(job_id)
        .collection("events")
        .order_by("timestamp")
        .stream()
    )
    events: List[Dict[str, Any]] = []
    for ev_doc in events_snap:
        data = ev_doc.to_dict() or {}
        data["_doc_id"] = ev_doc.id
        events.append(data)
    return events


# ---------------------------------------------------------------------------
# Análisis: estadísticas globales
# ---------------------------------------------------------------------------

def analyze_budget(budget: Dict[str, Any]) -> Dict[str, Any]:
    """Calcula stats globales sobre el budget."""
    chapters = budget.get("chapters", []) or []
    total_items = 0
    needs_review = 0
    match_dist: Counter = Counter()
    confidence_buckets: Counter = Counter()
    by_tier_used: Counter = Counter()
    items_flat: List[Dict[str, Any]] = []

    for chap in chapters:
        items = chap.get("items", []) or []
        for it in items:
            if it.get("type") != "PARTIDA":
                continue
            total_items += 1
            items_flat.append({**it, "_chapter_id": chap.get("_doc_id"), "_chapter_title": chap.get("title")})

            ai = it.get("ai_resolution") or {}
            mk = it.get("match_kind") or ai.get("match_kind") or "unknown"
            match_dist[mk] += 1

            cs_raw = ai.get("confidence_score")
            if isinstance(cs_raw, (int, float)):
                cs = float(cs_raw)
                if cs > 90:
                    confidence_buckets[">90"] += 1
                elif cs >= 85:
                    confidence_buckets["85-90"] += 1
                elif cs >= 40:
                    confidence_buckets["40-85"] += 1
                else:
                    confidence_buckets["<40"] += 1

            if ai.get("needs_human_review"):
                needs_review += 1

    return {
        "items_count": total_items,
        "chapters_count": len(chapters),
        "needs_review_count": needs_review,
        "match_distribution": dict(match_dist),
        "confidence_distribution": dict(confidence_buckets),
        "_items_flat": items_flat,
    }


def analyze_telemetry(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Resumen de events: por type, partidas resueltas v2, job_metrics_final."""
    by_type: Counter = Counter()
    partida_v2: List[Dict[str, Any]] = []
    job_metrics_final: Optional[Dict[str, Any]] = None
    tier_used_count: Counter = Counter()

    for ev in events:
        t = ev.get("type") or ev.get("event_type") or "unknown"
        by_type[t] += 1
        if t == "partida_resolved_v2":
            data = ev.get("data") or {}
            partida_v2.append(data)
            tu = data.get("tier_used")
            if tu:
                tier_used_count[tu] += 1
        if t == "job_metrics_final":
            job_metrics_final = ev.get("data") or {}

    return {
        "total_events": len(events),
        "events_by_type": dict(by_type),
        "partidas_resolved_v2_count": len(partida_v2),
        "tier_used_distribution": dict(tier_used_count),
        "job_metrics_final": job_metrics_final,
        "_partidas_resolved_v2": partida_v2,
    }


# ---------------------------------------------------------------------------
# Markdown report (legible para humanos)
# ---------------------------------------------------------------------------

def render_markdown(budget: Dict[str, Any], stats: Dict[str, Any], telemetry: Optional[Dict[str, Any]]) -> str:
    """Renderiza un MD con header + tabla por chapter + reasoning trace por partida."""
    out: List[str] = []
    out.append(f"# Budget Analysis Report")
    out.append("")
    out.append(f"- **Budget ID**: `{budget.get('id', '?')}`")
    out.append(f"- **Lead ID**: `{budget.get('leadId', '?')}`")
    out.append(f"- **Title**: {budget.get('title', '—')}")
    out.append(f"- **Total estimated**: {budget.get('totalEstimated', '—')} €")
    out.append(f"- **Created at**: {budget.get('createdAt', '—')}")
    out.append("")
    out.append(f"## Global stats")
    out.append("")
    out.append(f"- Items: **{stats['items_count']}**")
    out.append(f"- Chapters: **{stats['chapters_count']}**")
    out.append(f"- Needs human review: **{stats['needs_review_count']}**")
    out.append(f"- Match distribution: `{stats['match_distribution']}`")
    out.append(f"- Confidence distribution: `{stats['confidence_distribution']}`")
    out.append("")

    if telemetry:
        out.append(f"## Telemetry")
        out.append("")
        out.append(f"- Total events: **{telemetry['total_events']}**")
        out.append(f"- partida_resolved_v2: **{telemetry['partidas_resolved_v2_count']}**")
        out.append(f"- Tier used distribution: `{telemetry['tier_used_distribution']}`")
        if telemetry.get("job_metrics_final"):
            jmf = telemetry["job_metrics_final"]
            out.append(f"- **job_metrics_final**:")
            for k, v in jmf.items():
                out.append(f"  - {k}: `{v}`")
        out.append(f"- Events by type:")
        for t, n in sorted(telemetry["events_by_type"].items(), key=lambda kv: -kv[1])[:20]:
            out.append(f"  - `{t}`: {n}")
        out.append("")

    out.append(f"## Chapters & partidas")
    out.append("")

    for chap in budget.get("chapters", []) or []:
        chap_id = chap.get("_doc_id") or chap.get("id") or "?"
        chap_title = chap.get("title") or "(sin título)"
        items = chap.get("items", []) or []
        out.append(f"### {chap_title}")
        out.append(f"`{chap_id}` · {len(items)} ítems · subtotal: {chap.get('subtotal', '—')} €")
        out.append("")

        for it in items:
            if it.get("type") != "PARTIDA":
                continue
            ai = it.get("ai_resolution") or {}
            code = it.get("code", "?")
            desc = (it.get("description") or "").strip()
            unit = it.get("unit", "—")
            qty = it.get("quantity", 0)
            unit_p = it.get("unitPrice", 0)
            total_p = it.get("totalPrice", 0)
            mk = it.get("match_kind") or ai.get("match_kind") or "?"
            cs = ai.get("confidence_score", "—")
            nhr = ai.get("needs_human_review")
            trace = (ai.get("reasoning_trace") or "").strip()

            out.append(f"#### `{code}` — {desc[:100]}")
            out.append(f"- **unit**: {unit} · **qty**: {qty} · **unit_price**: {unit_p} € · **total**: {total_p} €")
            out.append(f"- **match_kind**: `{mk}` · **confidence**: {cs} · **needs_review**: {nhr}")
            if trace:
                out.append("")
                out.append("**Reasoning trace (juez cognitivo)**:")
                out.append("")
                out.append("> " + trace.replace("\n", "\n> "))
                out.append("")
            sel = ai.get("selected_candidate") or {}
            if sel:
                sel_code = sel.get("code") or sel.get("id") or "?"
                sel_desc = (sel.get("description") or "")[:120]
                out.append(f"- **selected_candidate**: `{sel_code}` — {sel_desc}")
            bkdn = it.get("breakdown") or []
            if bkdn:
                out.append(f"- **breakdown** ({len(bkdn)} componentes):")
                for c in bkdn[:5]:
                    cc = c.get("code") or "?"
                    cc_desc = (c.get("concept") or c.get("description") or "")[:80]
                    out.append(f"  - `{cc}` {cc_desc} — total: {c.get('total', '—')} €")
                if len(bkdn) > 5:
                    out.append(f"  - …y {len(bkdn) - 5} más")
            alts = it.get("alternatives") or []
            if alts:
                out.append(f"- **alternatives**: {len(alts)} candidatos rechazados")
            out.append("")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Deep-read of a generated budget + reasoning traces.")
    parser.add_argument("budget_id", help="Budget ID (== job ID for measurements jobs).")
    parser.add_argument("--output", default=None, help="Output base path (sin extensión). Default: stdout-like.")
    parser.add_argument("--include-telemetry", action="store_true", help="Incluye eventos del pipeline_telemetry.")
    parser.add_argument("--markdown", action="store_true", help="Genera también un .md legible.")
    args = parser.parse_args()

    _init_firebase_admin()
    db = firestore.client()

    logger.info(f"Cargando budget {args.budget_id}...")
    budget = fetch_budget(db, args.budget_id)
    if not budget:
        logger.error(f"No existe budget {args.budget_id} en colección '{BUDGETS_COLLECTION}'.")
        return 1

    stats = analyze_budget(budget)
    items_flat = stats.pop("_items_flat", None)  # solo para análisis interno; no sale al JSON top-level

    telemetry: Optional[Dict[str, Any]] = None
    if args.include_telemetry:
        logger.info(f"Cargando telemetry events para {args.budget_id}...")
        events = fetch_telemetry_events(db, args.budget_id)
        telemetry = analyze_telemetry(events)
        telemetry.pop("_partidas_resolved_v2", None)  # quitar la lista grande del JSON top-level

    logger.info(f"  Items: {stats['items_count']}, Chapters: {stats['chapters_count']}, Needs review: {stats['needs_review_count']}")
    logger.info(f"  Match dist: {stats['match_distribution']}")
    logger.info(f"  Confidence dist: {stats['confidence_distribution']}")
    if telemetry:
        logger.info(f"  Telemetry events: {telemetry['total_events']}, partida_v2: {telemetry['partidas_resolved_v2_count']}")

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "budget_id": args.budget_id,
        "budget": budget,
        "stats": stats,
        "telemetry": telemetry,
    }

    if args.output:
        json_path = Path(args.output).with_suffix(".json")
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        logger.info(f"JSON escrito en: {json_path}")

        if args.markdown:
            md_path = Path(args.output).with_suffix(".md")
            md_path.write_text(render_markdown(budget, stats, telemetry), encoding="utf-8")
            logger.info(f"Markdown escrito en: {md_path}")
    else:
        # Si no hay output, stdout solo el resumen (el JSON completo es grande).
        print(json.dumps({k: v for k, v in payload.items() if k != "budget"}, ensure_ascii=False, indent=2, default=str))

    return 0


if __name__ == "__main__":
    sys.exit(main())

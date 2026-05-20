"""Sprint 4 Fase A0 — Verifica el output REAL del fast path heuristico.

Invoca `try_heuristic_extraction` sobre los 4 PDFs golden y emite el
`RestructuredItem[]` exacto que iria al Swarm. Compara contra el output del
LLM Vision actual (qty=1.0, sin capitulos) para confirmar si el sprint 4
puede colapsar a "conectar lo existente".

Uso:
    python services/ai-core/scripts/verify_heuristic_output.py
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from io import BytesIO
from pathlib import Path

# Hard-code service root for imports.
SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

import pdfplumber  # noqa: E402

from src.budget.layout_analyzer.analyzer import try_heuristic_extraction  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN_DIR = REPO_ROOT / "data" / "pdf_layouts" / "golden"
OUTPUT_DIR = REPO_ROOT / "data" / "pdf_layouts" / "analysis"


def run(pdf_path: Path) -> dict:
    """Invoca try_heuristic_extraction y compara con baseline LLM Vision actual."""
    with pdfplumber.open(pdf_path) as pdf:
        text_per_page = [p.extract_text() or "" for p in pdf.pages]

    items = try_heuristic_extraction(text_per_page)

    if items is None:
        return {
            "file": pdf_path.name,
            "fast_path_used": False,
            "reason": "thresholds_not_met",
            "items": [],
            "stats": {},
        }

    qty_ok = sum(1 for it in items if it.quantity != 1.0)
    qty_default = sum(1 for it in items if it.quantity == 1.0)
    chapter_named = sum(1 for it in items if it.chapter and it.chapter != "Sin Capitulo")
    chapter_default = sum(1 for it in items if not it.chapter or it.chapter == "Sin Capitulo")
    unit_filled = sum(1 for it in items if it.unit and it.unit != "ud")
    unit_default = sum(1 for it in items if not it.unit or it.unit == "ud")

    chapter_counter: Counter[str] = Counter()
    for it in items:
        chapter_counter[it.chapter or "(empty)"] += 1

    sample = []
    for it in items[:15]:
        sample.append({
            "code": it.code,
            "description": (it.description or "")[:80],
            "quantity": it.quantity,
            "unit": it.unit,
            "chapter": it.chapter,
            "unit_normalized": str(it.unit_normalized) if it.unit_normalized else None,
            "unit_dimension": str(it.unit_dimension) if it.unit_dimension else None,
        })

    return {
        "file": pdf_path.name,
        "fast_path_used": True,
        "items_count": len(items),
        "stats": {
            "qty_extracted_real": qty_ok,
            "qty_default_1_0": qty_default,
            "qty_extraction_rate": round(qty_ok / max(1, len(items)), 3),
            "chapter_named": chapter_named,
            "chapter_default": chapter_default,
            "chapter_extraction_rate": round(chapter_named / max(1, len(items)), 3),
            "unit_filled": unit_filled,
            "unit_default_ud": unit_default,
        },
        "chapters_distribution": dict(chapter_counter.most_common()),
        "sample_first_15": sample,
    }


def main() -> int:
    if not GOLDEN_DIR.exists():
        print(f"[ERROR] No existe {GOLDEN_DIR}", file=sys.stderr)
        return 1

    pdfs = sorted(GOLDEN_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"[ERROR] No hay PDFs en {GOLDEN_DIR}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "heuristic_output_verification.json"

    results = []
    for pdf in pdfs:
        print(f"=" * 70)
        print(f"PDF: {pdf.name}")
        print(f"=" * 70)
        res = run(pdf)
        results.append(res)
        if not res["fast_path_used"]:
            print(f"  [SKIP] fast path NO usado: {res['reason']}")
            continue
        s = res["stats"]
        print(f"  items: {res['items_count']}")
        print(f"  qty real: {s['qty_extracted_real']}/{res['items_count']} "
              f"({s['qty_extraction_rate']*100:.0f}%)")
        print(f"  qty=1.0 fallback: {s['qty_default_1_0']}")
        print(f"  chapter detectado: {s['chapter_named']}/{res['items_count']} "
              f"({s['chapter_extraction_rate']*100:.0f}%)")
        print(f"  unit fillRate: {s['unit_filled']}/{res['items_count']}")
        print(f"  capitulos distintos: {len(res['chapters_distribution'])}")
        print(f"  Top 5 capitulos:")
        for ch, n in list(res["chapters_distribution"].items())[:5]:
            print(f"    {ch!r} -> {n}")

    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n=> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

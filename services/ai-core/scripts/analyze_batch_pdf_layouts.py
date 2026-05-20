"""Sprint 4 Fase A0+ - Analiza un directorio masivo de PDFs y emite summary.

Itera recursivamente todos los .pdf en un directorio, aplica
`layout_analyzer.analyzer.analyze_pdf` y `try_heuristic_extraction`, y emite:
  - CSV summary: una fila por PDF con metricas clave.
  - JSON detallado: contenido completo por PDF.

Util para Sprint 4 Fase A0 cuando hay decenas de PDFs candidatos golden.

Uso:
    python services/ai-core/scripts/analyze_batch_pdf_layouts.py
        --input "C:/Users/Usuario/Documents/consultorIA/basis/presupuestos-organizados/00-golden-candidates-2025"
        --out   "data/pdf_layouts/analysis/batch_golden_candidates"
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import traceback
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

import pdfplumber  # noqa: E402

from src.budget.layout_analyzer.analyzer import analyze_pdf, try_heuristic_extraction  # noqa: E402


def analyze_one(pdf: Path) -> Dict[str, Any]:
    """Aplica analyze_pdf + try_heuristic_extraction. Robusto a fallos."""
    try:
        fp = analyze_pdf(pdf)
    except Exception as e:
        return {
            "file": str(pdf.relative_to(pdf.parents[1]) if len(pdf.parents) > 1 else pdf),
            "error": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc()[:500],
        }

    # Invocar fast path tambien (necesita text_per_page).
    try:
        with pdfplumber.open(pdf) as p:
            text_per_page = [pg.extract_text() or "" for pg in p.pages]
        items = try_heuristic_extraction(text_per_page)
    except Exception:
        items = None

    qty_real = 0
    chapter_named = 0
    if items:
        for it in items:
            if it.quantity is not None and it.quantity != 1.0:
                qty_real += 1
            if it.chapter and it.chapter != "Sin Capitulo":
                chapter_named += 1

    return {
        "file": pdf.name,
        "parent_dir": pdf.parent.name,
        "size_kb": round(pdf.stat().st_size / 1024, 1),
        "pages": fp.pages,
        "text_extractable": fp.text_extractable,
        "layout_type": fp.layout.type,
        "layout_confidence": round(fp.layout.confidence, 2),
        "partidas_detected": fp.detected_partidas_count,
        "chapters_detected": len(fp.chapters),
        "fast_path_items": len(items) if items is not None else None,
        "qty_real_extracted": qty_real if items else None,
        "qty_rate": round(qty_real / max(1, len(items)), 3) if items else None,
        "chapter_rate": round(chapter_named / max(1, len(items)), 3) if items else None,
        "cross_page_candidates": len(fp.cross_page_candidates),
        "anomalies_count": len(fp.anomalies),
        "evidence_first": (fp.layout.evidence[0] if fp.layout.evidence else "")[:200],
        "sample_codes": ",".join(p.code for p in fp.partidas_sample[:5]),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch analizer of measurement PDFs.")
    parser.add_argument("--input", type=Path, required=True, help="Dir to scan (recursive).")
    parser.add_argument("--out", type=Path, required=True, help="Output dir (creates if missing).")
    parser.add_argument("--max", type=int, default=200, help="Max PDFs to process (safety).")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"[ERROR] No existe input dir: {args.input}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(args.input.rglob("*.pdf")) + sorted(args.input.rglob("*.PDF"))
    pdfs = [p for p in pdfs if p.is_file()][: args.max]

    print(f"Encontrados {len(pdfs)} PDFs en {args.input}.")
    print(f"Procesando hasta max={args.max}...")
    print()

    results: List[Dict[str, Any]] = []
    for i, pdf in enumerate(pdfs, start=1):
        print(f"[{i:>3d}/{len(pdfs)}] {pdf.name[:80]}... ", end="", flush=True)
        try:
            res = analyze_one(pdf)
        except Exception as e:
            res = {"file": pdf.name, "error": str(e)}
        if "error" in res:
            print(f"ERROR: {res['error'][:80]}")
        else:
            print(
                f"layout={res['layout_type']:>22s} "
                f"conf={res['layout_confidence']:.2f} "
                f"partidas={res['partidas_detected']:>4d} "
                f"caps={res['chapters_detected']:>3d} "
                f"qty_rate={res.get('qty_rate') or '-':<5} "
                f"pages={res['pages']:>3d}"
            )
        results.append(res)

    # CSV summary
    csv_path = args.out / "summary.csv"
    if results:
        cols = sorted({k for r in results for k in r.keys()})
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            for r in results:
                w.writerow(r)
        print(f"\nCSV summary => {csv_path}")

    # JSON detallado
    json_path = args.out / "full_results.json"
    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"JSON detalle => {json_path}")

    # Stats agregadas
    print()
    print("==================== STATS AGREGADAS ====================")
    by_layout: Dict[str, int] = {}
    by_unk_reason: Dict[str, int] = {}
    qty_rate_buckets = {"100%": 0, "80-99%": 0, "50-79%": 0, "1-49%": 0, "0%": 0, "no_items": 0}
    chapter_rate_buckets = {"100%": 0, "80-99%": 0, "50-79%": 0, "1-49%": 0, "0%": 0, "no_items": 0}

    for r in results:
        if "error" in r:
            by_layout["ERROR"] = by_layout.get("ERROR", 0) + 1
            continue
        lt = r["layout_type"]
        by_layout[lt] = by_layout.get(lt, 0) + 1
        if lt == "UNKNOWN":
            ev = (r["evidence_first"] or "")[:50]
            by_unk_reason[ev] = by_unk_reason.get(ev, 0) + 1
        qr = r.get("qty_rate")
        if qr is None:
            qty_rate_buckets["no_items"] += 1
        elif qr == 0.0:
            qty_rate_buckets["0%"] += 1
        elif qr >= 1.0:
            qty_rate_buckets["100%"] += 1
        elif qr >= 0.80:
            qty_rate_buckets["80-99%"] += 1
        elif qr >= 0.50:
            qty_rate_buckets["50-79%"] += 1
        else:
            qty_rate_buckets["1-49%"] += 1
        cr = r.get("chapter_rate")
        if cr is None:
            chapter_rate_buckets["no_items"] += 1
        elif cr == 0.0:
            chapter_rate_buckets["0%"] += 1
        elif cr >= 1.0:
            chapter_rate_buckets["100%"] += 1
        elif cr >= 0.80:
            chapter_rate_buckets["80-99%"] += 1
        elif cr >= 0.50:
            chapter_rate_buckets["50-79%"] += 1
        else:
            chapter_rate_buckets["1-49%"] += 1

    print()
    print("LAYOUT DISTRIBUTION:")
    for k, v in sorted(by_layout.items(), key=lambda kv: -kv[1]):
        print(f"  {k:>25s}: {v:>3d} ({100*v/len(results):.0f}%)")
    if by_unk_reason:
        print()
        print("UNKNOWN REASONS:")
        for k, v in sorted(by_unk_reason.items(), key=lambda kv: -kv[1]):
            print(f"  {v:>3d}x: {k}")
    print()
    print("QTY EXTRACTION RATE:")
    for k, v in qty_rate_buckets.items():
        print(f"  {k:>10s}: {v:>3d}")
    print()
    print("CHAPTER EXTRACTION RATE:")
    for k, v in chapter_rate_buckets.items():
        print(f"  {k:>10s}: {v:>3d}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

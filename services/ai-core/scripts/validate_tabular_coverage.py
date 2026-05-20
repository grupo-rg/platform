"""Sprint 4 Fase A — validar cobertura real del parser TABULAR sobre los 28
PDFs candidates del cliente.

Para cada PDF en el directorio dado:
  - Invoca TabularParser.parse(pdf_bytes).
  - Reporta: viable?, items_count, qty_rate, chapter_rate, duration, reason.

Output:
  - Stdout: tabla resumen por PDF.
  - JSON detallado en data/pdf_layouts/analysis/tabular_coverage_28pdfs.json.
  - CSV summary en data/pdf_layouts/analysis/tabular_coverage_28pdfs.csv.

Uso:
    python services/ai-core/scripts/validate_tabular_coverage.py
        --input "C:/Users/Usuario/Documents/consultorIA/basis/presupuestos-organizados/00-golden-candidates-2025"
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser  # noqa: E402


def evaluate_one(pdf: Path, parser: TabularParser) -> Dict[str, Any]:
    """Aplica TabularParser y devuelve diccionario con metricas."""
    try:
        pdf_bytes = pdf.read_bytes()
    except Exception as e:
        return {"file": pdf.name, "error": f"read_failed: {e}"}

    t0 = time.time()
    try:
        result = parser.parse(pdf_bytes)
    except Exception as e:
        return {
            "file": pdf.name,
            "error": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc()[:300],
        }
    duration = time.time() - t0

    return {
        "file": pdf.name,
        "parent_dir": pdf.parent.name,
        "size_kb": round(pdf.stat().st_size / 1024, 1),
        "pages_total": result.pages_total,
        "viable": result.is_viable(),
        "reason": result.reason or "",
        "partidas_count": result.partidas_count,
        "qty_rate": round(result.qty_rate, 3) if result.qty_rate is not None else None,
        "chapter_rate": round(result.chapter_rate, 3) if result.chapter_rate is not None else None,
        "duration_seconds": round(duration, 2),
        "header_pages": getattr(result, "header_pages_found", None),
        "sample_codes": ",".join(p.code for p in result.partidas[:5]) if result.partidas else "",
    }


def main() -> int:
    parser_cli = argparse.ArgumentParser()
    parser_cli.add_argument("--input", type=Path, required=True)
    parser_cli.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[3] / "data" / "pdf_layouts" / "analysis")
    args = parser_cli.parse_args()

    if not args.input.exists():
        print(f"[ERROR] No existe: {args.input}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(args.input.rglob("*.pdf")) + sorted(args.input.rglob("*.PDF"))
    pdfs = [p for p in pdfs if p.is_file()]
    print(f"Encontrados {len(pdfs)} PDFs.\n")

    tabular = TabularParser()

    results: List[Dict[str, Any]] = []
    for i, pdf in enumerate(pdfs, start=1):
        print(f"[{i:>3d}/{len(pdfs)}] {pdf.name[:65]:65s} ... ", end="", flush=True)
        res = evaluate_one(pdf, tabular)
        results.append(res)
        if "error" in res:
            print(f"ERROR: {res['error'][:60]}")
        elif not res["viable"]:
            print(f"NOT_VIABLE   reason={res['reason']:30s} pages={res['pages_total']:>3d} part={res['partidas_count']:>3d}")
        else:
            print(
                f"VIABLE       qty={res['qty_rate'] or 0:.0%} ch={res['chapter_rate'] or 0:.0%} "
                f"pages={res['pages_total']:>3d} part={res['partidas_count']:>3d} dur={res['duration_seconds']:.1f}s"
            )

    # Stats agregadas
    print()
    print("=" * 70)
    print("STATS AGREGADAS")
    print("=" * 70)

    viable = [r for r in results if r.get("viable")]
    not_viable = [r for r in results if "error" not in r and not r.get("viable")]
    errors = [r for r in results if "error" in r]

    print(f"\nViable:     {len(viable):>3d} ({100*len(viable)/max(1,len(results)):.0f}%)")
    print(f"Not viable: {len(not_viable):>3d} ({100*len(not_viable)/max(1,len(results)):.0f}%)")
    print(f"Errors:     {len(errors):>3d}")

    if viable:
        qty_rates = [r["qty_rate"] for r in viable if r.get("qty_rate") is not None]
        ch_rates = [r["chapter_rate"] for r in viable if r.get("chapter_rate") is not None]
        print(f"\nDe los viable:")
        print(f"  qty_rate medio:     {sum(qty_rates)/max(1,len(qty_rates)):.2%}")
        print(f"  chapter_rate medio: {sum(ch_rates)/max(1,len(ch_rates)):.2%}")
        print(f"  qty_rate >= 95%:    {sum(1 for r in qty_rates if r >= 0.95)}/{len(qty_rates)}")
        print(f"  chapter_rate >= 95%: {sum(1 for r in ch_rates if r >= 0.95)}/{len(ch_rates)}")

    print(f"\nRazones not_viable:")
    reasons: Dict[str, int] = {}
    for r in not_viable:
        reason = r.get("reason", "unknown")
        reasons[reason] = reasons.get(reason, 0) + 1
    for k, v in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"  {v:>3d}x  {k}")

    # Persist
    out_csv = args.out / "tabular_coverage_28pdfs.csv"
    out_json = args.out / "tabular_coverage_28pdfs.json"

    if results:
        cols = sorted({k for r in results for k in r.keys()})
        with out_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            for r in results:
                w.writerow(r)

    out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    print(f"\nCSV  => {out_csv}")
    print(f"JSON => {out_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

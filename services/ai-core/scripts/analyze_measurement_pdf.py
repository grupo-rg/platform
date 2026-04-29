"""CLI: analiza un PDF de mediciones y emite fingerprint estructural.

Uso:
    python scripts/analyze_measurement_pdf.py path/to/file.pdf
    python scripts/analyze_measurement_pdf.py path/to/file.pdf --out custom_output_dir

Output (por defecto en `services/ai-core/evals/layout_analysis/`):
    - {pdf_stem}.json   — fingerprint serializable
    - {pdf_stem}.md     — versión legible para inspección humana

NO toca el pipeline de producción. Es una herramienta diagnóstica del spike
9.S — el operador la corre ofline para ver qué patrones detectables tiene
cada PDF y decidir cómo evolucionar el extractor.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.budget.layout_analyzer.analyzer import analyze_pdf  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_OUT_DIR = ROOT / "evals" / "layout_analysis"


def main() -> int:
    parser = argparse.ArgumentParser(description="Analiza un PDF de mediciones (Layout Analyzer offline).")
    parser.add_argument("pdf_path", type=Path, help="Ruta al PDF a analizar")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR,
                        help=f"Directorio destino (default: {DEFAULT_OUT_DIR})")
    args = parser.parse_args()

    pdf_path: Path = args.pdf_path
    out_dir: Path = args.out

    if not pdf_path.exists():
        logger.error(f"No existe: {pdf_path}")
        return 1
    if pdf_path.suffix.lower() != ".pdf":
        logger.error(f"No es un PDF: {pdf_path}")
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"Analizando {pdf_path.name}...")
    fp = analyze_pdf(pdf_path)

    stem = pdf_path.stem
    json_path = out_dir / f"{stem}.json"
    md_path = out_dir / f"{stem}.md"

    json_path.write_text(
        json.dumps(fp.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    md_path.write_text(fp.to_markdown(), encoding="utf-8")

    logger.info(f"✅ Layout: {fp.layout.type} (confidence {fp.layout.confidence:.2f})")
    logger.info(f"   Partidas detectadas: {fp.detected_partidas_count}")
    logger.info(f"   Heuristic-extracted: {fp.extracted_via_heuristics_count}")
    logger.info(f"   Necesitarían LLM:    {fp.needs_llm_count}")
    logger.info(f"   Capítulos:           {len(fp.chapters)}")
    logger.info(f"   Cross-page candidates: {len(fp.cross_page_candidates)}")
    logger.info(f"   Anomalías:           {len(fp.anomalies)}")
    logger.info(f"→ {json_path}")
    logger.info(f"→ {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

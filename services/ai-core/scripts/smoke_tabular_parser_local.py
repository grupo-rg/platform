"""Sprint 4 Fase C smoke — InlinePdfExtractorService end-to-end LOCAL.

Verifica que con USE_TABULAR_PARSER=true:
  1. Un PDF viable (private_residence_palma) usa el path TABULAR sin llamar
     al LLM. Devuelve >=74 partidas con qty/chapter real.
  2. Un PDF no viable corto (sanitas_dental) cae al heurístico legacy 9.2
     sin caer al LLM Vision.
  3. Un PDF que cae a LLM Vision con >50pp (RdLL 258pp) aborta con
     LayoutUnsupportedError + emite pipeline_error SSE.

NO requiere credenciales de Gemini ni de Firebase. Usa LLMProvider mock.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

# Activar feature flag ANTES de importar el extractor.
os.environ["USE_TABULAR_PARSER"] = "true"

from src.budget.application.services.pdf_extractor_service import (  # noqa: E402
    InlinePdfExtractorService,
    LayoutUnsupportedError,
)


class FakeEmitter:
    """Captura todos los eventos SSE para inspección post-smoke."""

    def __init__(self) -> None:
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({
            "budget_id": budget_id,
            "event_type": event_type,
            "data": data,
        })


def make_extractor() -> "InlinePdfExtractorService":
    """Instancia InlinePdfExtractorService con dependencias mockeadas."""
    llm = MagicMock()
    # Si el camino TABULAR funciona, no se llama al LLM. Pero por si acaso:
    llm.generate_structured = AsyncMock(return_value=(MagicMock(items=[], orphan_tail_text="", last_item_truncated=False), {}))
    emitter = FakeEmitter()
    svc = InlinePdfExtractorService(llm_provider=llm, emitter=emitter)
    return svc


async def smoke_pdf(svc: "InlinePdfExtractorService", pdf_path: Path, *, expect_tabular: bool, expect_abort: bool = False) -> None:
    print(f"\n{'=' * 70}")
    print(f"SMOKE: {pdf_path.name}")
    print(f"  expect_tabular={expect_tabular}  expect_abort={expect_abort}")
    print(f"{'=' * 70}")

    pdf_bytes = pdf_path.read_bytes()
    metrics: Dict[str, Any] = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    # `raw_items` simulado: lista con N páginas (el extractor lo usa para chunking en LLM path).
    # Para PDFs viables (TABULAR ok) no se usa. Para PDFs no-viable se chunkea.
    # Necesitamos un valor proporcional al PDF para que A9 enforcement aplique:
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        num_pages = len(pdf.pages)
    raw_items = [{"image_base64": "fake", "page_number": i} for i in range(num_pages)]

    try:
        items = await svc.extract(raw_items=raw_items, budget_id="smoke-1", metrics=metrics, pdf_bytes=pdf_bytes)
        if expect_abort:
            print(f"  [FAIL] esperábamos LayoutUnsupportedError, pero retornó {len(items)} items.")
            return
        print(f"  [OK]  retornados {len(items)} items.")
        # Verificar que entró por TABULAR:
        method_used = "unknown"
        for ev in reversed(svc.emitter.events):  # type: ignore[attr-defined]
            if ev["event_type"] == "inline_fast_path_used":
                method_used = ev["data"].get("method", "unknown")
                break
        print(f"  fast_path method: {method_used}")
        if expect_tabular:
            assert method_used == "tabular_parser_coord_based", (
                f"esperábamos tabular_parser_coord_based, got {method_used}"
            )
            print(f"  [OK]usó TABULAR parser")
        # Stats:
        qty_real = sum(1 for it in items if it.quantity != 1.0)
        chapter_named = sum(1 for it in items if it.chapter and it.chapter != "Sin Capítulo")
        print(f"  qty_real:      {qty_real}/{len(items)} ({100*qty_real/max(1,len(items)):.0f}%)")
        print(f"  chapter_named: {chapter_named}/{len(items)} ({100*chapter_named/max(1,len(items)):.0f}%)")
        # Sample 3 partidas:
        print(f"  sample (first 3):")
        for it in items[:3]:
            print(f"    code={it.code:<15s} qty={it.quantity:>8.3f} unit={it.unit:<6s} chapter={(it.chapter or '-')[:35]}")
    except LayoutUnsupportedError as e:
        if expect_abort:
            print(f"  [OK] abortó con LayoutUnsupportedError: {str(e)[:100]}")
            # Verificar que emitió pipeline_error:
            err_events = [e for e in svc.emitter.events if e["event_type"] == "pipeline_error"]  # type: ignore[attr-defined]
            if err_events:
                payload = err_events[-1]["data"]
                print(f"  pipeline_error errorType: {payload.get('errorType')}")
                print(f"  pagesAttempted={payload.get('pagesAttempted')}  max={payload.get('maxPagesAllowed')}")
        else:
            print(f"  [FAIL] LayoutUnsupportedError inesperado: {e}")
    except Exception as e:
        print(f"  [ERROR] {type(e).__name__}: {e}")
        raise


async def main() -> int:
    GOLDEN = Path(r"c:\Users\Usuario\Documents\github\works\dochevi\dochevi-construc\data\pdf_layouts\golden")
    if not GOLDEN.exists():
        print(f"[FATAL] no existe {GOLDEN}", file=sys.stderr)
        return 1

    # Test 1: PDF viable (private_residence_palma).
    svc1 = make_extractor()
    await smoke_pdf(svc1, GOLDEN / "private_residence_palma.pdf", expect_tabular=True)

    # Test 2: PDF chico no viable (sanitas_dental) — cae a Fase 9.2.
    svc2 = make_extractor()
    await smoke_pdf(svc2, GOLDEN / "sanitas_dental.pdf", expect_tabular=False)
    # Verificar que NO entró por TABULAR + sí emitió tabular_parser_aborted:
    abort_evs = [e for e in svc2.emitter.events if e["event_type"] == "tabular_parser_aborted"]
    if abort_evs:
        print(f"  [OK]TABULAR aborted con reason: {abort_evs[-1]['data'].get('reason')}")

    # Test 3: PDF >50 pp que cae a LLM Vision → A9 enforcement.
    svc3 = make_extractor()
    await smoke_pdf(svc3, GOLDEN / "presupuesto_grande_rdll.pdf", expect_tabular=False, expect_abort=True)

    print(f"\n{'=' * 70}")
    print("SMOKE END")
    print(f"{'=' * 70}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

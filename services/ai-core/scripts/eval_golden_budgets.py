"""Fase 5.H — Evaluador del golden set v005.

Itera sobre los 3 goldens (`evals/golden_budgets/NNN-slug/`) y aplica las
métricas específicas de cada uno según su `rigor` declarado en `meta.json`:

  - "benchmark" (001)       → recall + precision_1to1 + price_delta + chapter_total_delta
  - "regression_guard" (002) → partidas_count + chapter_coverage + dag_compliance vs baseline
  - "qualitative" (003)     → mandatory_chapters + dag + pem_range + all_codes_valid

Este módulo contiene:
  - Funciones puras testeadas con TDD: `match_partidas`, `normalize_code`,
    `compute_recall`, `compute_precision_1to1`, `compute_price_delta_percentiles`,
    `compute_chapter_total_delta`.
  - Orquestador `run_eval()` que carga los goldens, ejecuta el pipeline
    (hook `run_pipeline_on_input()` — ver módulo `eval_pipeline_runner.py`
    para la integración con Firestore + Gemini), y emite `eval_v005.json`.

Uso:
    venv/Scripts/python.exe scripts/eval_golden_budgets.py
    venv/Scripts/python.exe scripts/eval_golden_budgets.py --only 001-mu02-p030326
    venv/Scripts/python.exe scripts/eval_golden_budgets.py --dry-run  # no ejecuta pipeline

En dry-run valida la estructura de los 3 goldens y sus expected sin
requerir credenciales ni Firestore.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# -------- Matcher ----------------------------------------------------------

_FUZZY_THRESHOLD = 0.75  # calibrado: las descripciones del price_book son
# más largas que las del presupuesto humano (≈ ratio 0.7-0.85 para matches válidos)


def normalize_code(code: Optional[str]) -> str:
    if not code:
        return ""
    return re.sub(r"\W", "", code).lower()


def _fuzzy_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def match_partidas(
    golden: List[Dict[str, Any]],
    pipeline: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Cada golden se empareja como máximo con 1 pipeline. Precedencia:
    exact_code → normalized_code → fuzzy_description. Si nada iguala
    ≥ _FUZZY_THRESHOLD, el golden queda sin match (recall miss)."""
    matches: List[Dict[str, Any]] = []
    used_pipeline_idx: set[int] = set()

    # Paso 1: exact code
    pipeline_by_code = {
        i: p for i, p in enumerate(pipeline)
        if p.get("code")
    }
    for g in golden:
        gcode = g.get("code")
        if not gcode:
            continue
        hit = next(
            (i for i, p in pipeline_by_code.items()
             if i not in used_pipeline_idx and p["code"] == gcode),
            None,
        )
        if hit is not None:
            matches.append({
                "golden": g,
                "pipeline": pipeline[hit],
                "match_level": "exact_code",
            })
            used_pipeline_idx.add(hit)

    # Paso 2: normalized code
    pending_golden = [g for g in golden if not any(m["golden"] is g for m in matches)]
    for g in pending_golden:
        gnorm = normalize_code(g.get("code"))
        if not gnorm:
            continue
        hit = next(
            (i for i, p in enumerate(pipeline)
             if i not in used_pipeline_idx and normalize_code(p.get("code")) == gnorm),
            None,
        )
        if hit is not None:
            matches.append({
                "golden": g,
                "pipeline": pipeline[hit],
                "match_level": "normalized_code",
            })
            used_pipeline_idx.add(hit)

    # Paso 3: fuzzy sobre descripción
    pending_golden = [g for g in golden if not any(m["golden"] is g for m in matches)]
    for g in pending_golden:
        gdesc = g.get("description", "")
        if not gdesc:
            continue
        best_i: Optional[int] = None
        best_ratio = 0.0
        for i, p in enumerate(pipeline):
            if i in used_pipeline_idx:
                continue
            r = _fuzzy_ratio(gdesc, p.get("description", ""))
            if r > best_ratio:
                best_ratio = r
                best_i = i
        if best_i is not None and best_ratio >= _FUZZY_THRESHOLD:
            matches.append({
                "golden": g,
                "pipeline": pipeline[best_i],
                "match_level": "fuzzy_description",
                "fuzzy_ratio": round(best_ratio, 3),
            })
            used_pipeline_idx.add(best_i)

    return matches


# -------- Métricas ---------------------------------------------------------


def compute_recall(
    golden: List[Dict[str, Any]],
    matches: List[Dict[str, Any]],
) -> float:
    if not golden:
        return 0.0
    return len(matches) / len(golden)


def compute_precision_1to1(matches: List[Dict[str, Any]]) -> float:
    if not matches:
        return 0.0
    exact = sum(1 for m in matches if m["match_level"] == "exact_code")
    return exact / len(matches)


def compute_price_delta_percentiles(
    matches: List[Dict[str, Any]],
) -> Tuple[float, float]:
    """Devuelve (p50, p95) del error relativo |pipeline-golden|/golden del unit price.
    Saltea matches donde golden unitPrice == 0 (división cero)."""
    deltas: List[float] = []
    for m in matches:
        g_price = float(m["golden"].get("unitPrice", 0))
        p_price = float(m["pipeline"].get("unitPrice", 0))
        if g_price == 0:
            continue
        deltas.append(abs(p_price - g_price) / g_price)
    if not deltas:
        return (0.0, 0.0)
    deltas.sort()
    n = len(deltas)
    # p50
    p50 = deltas[n // 2] if n % 2 else (deltas[n // 2 - 1] + deltas[n // 2]) / 2
    # p95
    p95_idx = int(0.95 * (n - 1))
    p95 = deltas[p95_idx]
    return (p50, p95)


def compute_chapter_total_delta(
    golden: List[Dict[str, Any]],
    pipeline: List[Dict[str, Any]],
) -> float:
    """Media del error relativo del sumatorio de totalPrice por capítulo.
    El `chapter` del pipeline puede ser string, el del golden es int en
    `chapter_num`. Se normaliza comparando por string."""
    g_totals: Dict[str, float] = defaultdict(float)
    for g in golden:
        key = str(g.get("chapter_num", g.get("chapter", "")))
        g_totals[key] += float(g.get("totalPrice", 0))

    p_totals: Dict[str, float] = defaultdict(float)
    for p in pipeline:
        key = str(p.get("chapter_num", p.get("chapter", "")))
        p_totals[key] += float(p.get("totalPrice", 0))

    deltas: List[float] = []
    for key, g_sum in g_totals.items():
        if g_sum == 0:
            continue
        p_sum = p_totals.get(key, 0)
        deltas.append(abs(p_sum - g_sum) / g_sum)
    if not deltas:
        return 0.0
    return sum(deltas) / len(deltas)


# -------- 6.G — Métricas recalibradas --------------------------------------


def compute_precision_semantic(
    matches: List[Dict[str, Any]],
    description_threshold: float = 0.80,
) -> float:
    """Sustituto semántico de `precision_1to1` (6.G).

    Motivo: los códigos del golden (Presto / RG) nunca coinciden con los del
    pipeline (COAATMCA), así que `precision_1to1` siempre daba 0 y era
    engañoso. Esta métrica mide algo real: qué fracción de matches tienen
    descripción realmente parecida (fuzzy ≥ threshold) Y el mismo capítulo.
    """
    if not matches:
        return 0.0
    precise = 0
    for m in matches:
        g = m.get("golden", {})
        p = m.get("pipeline", {})
        g_desc = (g.get("description") or "").strip()
        p_desc = (p.get("description") or "").strip()
        if not g_desc or not p_desc:
            continue
        ratio = _fuzzy_ratio(g_desc, p_desc)
        if ratio < description_threshold:
            continue
        # Los capítulos deben coincidir si ambos están presentes.
        g_ch = str(g.get("chapter_num", g.get("chapter", ""))).strip()
        p_ch = str(p.get("chapter_num", p.get("chapter", ""))).strip()
        if g_ch and p_ch and g_ch != p_ch:
            continue
        precise += 1
    return precise / len(matches)


def compute_chapter_total_delta_weighted(
    golden: List[Dict[str, Any]],
    pipeline: List[Dict[str, Any]],
) -> float:
    """Versión normalizada por PEM absoluto (6.G).

    Motivo: la media simple (`compute_chapter_total_delta`) trata a un
    capítulo con PEM de 1€ y error 200% igual que a uno de 900€ con 10% —
    sesgando la métrica hacia capítulos pequeños. Esta variante pondera cada
    error por el PEM real del capítulo del golden.

    Fórmula: Σ |p_sum - g_sum|  /  Σ g_sum.
    """
    g_totals: Dict[str, float] = defaultdict(float)
    for g in golden:
        key = str(g.get("chapter_num", g.get("chapter", "")))
        g_totals[key] += float(g.get("totalPrice", 0))

    p_totals: Dict[str, float] = defaultdict(float)
    for p in pipeline:
        key = str(p.get("chapter_num", p.get("chapter", "")))
        p_totals[key] += float(p.get("totalPrice", 0))

    total_golden = sum(g_totals.values())
    if total_golden <= 0:
        return 0.0
    total_error = 0.0
    all_keys = set(g_totals.keys()) | set(p_totals.keys())
    for key in all_keys:
        total_error += abs(p_totals.get(key, 0) - g_totals.get(key, 0))
    return total_error / total_golden


# -------- Hook de ejecución del pipeline (stub, pendiente de integración) --


def run_pipeline_on_input(
    input_path: Path,
    flow: str,
    brief: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Ejecuta el pipeline v005 contra el input del golden.

    Usa `eval_pipeline_runner.run_pipeline()` que instancia el stack completo
    con Firestore + Gemini + el Swarm cableado con los 3 deps v005
    (catalog_lookup, rules, dag). Devuelve una lista plana de partidas
    `[{code, description, unit, quantity, unitPrice, totalPrice, chapter,
       match_kind, unit_conversion_applied}]` lista para comparar con el golden.

    Requiere variables de entorno activas (las mismas que
    `src/core/http/dependencies.py`).
    """
    # Aseguramos que `scripts/` sea importable cuando eval_golden_budgets.py
    # se ejecuta directamente (no como `python -m scripts.eval_golden_budgets`).
    import sys as _sys
    _scripts_parent = str(Path(__file__).resolve().parent.parent)
    if _scripts_parent not in _sys.path:
        _sys.path.insert(0, _scripts_parent)
    from scripts.eval_pipeline_runner import run_pipeline as _run_pipeline
    budget_id = f"eval-{input_path.stem if input_path else 'nl'}"
    return _run_pipeline(
        flow=flow,
        input_path=input_path if flow.upper() != "NL" else None,
        brief=brief,
        budget_id=budget_id,
    )


# -------- Orquestador ------------------------------------------------------


@dataclass
class GoldenResult:
    golden_id: str
    flow: str
    rigor: str
    metrics: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)


def _load_golden(folder: Path) -> Dict[str, Any]:
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    expected: Dict[str, Any] = {}
    # expected.json si existe, si no expected_chapters.json
    for name in ("expected.json", "expected_chapters.json", "baseline_v005.json"):
        p = folder / name
        if p.exists():
            expected = json.loads(p.read_text(encoding="utf-8"))
            break
    return {"meta": meta, "expected": expected, "folder": folder}


def evaluate_benchmark(golden_data: Dict, pipeline_output: List[Dict]) -> Dict[str, Any]:
    """Rigor 'benchmark' — golden 001 (MU02 ↔ P030326)."""
    golden_partidas = golden_data["expected"].get("partidas", [])
    matches = match_partidas(golden_partidas, pipeline_output)
    p50, p95 = compute_price_delta_percentiles(matches)
    chapter_delta = compute_chapter_total_delta(golden_partidas, pipeline_output)
    chapter_delta_weighted = compute_chapter_total_delta_weighted(
        golden_partidas, pipeline_output
    )
    canonical_matched = any(
        m["golden"].get("canonical_case") for m in matches
    )
    thresholds = golden_data["meta"].get("thresholds", {})
    recall = compute_recall(golden_partidas, matches)
    # Métricas legacy (se mantienen en el JSON para comparabilidad con runs previos).
    precision_legacy = compute_precision_1to1(matches)
    # Métricas 6.G (métrica primaria de passes_thresholds).
    precision_semantic = compute_precision_semantic(matches)
    return {
        "recall": round(recall, 3),
        # 6.G — primaria
        "precision_semantic": round(precision_semantic, 3),
        "chapter_total_delta_weighted": round(chapter_delta_weighted, 3),
        # Legacy — kept for backward comparability across historical runs
        "precision_1to1": round(precision_legacy, 3),
        "chapter_total_delta_mean": round(chapter_delta, 3),
        "price_delta_p50": round(p50, 3),
        "price_delta_p95": round(p95, 3),
        "matches_count": len(matches),
        "golden_count": len(golden_partidas),
        "canonical_case_matched": canonical_matched,
        "passes_thresholds": (
            recall >= thresholds.get("recall_min", 0)
            # Threshold recalibrado: precision_semantic ≥ precision_semantic_min
            # (default 0.75 — calibrado para matches de descripciones similares).
            and precision_semantic >= thresholds.get("precision_semantic_min", 0)
            and p50 <= thresholds.get("price_delta_p50_max", 1)
            # Nuevo threshold pondera chapter_total_delta_weighted.
            and chapter_delta_weighted <= thresholds.get("chapter_total_delta_weighted_max", 1)
        ),
    }


def evaluate_regression_guard(golden_data: Dict, pipeline_output: List[Dict]) -> Dict[str, Any]:
    """Rigor 'regression_guard' — golden 002 (SANITAS DENTAL)."""
    baseline = golden_data["expected"].get("partidas", []) if golden_data["expected"] else []
    thresholds = golden_data["meta"].get("thresholds", {})
    if not baseline:
        return {
            "first_run": True,
            "partidas_count": len(pipeline_output),
            "chapters_count": len({str(p.get("chapter", "")) for p in pipeline_output}),
            "note": "Primera ejecución — congelar como baseline_v005.json",
            "passes_thresholds": len(pipeline_output) >= thresholds.get("partidas_extracted_min", 0),
        }
    # Compara contra baseline
    tol = thresholds.get("regression_tolerance_pct", 5.0) / 100
    base_count = len(baseline)
    cur_count = len(pipeline_output)
    regression = (base_count - cur_count) / base_count if base_count > 0 else 0
    return {
        "first_run": False,
        "baseline_count": base_count,
        "current_count": cur_count,
        "regression_pct": round(regression * 100, 2),
        "passes_thresholds": regression <= tol,
    }


def evaluate_qualitative(golden_data: Dict, pipeline_output: List[Dict]) -> Dict[str, Any]:
    """Rigor 'qualitative' — golden 003 (NL Reforma Baño)."""
    expected = golden_data["expected"]
    mandatory = set(expected.get("mandatory_chapters", []))
    pem_range = expected.get("pem_range_eur", {"min": 0, "max": 1e9})

    pipeline_chapters = {str(p.get("chapter", "")) for p in pipeline_output}
    mandatory_present = mandatory & pipeline_chapters
    pem_total = sum(float(p.get("totalPrice", 0)) for p in pipeline_output)

    thresholds = golden_data["meta"].get("thresholds", {})
    return {
        "mandatory_chapters_present": sorted(mandatory_present),
        "mandatory_chapters_missing": sorted(mandatory - pipeline_chapters),
        "mandatory_count": len(mandatory_present),
        "pem_total": round(pem_total, 2),
        "pem_in_range": pem_range["min"] <= pem_total <= pem_range["max"],
        "partidas_count": len(pipeline_output),
        "passes_thresholds": (
            len(mandatory_present) >= thresholds.get("mandatory_chapters_present_min", 0)
            and pem_range["min"] <= pem_total <= pem_range["max"]
        ),
    }


def run_eval(
    root: Path,
    only: Optional[str] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Carga goldens, ejecuta pipeline (a menos que dry_run), emite métricas."""
    goldens_dir = root / "evals" / "golden_budgets"
    if not goldens_dir.exists():
        raise FileNotFoundError(goldens_dir)

    folders = sorted(p for p in goldens_dir.iterdir()
                     if p.is_dir() and (p / "meta.json").exists())
    if only:
        folders = [p for p in folders if p.name == only]

    results: List[GoldenResult] = []
    for folder in folders:
        logger.info(f"Evaluando {folder.name}...")
        gd = _load_golden(folder)
        meta = gd["meta"]
        rigor = meta.get("rigor", "unknown")

        r = GoldenResult(
            golden_id=meta.get("golden_id", folder.name),
            flow=meta.get("flow", "?"),
            rigor=rigor,
        )

        if dry_run:
            r.metrics = {
                "dry_run": True,
                "meta_loaded": True,
                "expected_type": ("partidas" if gd["expected"].get("partidas")
                                  else "chapters" if gd["expected"].get("mandatory_chapters")
                                  else "baseline" if gd["expected"].get("baseline")
                                  else "empty"),
            }
            results.append(r)
            continue

        try:
            flow = meta.get("flow", "INLINE")
            input_path = folder / "input.pdf"
            brief = None
            if flow == "NL":
                brief = (folder / "brief.txt").read_text(encoding="utf-8").strip()
            pipeline_output = run_pipeline_on_input(input_path, flow, brief)
        except NotImplementedError as e:
            r.errors.append(str(e))
            r.metrics = {"error": "pipeline not wired"}
            results.append(r)
            continue
        except Exception as e:
            r.errors.append(f"{type(e).__name__}: {e}")
            r.metrics = {"error": str(e)}
            results.append(r)
            continue

        partidas_output = pipeline_output.get("partidas", []) if isinstance(pipeline_output, dict) else pipeline_output
        if rigor == "benchmark":
            r.metrics = evaluate_benchmark(gd, partidas_output)
        elif rigor == "regression_guard":
            r.metrics = evaluate_regression_guard(gd, partidas_output)
        elif rigor == "qualitative":
            r.metrics = evaluate_qualitative(gd, partidas_output)
        else:
            r.metrics = {"error": f"unknown rigor: {rigor}"}

        results.append(r)

    # Agregado
    report = {
        "run_id": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "dry_run": dry_run,
        "goldens_count": len(results),
        "results": [
            {
                "golden_id": r.golden_id,
                "flow": r.flow,
                "rigor": r.rigor,
                "metrics": r.metrics,
                "errors": r.errors,
            }
            for r in results
        ],
    }
    return report


def _parse_cli() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                    help="Raíz de services/ai-core (por defecto, la del propio script)")
    ap.add_argument("--only", type=str, default=None,
                    help="Solo un golden (p.ej. 001-mu02-p030326)")
    ap.add_argument("--dry-run", action="store_true",
                    help="No ejecuta el pipeline — solo valida estructura de goldens")
    ap.add_argument("--output", type=Path, default=None,
                    help="Ruta del JSON de salida (default: evals/eval_v005.json)")
    return ap.parse_args()


if __name__ == "__main__":
    args = _parse_cli()
    report = run_eval(args.root, only=args.only, dry_run=args.dry_run)
    out = args.output or (args.root / "evals" / "eval_v005.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"→ {out}")
    # Resumen por terminal
    for r in report["results"]:
        passes = r["metrics"].get("passes_thresholds")
        icon = "✅" if passes else ("❌" if passes is False else "⚠️")
        logger.info(f"  {icon} {r['golden_id']} ({r['flow']}/{r['rigor']}): {r['metrics']}")

"""Phase 17.6 — Script de diagnóstico de presupuestos generados.

Lee Firestore (`budgets/{id}` + subcolección `chapters/{*}/items` + colección
`pipeline_telemetry/{id}/events`) y produce un report markdown completo:
metadata, inventario de partidas, partidas problemáticas con su reasoning
trace, telemetría del pipeline, patrones detectados.

Uso:
    cd services/ai-core
    ./venv/Scripts/python.exe scripts/diagnose_budget.py <budgetId>
    ./venv/Scripts/python.exe scripts/diagnose_budget.py <budgetId> --out path.md

Solo lee; no modifica nada en Firestore.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DIAGNOSTICS_DIR = ROOT / "diagnostics"

DEFAULT_BAKE_FACTOR = 1.25  # GG=10% + BI=15% Grupo RG (fallback si config falta)
DIVERGENCE_VISIBLE = 0.05   # 5% — corte para mostrar en sección "problemáticas"
DIVERGENCE_HIDDEN_DIM = 0.5  # 50% — heurística "dimensionamiento oculto sospechoso"
HIDDEN_DIM_UNITS = {"u", "ud", "uds", "pa"}


# ---------------------------------------------------------------------------
# Firebase Admin init (copia del patrón de compare_ai_vs_human_budget.py)
# ---------------------------------------------------------------------------
def _init_firebase() -> None:
    load_dotenv(ROOT / ".env")
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
    if not (project_id and client_email and private_key):
        raise SystemExit(
            "Faltan FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY en .env"
        )

    import firebase_admin
    from firebase_admin import credentials

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
    }
    try:
        firebase_admin.initialize_app(credentials.Certificate(info))
    except ValueError:
        pass  # ya inicializado


# ---------------------------------------------------------------------------
# Helpers de formato
# ---------------------------------------------------------------------------
def fmt_eur(n: float | None) -> str:
    if n is None:
        return "—"
    try:
        return f"{n:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return str(n)


def fmt_pct(n: float | None) -> str:
    if n is None:
        return "—"
    return f"{n * 100:.1f}%"


def safe_get(d: dict | None, *keys, default=None):
    """Acceso anidado seguro: safe_get(doc, 'a', 'b', 'c')."""
    if not isinstance(d, dict):
        return default
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


def truncate(s: str | None, n: int = 60) -> str:
    if not s:
        return ""
    s = str(s).replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------------------
# Lectura Firestore
# ---------------------------------------------------------------------------
def load_budget(db, budget_id: str) -> dict:
    ref = db.collection("budgets").document(budget_id)
    doc = ref.get()
    if not doc.exists:
        raise SystemExit(f"❌ Budget {budget_id} no existe en Firestore.")
    data = doc.to_dict() or {}

    chapters = []
    chapters_ref = ref.collection("chapters").order_by("order")
    for chap_doc in chapters_ref.stream():
        chap = chap_doc.to_dict() or {}
        chap["_doc_id"] = chap_doc.id
        chapters.append(chap)
    data["chapters"] = chapters
    return data


def load_telemetry(db, budget_id: str) -> list[dict]:
    """Carga eventos del pipeline. Degrada graciosamente si no existen."""
    try:
        events_ref = db.collection("pipeline_telemetry").document(budget_id).collection("events")
        events = []
        for ev_doc in events_ref.stream():
            ev = ev_doc.to_dict() or {}
            ev["_doc_id"] = ev_doc.id
            events.append(ev)
        return events
    except Exception as e:
        print(f"[telemetry] Error o ausente: {e}", file=sys.stderr)
        return []


# ---------------------------------------------------------------------------
# Análisis por partida
# ---------------------------------------------------------------------------
def analyze_partida(item: dict, bake_factor: float) -> dict:
    """Calcula divergencias y flags por partida."""
    quantity = float(item.get("quantity") or 0)
    unit_price = float(item.get("unitPrice") or 0)
    total_price = float(item.get("totalPrice") or 0)
    unit = item.get("unit") or ""
    breakdown = item.get("breakdown") or []

    sum_breakdown = sum(float(b.get("total") or 0) for b in breakdown)
    divergence = sum_breakdown - unit_price
    divergence_pct = abs(divergence) / unit_price if unit_price > 0 else 0.0

    raw_unit_price = (
        safe_get(item, "ai_resolution", "calculated_unit_price_raw")
        or safe_get(item, "aiResolution", "calculatedUnitPriceRaw")
    )
    if raw_unit_price is None and bake_factor > 0:
        raw_unit_price = unit_price / bake_factor

    needs_reconciliation = bool(item.get("needs_reconciliation"))
    persisted_div_pct = item.get("divergence_pct")
    persisted_div_amount = item.get("divergence_amount")

    match_kind = item.get("match_kind")
    unit_conversion = item.get("unit_conversion_applied")
    applied_fragments = item.get("applied_fragments") or []

    reasoning = (
        safe_get(item, "ai_resolution", "reasoning_trace")
        or safe_get(item, "aiResolution", "reasoning_trace")
        or safe_get(item, "aiResolution", "reasoningTrace")
        or item.get("reasoning")
        or ""
    )

    is_hidden_dim_suspect = (
        divergence_pct > DIVERGENCE_HIDDEN_DIM
        and unit.lower().strip() in HIDDEN_DIM_UNITS
        and not unit_conversion
    )

    return {
        "code": item.get("code") or "",
        "description": item.get("description") or item.get("originalTask") or "",
        "quantity": quantity,
        "unit": unit,
        "unitPrice": unit_price,
        "totalPrice": total_price,
        "rawUnitPrice": raw_unit_price,
        "breakdown": breakdown,
        "sumBreakdown": sum_breakdown,
        "divergence": divergence,
        "divergencePct": divergence_pct,
        "needsReconciliation": needs_reconciliation,
        "persistedDivPct": persisted_div_pct,
        "persistedDivAmount": persisted_div_amount,
        "matchKind": match_kind,
        "unitConversion": unit_conversion,
        "appliedFragments": applied_fragments,
        "reasoning": reasoning,
        "isHiddenDimSuspect": is_hidden_dim_suspect,
    }


# ---------------------------------------------------------------------------
# Render markdown
# ---------------------------------------------------------------------------
def render_section_metadata(budget: dict) -> str:
    config = budget.get("config") or {}
    cb = budget.get("costBreakdown") or {}
    chapters = budget.get("chapters") or []
    n_partidas = sum(len([i for i in (c.get("items") or []) if (i.get("type") or "PARTIDA") == "PARTIDA"]) for c in chapters)

    lines = [
        "## 1. Metadata",
        "",
        f"- budget id: `{budget.get('id')}`",
        f"- status: `{budget.get('status')}`",
        f"- calibrationVersion: `{budget.get('calibrationVersion')}`",
        f"- config: GG={config.get('marginGG')}%, BI={config.get('marginBI')}%, IVA={config.get('tax')}%",
        f"- chapters: **{len(chapters)}** / partidas: **{n_partidas}**",
        "",
        "**costBreakdown:**",
        f"- materialExecutionPrice (raw): {fmt_eur(cb.get('materialExecutionPrice'))}",
        f"- overheadExpenses (GG derivado): {fmt_eur(cb.get('overheadExpenses'))}",
        f"- industrialBenefit (BI derivado): {fmt_eur(cb.get('industrialBenefit'))}",
        f"- tax (IVA): {fmt_eur(cb.get('tax'))}",
        f"- total: {fmt_eur(cb.get('total'))}",
        "",
    ]
    return "\n".join(lines)


def render_section_inventory(partidas: list[dict]) -> str:
    lines = [
        "## 2. Inventario de partidas",
        "",
        "| Cap | Cód | Descripción | Qty | Unit | unit_price | sum_brk | div % | flags |",
        "|---|---|---|---:|---|---:|---:|---:|---|",
    ]
    for p in partidas:
        cap = (p.get("code") or "").split(".")[0] if "." in (p.get("code") or "") else "—"
        flags = []
        if p["needsReconciliation"]:
            flags.append("🔴 needs_reconciliation")
        if p["matchKind"]:
            flags.append(f"`{p['matchKind']}`")
        if p["unitConversion"]:
            flags.append("🔄 unit_conv")
        if p["isHiddenDimSuspect"]:
            flags.append("⚠️ dim_oculto")
        flags_str = " ".join(flags) if flags else ""
        div_str = fmt_pct(p["divergencePct"])
        if p["divergencePct"] >= DIVERGENCE_VISIBLE:
            div_str = f"**{div_str}**"
        lines.append(
            f"| {cap} | `{p['code']}` | {truncate(p['description'], 55)} | "
            f"{p['quantity']:.2f} | {p['unit']} | {fmt_eur(p['unitPrice'])} | "
            f"{fmt_eur(p['sumBreakdown'])} | {div_str} | {flags_str} |"
        )
    lines.append("")
    return "\n".join(lines)


def render_section_problematic(partidas: list[dict], bake_factor: float) -> str:
    # Replicar el skip del frontend `detectDivergence`: partidas sin breakdown
    # son alzadas legítimas (medios auxiliares, demoliciones, calibradas al suelo
    # Grupo RG sin descompuesto fiable). NO son "divergencias" — el Juez
    # decidió explícitamente no crear breakdown.
    problematic = [
        p for p in partidas
        if p["divergencePct"] >= DIVERGENCE_VISIBLE and p["breakdown"]
    ]
    skipped_lump_sum = [
        p for p in partidas
        if not p["breakdown"] and p["unitPrice"] > 0
    ]
    lines = [
        f"## 3. ⚠️ Partidas problemáticas (divergencia ≥ {fmt_pct(DIVERGENCE_VISIBLE)} y CON breakdown)",
        "",
    ]
    if skipped_lump_sum:
        lines.append(
            f"_Nota: **{len(skipped_lump_sum)}** partidas alzadas sin breakdown "
            "no se consideran problemáticas (el Juez decidió no crear descompuesto: "
            "medios auxiliares % PEM, calibraciones suelo Grupo RG, etc.). "
            "Listadas al final de esta sección._"
        )
        lines.append("")
    if not problematic:
        lines.append("_Ninguna partida con breakdown y divergencia significativa._")
        lines.append("")
    else:
        lines.append(f"Total: **{len(problematic)}** partidas con breakdown desajustado.")
        lines.append("")

    for p in problematic:
        lines.append(f"### {p['code']} — {truncate(p['description'], 80)}")
        lines.append("")
        lines.append("**Métricas:**")
        lines.append(f"- unit_price (baked): {fmt_eur(p['unitPrice'])} | (raw): {fmt_eur(p['rawUnitPrice'])}")
        lines.append(f"- sum_breakdown (baked): {fmt_eur(p['sumBreakdown'])} | "
                     f"(raw aprox): {fmt_eur(p['sumBreakdown'] / bake_factor if bake_factor > 0 else None)}")
        lines.append(f"- divergencia: {fmt_eur(p['divergence'])} ({fmt_pct(p['divergencePct'])})")
        if p["persistedDivPct"] is not None:
            lines.append(f"- persisted_divergence_pct: {fmt_pct(p['persistedDivPct'])} | "
                         f"persisted_divergence_amount: {fmt_eur(p['persistedDivAmount'])}")
        lines.append("")
        lines.append("**Flags:**")
        lines.append(f"- match_kind: `{p['matchKind']}`")
        lines.append(f"- needs_reconciliation: `{p['needsReconciliation']}`")
        if p["unitConversion"]:
            lines.append(f"- unit_conversion_applied: `{p['unitConversion']}`")
        else:
            lines.append("- unit_conversion_applied: ❌ NO declarado")
        if p["appliedFragments"]:
            frags = ", ".join(f"`{f}`" for f in p["appliedFragments"])
            lines.append(f"- applied_fragments: {frags}")
        if p["isHiddenDimSuspect"]:
            lines.append("- 🔴 **Sospecha**: dimensionamiento oculto (unit ∈ {u, ud, PA} + div > 50% + sin conversion)")
        lines.append("")

        if p["reasoning"]:
            lines.append("**Reasoning trace del Juez:**")
            lines.append("> " + p["reasoning"].replace("\n", "\n> "))
            lines.append("")

        if p["breakdown"]:
            lines.append("**Breakdown persistido:**")
            lines.append("")
            lines.append("| Cód | Descripción | Qty | Unit | Price | Total |")
            lines.append("|---|---|---:|---|---:|---:|")
            for b in p["breakdown"]:
                concept = b.get("concept") or b.get("description") or ""
                qty = float(b.get("quantity") or b.get("yield") or 1)
                unit = b.get("unit") or ""
                price = float(b.get("price") or b.get("unitPrice") or 0)
                total = float(b.get("total") or 0)
                lines.append(
                    f"| `{b.get('code') or '—'}` | {truncate(concept, 60)} | "
                    f"{qty:.3f} | {unit} | {fmt_eur(price)} | {fmt_eur(total)} |"
                )
            lines.append("")

        lines.append("---")
        lines.append("")

    # Sección de partidas alzadas (sin breakdown) — informativa
    if skipped_lump_sum:
        lines.append("### Partidas alzadas (sin breakdown) — informativo")
        lines.append("")
        lines.append("| Cód | Descripción | unit_price | Razón del Juez (resumen) |")
        lines.append("|---|---|---:|---|")
        for p in skipped_lump_sum:
            reason = truncate(p["reasoning"], 120) or "—"
            lines.append(
                f"| `{p['code']}` | {truncate(p['description'], 50)} | "
                f"{fmt_eur(p['unitPrice'])} | {reason} |"
            )
        lines.append("")

    return "\n".join(lines)


def render_section_telemetry(events: list[dict]) -> str:
    lines = [
        "## 4. Telemetría del pipeline",
        "",
    ]
    if not events:
        lines.append("_No se encontraron eventos en `pipeline_telemetry/{id}/events` (budget pre-SSE o telemetría desactivada)._")
        lines.append("")
        return "\n".join(lines)

    lines.append(f"Total eventos: **{len(events)}**")
    lines.append("")

    counter: Counter = Counter()
    by_type: dict[str, list[dict]] = defaultdict(list)
    for ev in events:
        et = ev.get("event_type") or ev.get("type") or ev.get("eventType") or "unknown"
        counter[et] += 1
        by_type[et].append(ev)

    lines.append("**Conteo por tipo:**")
    lines.append("")
    lines.append("| Tipo | Conteo |")
    lines.append("|---|---:|")
    for et, n in counter.most_common():
        lines.append(f"| `{et}` | {n} |")
    lines.append("")

    # Detalle eventos críticos
    critical = ["breakdown_sum_divergence", "breakdown_scaled_defensive", "partida_needs_reconciliation", "partida_price_anomaly"]
    for et in critical:
        if et not in by_type:
            continue
        lines.append(f"**Detalle `{et}`** ({counter[et]}):")
        lines.append("")
        # Render rows (todos los campos relevantes excepto _doc_id)
        sample = by_type[et][:1]
        if sample:
            keys = [k for k in sample[0].keys() if k not in ("_doc_id",)]
            # cabecera
            lines.append("| " + " | ".join(keys) + " |")
            lines.append("|" + "|".join("---" for _ in keys) + "|")
            for ev in by_type[et]:
                row = []
                for k in keys:
                    v = ev.get(k)
                    if isinstance(v, dict):
                        v = "{...}"
                    elif isinstance(v, str) and len(v) > 80:
                        v = v[:77] + "…"
                    row.append(str(v))
                lines.append("| " + " | ".join(row) + " |")
            lines.append("")

    return "\n".join(lines)


def render_section_patterns(partidas: list[dict]) -> str:
    lines = ["## 5. Patrones detectados", ""]

    n_total = len(partidas)
    # Solo cuentan como divergencia las que tienen breakdown (las alzadas sin breakdown son legítimas).
    n_div_real = sum(1 for p in partidas if p["divergencePct"] >= DIVERGENCE_VISIBLE and p["breakdown"])
    n_hidden_dim = sum(1 for p in partidas if p["isHiddenDimSuspect"] and p["breakdown"])
    n_no_breakdown = sum(1 for p in partidas if not p["breakdown"])
    n_needs_reconciliation = sum(1 for p in partidas if p["needsReconciliation"])
    n_unit_conv = sum(1 for p in partidas if p["unitConversion"])
    n_match_kind_set = sum(1 for p in partidas if p["matchKind"])

    unit_counter: Counter = Counter(p["unit"].lower() for p in partidas)
    match_counter: Counter = Counter(p["matchKind"] or "—" for p in partidas)
    unit_problematic: Counter = Counter(p["unit"].lower() for p in partidas if p["divergencePct"] >= DIVERGENCE_VISIBLE)

    lines.append(f"- **Partidas con breakdown desajustado** (div ≥ {fmt_pct(DIVERGENCE_VISIBLE)}, CON breakdown): {n_div_real}/{n_total}")
    lines.append(f"- **Partidas alzadas sin breakdown** (legítimas): {n_no_breakdown}/{n_total}")
    lines.append(f"- **Partidas con sospecha de dimensionamiento oculto**: {n_hidden_dim}")
    lines.append(f"- **Partidas con `needs_reconciliation: true`** (Phase 17 flag): {n_needs_reconciliation}")
    lines.append(f"- **Partidas con `match_kind` declarado**: {n_match_kind_set}/{n_total}")
    lines.append(f"- **Partidas con `unit_conversion_applied` declarado**: {n_unit_conv}/{n_total}")
    lines.append("")
    lines.append("**Distribución por unit:**")
    lines.append("")
    lines.append("| unit | total | con divergencia |")
    lines.append("|---|---:|---:|")
    for u, n in unit_counter.most_common():
        lines.append(f"| `{u or '—'}` | {n} | {unit_problematic.get(u, 0)} |")
    lines.append("")
    lines.append("**Distribución por match_kind:**")
    lines.append("")
    lines.append("| match_kind | count |")
    lines.append("|---|---:|")
    for mk, n in match_counter.most_common():
        lines.append(f"| `{mk}` | {n} |")
    lines.append("")

    return "\n".join(lines)


def render_section_recommendations(partidas: list[dict], events: list[dict]) -> str:
    n_hidden_dim = sum(1 for p in partidas if p["isHiddenDimSuspect"])
    n_needs_recon = sum(1 for p in partidas if p["needsReconciliation"])
    n_phase11_fired = sum(1 for ev in events if (ev.get("event_type") or ev.get("type")) == "breakdown_scaled_defensive")
    n_div_warning = sum(1 for ev in events if (ev.get("event_type") or ev.get("type")) == "breakdown_sum_divergence")

    lines = [
        "## 6. Recomendaciones (informativo)",
        "",
        "Hallazgos automatizados (a usar como input para Phase 17.7):",
        "",
    ]
    if n_hidden_dim > 0:
        lines.append(f"- 🔴 **{n_hidden_dim} partida(s)** sospechosas de dimensionamiento oculto. El agente NO declaró `unit_conversion_applied`.")
        lines.append("  - Acción: refuerzo del system prompt del Juez (Phase 17.7) para exigir la declaración.")
        lines.append(f"  - Acción: `reconcile_breakdown` debería escalar `quantity` (no `price`) cuando divergencia > {fmt_pct(DIVERGENCE_HIDDEN_DIM)}.")
    if n_phase11_fired == 0 and n_div_warning > 0:
        lines.append(f"- ⚠️ Guard #1 (Phase 11.A) NO se activó en ningún caso. {n_div_warning} eventos `breakdown_sum_divergence` quedaron como warnings sin escalar.")
    if n_needs_recon > 0:
        lines.append(f"- ⚠️ {n_needs_recon} partida(s) con `needs_reconciliation: true`. UI debe surfaceear el chip y bloquear PDF si no se reconcilian.")
    if n_hidden_dim == 0 and n_needs_recon == 0:
        lines.append("- ✓ Sin patrones críticos detectados en este budget.")
    lines.append("")
    return "\n".join(lines)


def render_report(budget: dict, partidas: list[dict], events: list[dict], bake_factor: float) -> str:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    header = [
        f"# Diagnóstico Budget `{budget.get('id')}`",
        "",
        f"_Generado: {ts}_",
        "",
    ]
    sections = [
        render_section_metadata(budget),
        render_section_inventory(partidas),
        render_section_problematic(partidas, bake_factor),
        render_section_telemetry(events),
        render_section_patterns(partidas),
        render_section_recommendations(partidas, events),
    ]
    return "\n".join(header) + "\n".join(sections)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnóstico de un budget generado por la IA (lectura Firestore).")
    parser.add_argument("budget_id", help="ID del budget en la colección `budgets`.")
    parser.add_argument("--out", help="Path del archivo markdown de salida. Por defecto: services/ai-core/diagnostics/budget_{id8}_{ts}.md")
    args = parser.parse_args()

    _init_firebase()
    from firebase_admin import firestore
    db = firestore.client()

    print(f"[diagnose] Loading budget {args.budget_id}…", file=sys.stderr)
    budget = load_budget(db, args.budget_id)
    budget["id"] = args.budget_id

    print(f"[diagnose] Loading pipeline_telemetry events…", file=sys.stderr)
    events = load_telemetry(db, args.budget_id)

    config = budget.get("config") or {}
    gg = float(config.get("marginGG") or 10)
    bi = float(config.get("marginBI") or 15)
    bake_factor = 1 + (gg + bi) / 100
    print(f"[diagnose] Computed bake_factor = {bake_factor:.4f}", file=sys.stderr)

    partidas: list[dict] = []
    for chapter in budget.get("chapters") or []:
        for item in chapter.get("items") or []:
            if (item.get("type") or "PARTIDA") != "PARTIDA":
                continue
            partidas.append(analyze_partida(item, bake_factor))

    print(f"[diagnose] {len(partidas)} partidas analyzed.", file=sys.stderr)

    report_md = render_report(budget, partidas, events, bake_factor)

    if args.out:
        out_path = Path(args.out)
    else:
        DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)
        ts_compact = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = DIAGNOSTICS_DIR / f"budget_{args.budget_id[:8]}_{ts_compact}.md"

    out_path.write_text(report_md, encoding="utf-8")
    # Forzar UTF-8 en stdout (Windows cp1252 default rompe con cualquier emoji o tilde).
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    print(f"\n[OK] Report written to: {out_path}")
    print(f"  ({len(report_md)} chars, {len(partidas)} partidas, {len(events)} events)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

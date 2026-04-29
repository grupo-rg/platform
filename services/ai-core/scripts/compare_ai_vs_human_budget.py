"""Comparativa AI vs Humano de un mismo presupuesto.

Lee:
  1. Un budget generado por la IA desde Firestore (por id).
  2. Un PDF de presupuesto firmado por aparejador humano.

Produce un Markdown con análisis side-by-side: counts, PEM total, breakdown
por capítulo, match por código, deltas de precio, partidas faltantes/extra.

Uso:
    venv/Scripts/python.exe scripts/compare_ai_vs_human_budget.py \\
        --budget-id f1e81e46-45d7-4262-b572-f653ebb848b2 \\
        --human-pdf "C:/Users/Usuario/Documents/Grupo RG/.../presupuesto_human_27_04_2026.pdf" \\
        --output evals/comparisons/budget_f1e81e46_vs_human_27042026.md

Formato de PDF humano soportado: MONQUADRAT (Frontis Mallorca). Cabecera de
capítulo `CAPÍTULO {NN} {NOMBRE} {total}€`. Línea partida:
`{NN.MM} {unit} {título} {priceUd},{cc}€ {qty} {unit_label} {subtotal}€`.
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pdfplumber
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# -------- Domain --------------------------------------------------------------


@dataclass
class Partida:
    code: str
    chapter_code: str
    chapter_name: str
    unit: str
    description: str
    quantity: float
    unit_price: float
    total_price: float

    @property
    def short_desc(self) -> str:
        s = self.description.strip()
        return (s[:80] + "…") if len(s) > 80 else s


@dataclass
class BudgetSnapshot:
    label: str
    partidas: List[Partida] = field(default_factory=list)
    pem_total: float = 0.0
    chapters_pem: Dict[str, float] = field(default_factory=dict)
    # Phase 15 — campos dual-level: distinguir raw PEM (suma partidas) vs
    # Base Imponible (con GG+BI distribuidos) vs Total (con IVA).
    overhead_expenses: float = 0.0  # GG € (AI from costBreakdown; humano = 0)
    industrial_benefit: float = 0.0  # BI € (AI from costBreakdown; humano = 0)
    iva_amount: float = 0.0  # IVA € (AI from costBreakdown; humano declarado en PDF)
    calibration_version: Optional[str] = None  # 'phase14' | 'phase15' | None
    margin_gg_pct: float = 0.0
    margin_bi_pct: float = 0.0
    iva_pct: float = 0.0

    @property
    def base_imponible(self) -> float:
        """Para AI Phase 15: pem (raw) + GG + BI. Para humano: pem (= sum partidas all-in)."""
        return self.pem_total + self.overhead_expenses + self.industrial_benefit

    @property
    def total_with_iva(self) -> float:
        return self.base_imponible + self.iva_amount


@dataclass
class Match:
    code: str
    human: Optional[Partida]
    ai: Optional[Partida]
    score: float = 0.0  # similitud descripción (0..1)
    method: str = "missing"  # exact_code | normalized_code | fuzzy_description | missing


# -------- 1. Load AI budget desde Firestore -----------------------------------


def _init_firebase() -> None:
    load_dotenv(ROOT / ".env")
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
    if not (project_id and client_email and private_key):
        raise SystemExit("Faltan FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY en .env")

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


def _normalize_code(code: str) -> str:
    """Normaliza código: 'C04.02' → 'C04.02', '4.2' → '04.02', etc."""
    raw = (code or "").strip().upper()
    # Si tiene formato N.M, padding del primer segmento a 2 dígitos.
    m = re.match(r"^(?:C)?(\d+)\.(\d+)(?:\.(\d+))?$", raw)
    if m:
        c1 = m.group(1).zfill(2)
        c2 = m.group(2).zfill(2)
        if m.group(3):
            return f"{c1}.{c2}.{m.group(3).zfill(2)}"
        return f"{c1}.{c2}"
    return raw


def _chapter_prefix_from_code(code: str) -> str:
    """01.02 → 01,  C04.05 → C04."""
    raw = (code or "").strip().upper()
    if "." in raw:
        return raw.split(".")[0]
    return raw


def load_ai_budget(budget_id: str) -> BudgetSnapshot:
    _init_firebase()
    from firebase_admin import firestore
    db = firestore.client()
    ref = db.collection("budgets").document(budget_id)
    doc = ref.get()
    if not doc.exists:
        raise SystemExit(f"Budget {budget_id} no existe en Firestore")
    data = doc.to_dict() or {}

    snap = BudgetSnapshot(label=f"AI ({budget_id[:8]})")
    cost = data.get("costBreakdown") or {}
    declared_pem = float(cost.get("materialExecutionPrice") or 0.0)
    # Phase 15 — capturar GG/BI/IVA persistidos para análisis dual-level.
    snap.overhead_expenses = float(cost.get("overheadExpenses") or 0.0)
    snap.industrial_benefit = float(cost.get("industrialBenefit") or 0.0)
    snap.iva_amount = float(cost.get("tax") or 0.0)
    snap.calibration_version = data.get("calibrationVersion")
    cfg = data.get("config") or {}
    snap.margin_gg_pct = float(cfg.get("marginGG") or 0.0)
    snap.margin_bi_pct = float(cfg.get("marginBI") or 0.0)
    snap.iva_pct = float(cfg.get("tax") or 0.0)

    # Los chapters viven en una subcollection `chapters`. Cada chapter doc
    # tiene `items: List[BudgetLineItem]` embebidos.
    for ch_doc in ref.collection("chapters").order_by("order").stream():
        ch_data = ch_doc.to_dict() or {}
        ch_name = ch_data.get("name") or f"Sin Capítulo ({ch_doc.id})"
        ch_total = float(ch_data.get("totalPrice") or 0.0)
        snap.chapters_pem[ch_name] = ch_total

        for it in ch_data.get("items", []) or []:
            if it.get("type") != "PARTIDA":
                continue
            code = it.get("code") or ""
            partida = Partida(
                code=_normalize_code(code),
                chapter_code=_chapter_prefix_from_code(code),
                chapter_name=ch_name,
                unit=it.get("unit") or "",
                description=it.get("description") or "",
                quantity=float(it.get("quantity") or 0.0),
                unit_price=float(it.get("unitPrice") or 0.0),
                total_price=float(it.get("totalPrice") or 0.0),
            )
            snap.partidas.append(partida)
            snap.pem_total += partida.total_price

    logger.info(
        f"AI budget cargado: {len(snap.partidas)} partidas, "
        f"PEM calculado {snap.pem_total:.2f} € "
        f"(declarado en costBreakdown: {declared_pem:.2f} €)"
    )
    return snap


# -------- 2. Parse human PDF (formato MONQUADRAT) ------------------------------


_PRICE_RE = r"([\d.]+,[\d]+|\d+(?:\.\d+)?)"
# Línea de chapter: "CAPÍTULO 01 DEFICIENCIAS IEE HENRI DUNANT 51.697,50€"
_CHAPTER_RE = re.compile(
    r"CAP[IÍ]TULO\s+(?P<num>\d+)\s+(?P<name>.+?)\s+(?P<total>" + _PRICE_RE + r")\s*€",
    re.IGNORECASE,
)
# Línea de partida: "01.01 m Reparación de pilares 235,00€ 25,2 Metros 5.922,00€"
_PARTIDA_RE = re.compile(
    r"^(?P<code>\d+\.\d+)\s+"
    r"(?P<unit>m2|m3|ml|m|u|ud|kg|h|t|pa)\s+"
    r"(?P<title>.+?)\s+"
    r"(?P<unitprice>" + _PRICE_RE + r")\s*€\s+"
    r"(?P<qty>" + _PRICE_RE + r")\s+"
    r"(?P<unitlabel>\w+)\s+"
    r"(?P<subtotal>" + _PRICE_RE + r")\s*€\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _to_float_es(s: str) -> float:
    """'1.234,56' → 1234.56 ; '5.922,00' → 5922.0 ; '25,2' → 25.2 ; '100' → 100."""
    if not s:
        return 0.0
    raw = s.strip()
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    return float(raw)


def parse_human_pdf(pdf_path: Path) -> BudgetSnapshot:
    snap = BudgetSnapshot(label=f"Humano ({pdf_path.name})")

    # Concatenamos todo el texto del PDF — los regex multiline se aplican global.
    full_text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            full_text += "\n" + (page.extract_text() or "")

    # Capítulos
    chapters_by_num: Dict[str, str] = {}  # "01" → "DEFICIENCIAS IEE HENRI DUNANT"
    for m in _CHAPTER_RE.finditer(full_text):
        ch_num = m.group("num").zfill(2)
        ch_name = re.sub(r"\s+", " ", m.group("name").strip())
        chapters_by_num[ch_num] = f"{ch_num} {ch_name}"
        snap.chapters_pem[chapters_by_num[ch_num]] = _to_float_es(m.group("total"))

    # Partidas
    for m in _PARTIDA_RE.finditer(full_text):
        code_raw = m.group("code")
        ch_num = code_raw.split(".")[0].zfill(2)
        partida = Partida(
            code=_normalize_code(code_raw),
            chapter_code=ch_num,
            chapter_name=chapters_by_num.get(ch_num, f"{ch_num} (sin nombre)"),
            unit=m.group("unit").lower(),
            description=re.sub(r"\s+", " ", m.group("title").strip()),
            quantity=_to_float_es(m.group("qty")),
            unit_price=_to_float_es(m.group("unitprice")),
            total_price=_to_float_es(m.group("subtotal")),
        )
        snap.partidas.append(partida)
        snap.pem_total += partida.total_price

    logger.info(f"PDF humano parseado: {len(snap.partidas)} partidas, PEM declarado {snap.pem_total:.2f} €")
    return snap


# -------- 3. Match + comparison -----------------------------------------------


def _fuzzy(a: str, b: str) -> float:
    return SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


def match_partidas(human: List[Partida], ai: List[Partida]) -> List[Match]:
    """Pairing por código exacto → fuzzy descripción ≥ 0.55. Sin match → entries
    `missing` por separado para humano/ai."""
    matches: List[Match] = []
    used_ai_codes: set = set()
    used_ai_idx: set = set()

    # 1. Match por código exacto normalizado.
    ai_by_code: Dict[str, int] = {}
    for i, p in enumerate(ai):
        ai_by_code[p.code] = i

    for h in human:
        if h.code in ai_by_code:
            idx = ai_by_code[h.code]
            ai_p = ai[idx]
            score = _fuzzy(h.description, ai_p.description)
            matches.append(Match(code=h.code, human=h, ai=ai_p, score=score, method="exact_code"))
            used_ai_codes.add(h.code)
            used_ai_idx.add(idx)

    # 2. Por humano sin match → fuzzy en partidas AI sobrantes.
    for h in human:
        if h.code in used_ai_codes:
            continue
        best_i = None
        best_score = 0.0
        for i, p in enumerate(ai):
            if i in used_ai_idx:
                continue
            s = _fuzzy(h.description, p.description)
            if s > best_score:
                best_score = s
                best_i = i
        if best_i is not None and best_score >= 0.55:
            matches.append(Match(code=h.code, human=h, ai=ai[best_i], score=best_score, method="fuzzy_description"))
            used_ai_idx.add(best_i)
        else:
            matches.append(Match(code=h.code, human=h, ai=None, score=0.0, method="missing_in_ai"))

    # 3. AI sin match (alucinaciones / extra).
    for i, p in enumerate(ai):
        if i not in used_ai_idx:
            matches.append(Match(code=p.code, human=None, ai=p, score=0.0, method="extra_in_ai"))

    return matches


# -------- 4. Markdown report --------------------------------------------------


def _fmt_eur(value: float) -> str:
    return f"{value:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def _delta_pct(a: float, b: float) -> str:
    """% delta entre b (AI) y a (humano), positivo si AI > humano."""
    if a == 0:
        return "—"
    pct = (b - a) / a * 100
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct:.1f}%"


def render_markdown(human: BudgetSnapshot, ai: BudgetSnapshot, matches: List[Match]) -> str:
    lines: List[str] = []
    lines.append(f"# Comparativa AI vs Humano — {human.label} vs {ai.label}")
    lines.append("")
    lines.append(f"_Generado: {__import__('datetime').datetime.now().isoformat(timespec='seconds')}_")
    lines.append("")

    # Resumen ejecutivo
    lines.append("## Resumen ejecutivo")
    lines.append("")
    lines.append("| Métrica | Aparejador (humano) | AI | Delta |")
    lines.append("|---|---:|---:|---:|")
    lines.append(f"| Partidas | {len(human.partidas)} | {len(ai.partidas)} | {len(ai.partidas) - len(human.partidas):+d} |")
    lines.append(f"| Capítulos | {len(human.chapters_pem)} | {len(ai.chapters_pem)} | {len(ai.chapters_pem) - len(human.chapters_pem):+d} |")
    lines.append(f"| PEM total | {_fmt_eur(human.pem_total)} | {_fmt_eur(ai.pem_total)} | {_delta_pct(human.pem_total, ai.pem_total)} |")
    lines.append("")

    # Phase 15 — comparativa dual-level (raw PEM vs Base Imponible vs Total con IVA).
    # Solo si el AI budget lleva calibrationVersion='phase15' (sino, ai.pem_total ya es all-in).
    lines.append("### Comparativa dual-level (Phase 15)")
    lines.append("")
    if ai.calibration_version == "phase15":
        markup_factor = 1.0 + (ai.margin_gg_pct + ai.margin_bi_pct) / 100.0
        human_implied_raw = human.pem_total / markup_factor if markup_factor > 0 else human.pem_total
        lines.append(f"AI calibrationVersion: **phase15** · markup factor configurado: ×{markup_factor:.3f} (GG {ai.margin_gg_pct}% + BI {ai.margin_bi_pct}%)")
        lines.append("")
        lines.append("| Nivel | Humano | AI | Delta |")
        lines.append("|---|---:|---:|---:|")
        lines.append(f"| Raw PEM (sum partidas raw) | {_fmt_eur(human_implied_raw)} (=Base/{markup_factor:.2f}) | {_fmt_eur(ai.pem_total)} | {_delta_pct(human_implied_raw, ai.pem_total)} |")
        lines.append(f"| Base Imponible (raw × markup) | {_fmt_eur(human.pem_total)} | {_fmt_eur(ai.base_imponible)} | {_delta_pct(human.pem_total, ai.base_imponible)} |")
        lines.append(f"| Total con IVA | {_fmt_eur(human.pem_total + human.iva_amount)} (declarado) | {_fmt_eur(ai.total_with_iva)} | {_delta_pct(human.pem_total + human.iva_amount, ai.total_with_iva)} |")
    else:
        lines.append(f"AI calibrationVersion: **{ai.calibration_version or 'undefined (legacy phase14)'}** · partidas almacenan all-in (markup baked-in por calibración).")
        lines.append("")
        lines.append("La comparativa per-partida arriba refleja todo el delta. No se aplica desglose dual.")
    lines.append("")

    # Match summary
    by_method = {"exact_code": 0, "fuzzy_description": 0, "missing_in_ai": 0, "extra_in_ai": 0}
    for m in matches:
        by_method[m.method] = by_method.get(m.method, 0) + 1
    lines.append("### Calidad del matching")
    lines.append("")
    lines.append("| Tipo | Count |")
    lines.append("|---|---:|")
    lines.append(f"| Match exacto por código | {by_method['exact_code']} |")
    lines.append(f"| Match fuzzy (descripción ≥ 0.55) | {by_method['fuzzy_description']} |")
    lines.append(f"| **Faltan en AI** (humano tiene, AI no) | **{by_method['missing_in_ai']}** |")
    lines.append(f"| **Extra en AI** (AI tiene, humano no) | **{by_method['extra_in_ai']}** |")
    lines.append("")

    # Por capítulo
    lines.append("## Comparativa por capítulo")
    lines.append("")
    lines.append("| Capítulo (humano) | PEM humano | PEM AI (mismo prefix) | Delta |")
    lines.append("|---|---:|---:|---:|")
    # Para cada capítulo humano, sumamos partidas AI con mismo prefix.
    ai_pem_by_prefix: Dict[str, float] = {}
    for p in ai.partidas:
        ai_pem_by_prefix[p.chapter_code] = ai_pem_by_prefix.get(p.chapter_code, 0.0) + p.total_price
    for ch_full, ch_pem in human.chapters_pem.items():
        ch_prefix = ch_full.split(" ")[0]
        ai_pem = ai_pem_by_prefix.get(ch_prefix, 0.0)
        lines.append(f"| {ch_full} | {_fmt_eur(ch_pem)} | {_fmt_eur(ai_pem)} | {_delta_pct(ch_pem, ai_pem)} |")
    lines.append("")

    # Detalle por partida (matched)
    matched = [m for m in matches if m.human and m.ai]
    matched.sort(key=lambda m: (m.human.chapter_code, m.human.code))
    lines.append("## Detalle por partida (matched)")
    lines.append("")
    lines.append("| Cód | Match | Score | Descripción humano | €/u humano | Cant | Total humano | €/u AI | Total AI | Δ Total |")
    lines.append("|---|---|---:|---|---:|---:|---:|---:|---:|---:|")
    for m in matched:
        h = m.human
        a = m.ai
        lines.append(
            f"| {h.code} | {m.method.replace('_', ' ')} | {m.score:.2f} | {h.short_desc} | "
            f"{_fmt_eur(h.unit_price)} | {h.quantity} | {_fmt_eur(h.total_price)} | "
            f"{_fmt_eur(a.unit_price)} | {_fmt_eur(a.total_price)} | {_delta_pct(h.total_price, a.total_price)} |"
        )
    lines.append("")

    # Faltantes
    missing = [m for m in matches if m.method == "missing_in_ai"]
    if missing:
        lines.append("## Partidas en humano que el AI no extrajo / no priceó")
        lines.append("")
        lines.append("| Cód | Descripción | €/u | Total |")
        lines.append("|---|---|---:|---:|")
        for m in missing:
            h = m.human
            lines.append(f"| {h.code} | {h.short_desc} | {_fmt_eur(h.unit_price)} | {_fmt_eur(h.total_price)} |")
        lines.append("")

    # Extra
    extra = [m for m in matches if m.method == "extra_in_ai"]
    if extra:
        lines.append("## Partidas que el AI generó y no aparecen en humano (alucinaciones)")
        lines.append("")
        lines.append("| Cód | Descripción | €/u AI | Total AI |")
        lines.append("|---|---|---:|---:|")
        for m in extra:
            a = m.ai
            lines.append(f"| {a.code} | {a.short_desc} | {_fmt_eur(a.unit_price)} | {_fmt_eur(a.total_price)} |")
        lines.append("")

    return "\n".join(lines)


# -------- CLI ----------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Compara budget AI vs PDF humano.")
    parser.add_argument("--budget-id", required=True, help="ID del budget en Firestore")
    parser.add_argument("--human-pdf", required=True, type=Path, help="Ruta al PDF humano")
    parser.add_argument("--output", required=True, type=Path, help="Markdown destino")
    args = parser.parse_args()

    if not args.human_pdf.exists():
        logger.error(f"No existe: {args.human_pdf}")
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)

    logger.info("Cargando budget AI desde Firestore…")
    ai_snap = load_ai_budget(args.budget_id)
    logger.info("Parseando PDF humano…")
    human_snap = parse_human_pdf(args.human_pdf)

    logger.info("Matching y comparativa…")
    matches = match_partidas(human_snap.partidas, ai_snap.partidas)

    md = render_markdown(human_snap, ai_snap, matches)
    args.output.write_text(md, encoding="utf-8")
    logger.info(f"✅ Reporte: {args.output}")

    # Resumen consola
    logger.info(
        f"Resumen: humano {len(human_snap.partidas)} partidas / {human_snap.pem_total:.2f} €  "
        f"vs AI {len(ai_snap.partidas)} partidas / {ai_snap.pem_total:.2f} €"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

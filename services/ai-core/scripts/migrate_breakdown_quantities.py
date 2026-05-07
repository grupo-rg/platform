"""Phase 17.8 — Migración: normaliza yield_amount en breakdowns persistidos.

Para cada budget en Firestore (filtrable por calibrationVersion=phase17-markup-baked
o un budget concreto):
  - Lee chapters → items → breakdown.
  - Para cada componente con total > 0 y price > 0:
    - Si `yield`/`yield_amount` está ausente o no satisface qty × price ≈ total
      (tolerancia 1%), deriva yield = total / price y persiste.
  - Update via batch Firestore.
  - Logging detallado: budget_id, partida_code, n_componentes_fixed.

PRE-REQUISITO ANTES DE --commit:
    gcloud firestore export gs://<bucket>/firestore-backups/budgets-pre-17.8-<ts> \\
        --collection-ids=budgets

Uso:
    # Dry-run global (NO escribe nada).
    python scripts/migrate_breakdown_quantities.py

    # Dry-run un solo budget.
    python scripts/migrate_breakdown_quantities.py --budget-id 50280d27-...

    # COMMIT (irreversible sin backup).
    python scripts/migrate_breakdown_quantities.py --commit
    python scripts/migrate_breakdown_quantities.py --commit --budget-id 50280d27-...

Idempotente: re-correr sobre datos ya normalizados es no-op.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


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
        pass


def _normalize_component(b: dict, tolerance: float = 0.01) -> bool:
    """Aplica la misma lógica de normalize_breakdown_quantities a un dict de Firestore.

    Retorna True si modificó el componente. Mutate in place.
    """
    price = float(b.get("price") or 0)
    total = float(b.get("total") or 0)
    if price <= 0 or total <= 0:
        return False

    # Lectura defensiva: yield_amount es el campo Pydantic, pero el alias 'yield'
    # puede aparecer en serializaciones LLM. Firestore puede tener cualquiera.
    qty_decl = 0.0
    for key in ("yield_amount", "yield_val", "yield", "quantity"):
        v = b.get(key)
        if v is not None:
            try:
                qty_decl = float(v)
                if qty_decl > 0:
                    break
            except (TypeError, ValueError):
                continue

    qty_implied = total / price
    if qty_decl > 0 and abs(qty_implied - qty_decl) / max(qty_implied, 1e-9) <= tolerance:
        return False  # ya cuadra

    b["yield_amount"] = round(qty_implied, 4)
    return True


def process_chapter(chapter: dict, budget_id: str, dry_run: bool) -> dict:
    """Recorre los items de un chapter y normaliza cada breakdown. Retorna stats."""
    stats = {"partidas_visited": 0, "partidas_modified": 0, "components_fixed": 0}
    items = chapter.get("items") or []
    for item in items:
        if (item.get("type") or "PARTIDA") != "PARTIDA":
            continue
        stats["partidas_visited"] += 1
        breakdown = item.get("breakdown")
        if not breakdown:
            continue
        modified_in_partida = 0
        for b in breakdown:
            if _normalize_component(b):
                modified_in_partida += 1
        if modified_in_partida > 0:
            stats["partidas_modified"] += 1
            stats["components_fixed"] += modified_in_partida
            print(
                f"  [{budget_id[:8]}] {item.get('code') or '?'}: "
                f"{modified_in_partida} componente(s) normalizado(s)"
                + (" [DRY-RUN]" if dry_run else "")
            )
    return stats


def migrate_one_budget(db, budget_id: str, dry_run: bool = True) -> dict:
    """Lee un budget completo, normaliza los breakdowns, persiste si !dry_run."""
    ref = db.collection("budgets").document(budget_id)
    doc = ref.get()
    if not doc.exists:
        print(f"[skip] Budget {budget_id} no existe.")
        return {"partidas_visited": 0, "partidas_modified": 0, "components_fixed": 0}

    data = doc.to_dict() or {}
    cal_version = data.get("calibrationVersion")
    if cal_version != "phase17-markup-baked":
        print(f"[skip] Budget {budget_id[:8]} con calibrationVersion={cal_version!r} (no phase17).")
        return {"partidas_visited": 0, "partidas_modified": 0, "components_fixed": 0}

    print(f"[budget] {budget_id} (calibrationVersion={cal_version})")

    chapters_ref = ref.collection("chapters")
    total_stats = {"partidas_visited": 0, "partidas_modified": 0, "components_fixed": 0}
    chapters_to_save: list[tuple[str, dict]] = []

    for chap_doc in chapters_ref.stream():
        chap = chap_doc.to_dict() or {}
        before_modified = total_stats["partidas_modified"]
        s = process_chapter(chap, budget_id, dry_run)
        for k in total_stats:
            total_stats[k] += s[k]
        # Solo guardar el chapter si tuvo modificaciones
        if total_stats["partidas_modified"] > before_modified:
            chapters_to_save.append((chap_doc.id, chap))

    if not dry_run and chapters_to_save:
        from firebase_admin import firestore
        batch = db.batch()
        for chap_id, chap in chapters_to_save:
            chap_ref = ref.collection("chapters").document(chap_id)
            batch.set(chap_ref, chap)
        batch.commit()
        print(f"  [commit] {len(chapters_to_save)} chapter(s) actualizado(s) en Firestore.")

    return total_stats


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Phase 17.8 — Migra yield_amount coherente en breakdowns persistidos."
    )
    parser.add_argument(
        "--budget-id",
        help="Migrar un solo budget. Si se omite, migra todos los budgets phase17.",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Si se omite, dry-run (NO escribe). PRE-REQUISITO: backup gcloud firestore export.",
    )
    args = parser.parse_args()

    dry_run = not args.commit
    if dry_run:
        print("=== DRY-RUN (no escribe en Firestore). Para commit usar --commit. ===\n")
    else:
        print("=== COMMIT MODE — escribirá en Firestore ===")
        print("ASEGÚRATE de tener backup: gcloud firestore export ...\n")

    _init_firebase()
    from firebase_admin import firestore
    db = firestore.client()

    grand_total = {"partidas_visited": 0, "partidas_modified": 0, "components_fixed": 0}
    n_budgets = 0

    if args.budget_id:
        s = migrate_one_budget(db, args.budget_id, dry_run=dry_run)
        for k in grand_total:
            grand_total[k] += s[k]
        n_budgets = 1
    else:
        budgets_ref = db.collection("budgets").where("calibrationVersion", "==", "phase17-markup-baked")
        for bdoc in budgets_ref.stream():
            n_budgets += 1
            s = migrate_one_budget(db, bdoc.id, dry_run=dry_run)
            for k in grand_total:
                grand_total[k] += s[k]

    print()
    print("=== RESUMEN ===")
    print(f"  Budgets procesados: {n_budgets}")
    print(f"  Partidas visitadas: {grand_total['partidas_visited']}")
    print(f"  Partidas modificadas: {grand_total['partidas_modified']}")
    print(f"  Componentes normalizados: {grand_total['components_fixed']}")
    if dry_run:
        print("\n  [DRY-RUN] Ningún cambio escrito. Re-ejecutar con --commit para aplicar.")
    return 0


if __name__ == "__main__":
    # Forzar UTF-8 stdout (Windows cp1252 default).
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    sys.exit(main())

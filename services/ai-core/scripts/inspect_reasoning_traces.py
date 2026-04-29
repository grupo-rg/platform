"""One-off — dump cognitive traces for outlier partidas of multiple budgets.

Reads `ai_resolution.reasoning_trace`, `ai_resolution.selected_candidate`,
`match_kind`, `unit_conversion_applied`, `applied_fragments` and `breakdown`
for each partida code listed.

Usage:
  python scripts/inspect_reasoning_traces.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
import firebase_admin
from firebase_admin import credentials, firestore

project_id = os.environ.get("FIREBASE_PROJECT_ID")
client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")

info = {
    "type": "service_account",
    "project_id": project_id,
    "private_key": private_key,
    "client_email": client_email,
    "client_id": "auto",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
}
try:
    firebase_admin.initialize_app(credentials.Certificate(info))
except ValueError:
    pass

db = firestore.client()

BUDGETS = {
    "run3 d2b75c0d": "d2b75c0d-fef7-48fc-811e-b3bb3d5faa60",
    "run4 8fbd0b6c": "8fbd0b6c-d47d-4e90-bab6-54eff3225bb1",
}

# Outliers de interés: estructurales que regresionaron + 01.06 (carry-over fix) + 02.02 (ICL works).
OUTLIERS = {
    "01.01", "01.04", "01.05", "01.03",  # estructurales
    "01.06",  # carry-over
    "02.02",  # ICL working
    "01.08",  # marquesina persistent
    "01.11", "02.03",  # medios
}


def short(s, n=200):
    if not s:
        return "(empty)"
    s = str(s)
    return s[:n] + ("…" if len(s) > n else "")


for label, bid in BUDGETS.items():
    print(f"\n\n{'=' * 90}\n{label} — {bid}\n{'=' * 90}")
    ref = db.collection("budgets").document(bid)
    for ch_doc in ref.collection("chapters").order_by("order").stream():
        ch_data = ch_doc.to_dict() or {}
        for it in ch_data.get("items", []) or []:
            if it.get("type") != "PARTIDA":
                continue
            code = (it.get("code") or "").strip()
            # Normalize for comparison
            normalized = code.zfill(5) if "." in code else code
            simple = code.replace("0", "", 0)  # keep as-is
            # match by trimmed code
            test_codes = {code, code.lstrip("0")}
            if not (code in OUTLIERS or any(c in OUTLIERS for c in test_codes)):
                continue

            print(f"\n--- {code}: {short(it.get('description'), 80)} ---")
            print(f"  unit={it.get('unit')}  qty={it.get('quantity')}  unitPrice={it.get('unitPrice')}  total={it.get('totalPrice')}")
            print(f"  match_kind={it.get('match_kind')}  conversion={it.get('unit_conversion_applied')}")
            print(f"  applied_fragments={it.get('applied_fragments')}")

            ai_res = it.get("ai_resolution") or {}
            sel = ai_res.get("selected_candidate") or {}
            print(f"  selected: id={sel.get('id')} priceTotal={sel.get('priceTotal')} unit={sel.get('unit')}")
            print(f"  selected.description: {short(sel.get('description'), 120)}")

            print(f"  REASONING:")
            print(f"  {short(ai_res.get('reasoning_trace'), 800)}")

            bd = it.get("breakdown") or []
            if bd:
                print(f"  BREAKDOWN ({len(bd)} components):")
                for b in bd[:5]:
                    print(f"    - {b.get('code')}: {b.get('concept')} | "
                          f"price={b.get('price')} total={b.get('total')} is_var={b.get('is_variable')}")
                if len(bd) > 5:
                    print(f"    ... {len(bd) - 5} more")

"""Quick audit: cuántos breakdown codes están truncados con '…'."""
import json
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
JSON_PATH = REPO_ROOT / "prices" / "coaatmca_2025_price_book.json"

data = json.loads(JSON_PATH.read_text(encoding="utf-8"))

truncated = []
total_breakdowns = 0
for chapter_block in data:
    for it in chapter_block.get("items", []):
        for bk in it.get("breakdown", []):
            total_breakdowns += 1
            code = bk.get("code", "")
            if "…" in code or "..." in code:
                truncated.append({
                    "item_code": it.get("code"),
                    "item_desc": (it.get("description") or "")[:60],
                    "bk_code": code,
                    "bk_desc": (bk.get("description") or "")[:60],
                })

print(f"Total breakdowns:           {total_breakdowns}")
print(f"Breakdowns con cod trunc.:  {len(truncated)} ({100*len(truncated)/total_breakdowns:.1f}%)")
print()

unique = Counter(t["bk_code"] for t in truncated)
print(f"Codes truncados unicos:     {len(unique)}")
print()
print("Top 10 codes truncados (mas frecuentes):")
for code, n in sorted(unique.items(), key=lambda kv: -kv[1])[:10]:
    print(f"  {code!r:35s} {n:4d} ocurrencias")

print()
print("Primeros 10 ejemplos:")
for t in truncated[:10]:
    print(f"  item={t['item_code']:12s} bk_code={t['bk_code']!r}")
    print(f"     bk_desc: {t['bk_desc']}")

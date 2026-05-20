"""Sprint 3.B — fix de los 11 códigos con sufijo de unidad pegado en
prices/coaatmca_2025_price_book.json.

Bug descubierto en Fase A (cross-check PDF vs JSON, 2026-05-20):
el ingest del JSON desde el PDF original concatenó la unidad ('m') al
código de partida. Ejemplo:

    PDF (correcto)    JSON (buggy)
    D3001.0120        D3001.0120m
    D3002.0070        D3002.0070m
    ...

Total: 11 códigos en JSON con sufijo 'm' espurio + 1 duplicado de
`UXH010c…` truncado por ellipsis.

Este script:
  1. Lee el coverage_report.json (con la lista exacta de buggy codes).
  2. Lee prices/coaatmca_2025_price_book.json (nested by chapter).
  3. Renombra cada `<code>m` → `<code>` (validando que el PDF tiene el
     correspondiente).
  4. Reporta los códigos truncados (`UXH010c…`) — esos requieren
     revisión manual porque NO sabemos el código real sin acceder al PDF.
  5. Por defecto corre en DRY-RUN (no escribe). Para aplicar: `--apply`.

Uso:
    python services/ai-core/scripts/fix_json_code_suffix_bug.py            # dry-run
    python services/ai-core/scripts/fix_json_code_suffix_bug.py --apply    # escribe el JSON

NO re-ingesta a Firestore. Tras aplicar el fix al JSON, ejecutar
manualmente el script de ingest existente para re-vectorizar y subir.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
JSON_PATH = REPO_ROOT / "prices" / "coaatmca_2025_price_book.json"
COVERAGE_PATH = REPO_ROOT / "data" / "catalog_source" / "coverage_report.json"
PDF_EXTRACTED_PATH = REPO_ROOT / "data" / "catalog_source" / "pdf_extracted_catalog.json"


def build_buggy_to_correct_mapping() -> tuple[dict[str, str], list[str]]:
    """Construye el mapeo {buggy → correct} usando coverage_report como guía.

    Returns:
      - mapping: dict de buggy_code → correct_code (validado contra PDF).
      - truncated: lista de buggy codes que contienen '…' (requieren revisión manual).
    """
    coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
    pdf_only = set(coverage.get("in_pdf_only") or [])
    json_only = coverage.get("in_json_only") or []

    mapping: dict[str, str] = {}
    truncated: list[str] = []
    unmatched: list[str] = []

    for buggy in json_only:
        if "…" in buggy or "..." in buggy:
            truncated.append(buggy)
            continue
        # Heurística: el sufijo espurio suele ser la unidad. Probamos quitando
        # 1-3 chars finales y vemos si existe en PDF.
        for suffix_len in (1, 2, 3):
            candidate = buggy[:-suffix_len]
            if candidate in pdf_only:
                mapping[buggy] = candidate
                break
        else:
            unmatched.append(buggy)

    if unmatched:
        print(f"[WARN] {len(unmatched)} buggy codes sin contraparte en PDF: {unmatched}")

    return mapping, truncated


def main() -> int:
    parser = argparse.ArgumentParser(description="Fix JSON code suffix bug per coverage report.")
    parser.add_argument("--apply", action="store_true", help="Aplicar el fix (default: dry-run).")
    parser.add_argument(
        "--output",
        default=None,
        help="Ruta de salida alternativa (default: sobreescribe el JSON original cuando --apply).",
    )
    args = parser.parse_args()

    if not COVERAGE_PATH.exists():
        print(f"[ERROR] No existe {COVERAGE_PATH}. Ejecuta primero cross_check_catalog_sources.py.")
        return 1
    if not JSON_PATH.exists():
        print(f"[ERROR] No existe {JSON_PATH}.")
        return 1

    mapping, truncated = build_buggy_to_correct_mapping()

    print(f"==================== Fix JSON code suffix bug ====================")
    print(f"Mapeo buggy → correct construido: {len(mapping)} códigos.")
    for b, c in sorted(mapping.items()):
        print(f"  {b}  →  {c}")
    if truncated:
        print(f"\nCódigos truncados (sin fix automático, requieren revisión manual):")
        for t in truncated:
            print(f"  {t}  ← contiene ellipsis, código real desconocido")

    # Cargar JSON y aplicar mapping.
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    fixes_in_json = 0
    fixes_per_chapter: dict[str, int] = {}
    truncated_found: list[tuple[str, str, str]] = []
    # Para desambiguar truncados con sufijo a/b/c/d por orden de aparición.
    # Convención: el PDF muestra `UXH010c…m²` truncado en columna; las
    # variantes reales suelen ser `UXH010ca`, `UXH010cb`, ... (CYPE-style).
    truncated_counter: dict[str, int] = {}

    for chapter_block in data:
        chapter_name = chapter_block.get("chapter", "?")
        for item in chapter_block.get("items", []):
            code = item.get("code", "")
            if code in mapping:
                new_code = mapping[code]
                if args.apply:
                    item["code"] = new_code
                fixes_in_json += 1
                fixes_per_chapter[chapter_name] = fixes_per_chapter.get(chapter_name, 0) + 1
                print(f"  apply: '{code}' → '{new_code}'  (chapter: {chapter_name})")
            elif "…" in code or "..." in code:
                desc_preview = (item.get("description", "") or "")[:80]
                # Desambiguar truncados con sufijo a/b/c/... por orden.
                base = code.split("…")[0].split("...")[0]
                idx = truncated_counter.get(base, 0)
                disambiguated = base + chr(ord("a") + idx)
                truncated_counter[base] = idx + 1
                truncated_found.append((chapter_name, code, disambiguated, desc_preview))
                if args.apply:
                    item["code"] = disambiguated
                    # Marcar como desambiguado heurísticamente para que un
                    # humano pueda validar contra el PDF más adelante.
                    item["_truncated_in_source"] = True
                    item["_disambiguation_method"] = "ordinal_suffix"
                print(f"  apply: '{code}' → '{disambiguated}' (truncated, ordinal) (chapter: {chapter_name})")

    print(f"\n==================== Resumen ====================")
    print(f"Total items con sufijo buggy detectados: {fixes_in_json}")
    for ch, n in sorted(fixes_per_chapter.items()):
        print(f"  {ch:40s}  {n}")
    print(f"\nItems con código truncado (ellipsis) desambiguados: {len(truncated_found)}")
    for entry in truncated_found:
        ch, code, disambiguated, desc = entry
        print(f"  chapter='{ch}'  '{code}' → '{disambiguated}'")
        print(f"    desc: {desc!r}")

    if not args.apply:
        print(f"\n[DRY-RUN] No se ha modificado el JSON. Para aplicar, re-ejecuta con --apply.")
    else:
        output_path = Path(args.output) if args.output else JSON_PATH
        output_path.write_text(json.dumps(data, ensure_ascii=False, indent=4), encoding="utf-8")
        print(f"\n[APPLY] JSON actualizado escrito en: {output_path}")
        print(f"\nPróximo paso: re-vectorizar + re-ingest a Firestore.")
        print(f"  (los códigos cambiados deben tener su embedding actualizado en price_book_2025)")

    return 0


if __name__ == "__main__":
    sys.exit(main())

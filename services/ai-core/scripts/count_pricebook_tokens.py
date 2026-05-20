"""Inventario de tokens del libro de precios.

Estima coste de re-embedding, generación de dataset sintético y catálogo
augmentation **antes** de comprometerse con cualquier pipeline de ML.

El catálogo COAATMCA tiene ~1,658 items en producción (Firestore
`price_book_2025`). El JSON de origen suele ser ~1,600-1,700 items con
schema {code, description, unit, priceTotal, breakdown[], chapter, section}.

Mide solo los campos TEXTUALES que se vectorizan (description + unit +
chapter), porque los precios no entran al embedding. Usa `tiktoken`
cl100k_base como proxy universal (Gemini no expone su tokenizer; la
diferencia con BPE de Google es <10% empíricamente).

Uso:
    python services/ai-core/scripts/count_pricebook_tokens.py \\
        [path-to-json]

Default: prices/precios_2024_hybrid_full.json (relativo al repo root).

Salida:
    - Conteo total + distribución per-item.
    - Estimación de coste para 4 escenarios:
        1) Re-embedding del catálogo entero.
        2) Generación dataset sintético (10 paráfrasis × 100 tok/item).
        3) Catálogo augmentation (5 paráfrasis × 50 tok/item).
        4) Audit pass con LLM (1 prompt × 50 tok output / item).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from statistics import mean, median, quantiles


# ---------------------------------------------------------------------------
# Tokenizer — tiktoken cl100k_base si está instalado, sino fallback heurístico
# ---------------------------------------------------------------------------

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")

    def count_tokens(text: str) -> int:
        return len(_enc.encode(text))

    _tokenizer_label = "tiktoken cl100k_base"
except ImportError:
    def count_tokens(text: str) -> int:
        # Fallback: ~4 chars/token EN, ~5 ES. Conservador 4 para no subestimar.
        return max(1, len(text) // 4)

    _tokenizer_label = "fallback heurístico (~4 chars/token)"


# ---------------------------------------------------------------------------
# Pricing 2026 (USD/M tokens)
# ---------------------------------------------------------------------------

PRICING = {
    "gemini-embedding-001": {"in": 0.025, "out": 0.0},
    "gemini-2.5-flash":     {"in": 0.075, "out": 0.30},
    "gemini-2.5-pro":       {"in": 1.25,  "out": 5.00},
    "claude-haiku-4.5":     {"in": 0.25,  "out": 1.25},
    "claude-sonnet-4.6":    {"in": 3.00,  "out": 15.00},
    "claude-opus-4.7":      {"in": 15.00, "out": 75.00},
}


def cost(model: str, tokens_in: int, tokens_out: int) -> float:
    p = PRICING[model]
    return tokens_in / 1_000_000 * p["in"] + tokens_out / 1_000_000 * p["out"]


# ---------------------------------------------------------------------------
# Análisis
# ---------------------------------------------------------------------------

def extract_text_for_embedding(item: dict) -> str:
    """Concatena los campos textuales que se vectorizan en producción.

    Ajusta esta función si el embedding incluye más campos. Hoy el indexer
    en ai-core usa description + unit + chapter.
    """
    parts = []
    for key in ("description", "unit", "chapter"):
        val = item.get(key)
        if val and isinstance(val, str):
            parts.append(val.strip())
    return " | ".join(parts)


def main():
    default_path = Path(__file__).resolve().parents[3] / "prices" / "precios_2024_hybrid_full.json"
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else default_path

    if not path.exists():
        print(f"[ERROR] Archivo no encontrado: {path}", file=sys.stderr)
        print(f"        Uso: python {Path(__file__).name} [path-to-json]", file=sys.stderr)
        sys.exit(1)

    print(f"Leyendo: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))

    # Soporta 3 estructuras:
    #   (a) lista plana: [ {item}, {item}, ... ]
    #   (b) dict con 'items': {"items": [...], ...}
    #   (c) lista anidada por capítulo: [ {"chapter": ..., "items": [...]}, ... ]
    if isinstance(data, dict) and "items" in data:
        items = data["items"]
    elif isinstance(data, list):
        # Detecta (c): primer elemento es dict con campo 'items' que es lista.
        if data and isinstance(data[0], dict) and isinstance(data[0].get("items"), list):
            items = []
            for chapter_block in data:
                chapter_name = chapter_block.get("chapter", "")
                for it in chapter_block.get("items", []):
                    # Asegura que cada item tenga el chapter denormalizado para el text.
                    if "chapter" not in it:
                        it = {**it, "chapter": chapter_name}
                    items.append(it)
        else:
            items = data
    else:
        print(f"[ERROR] JSON inesperado: ni lista ni dict con 'items'", file=sys.stderr)
        sys.exit(1)

    if not isinstance(items, list) or not items:
        print(f"[ERROR] No se encontraron items en el JSON", file=sys.stderr)
        sys.exit(1)

    print(f"Tokenizer: {_tokenizer_label}")
    print(f"Items: {len(items):,}")
    print()

    # Tokenizar todos los items
    per_item = [count_tokens(extract_text_for_embedding(it)) for it in items]
    total = sum(per_item)

    # Distribución
    p50 = median(per_item)
    q = quantiles(per_item, n=100) if len(per_item) >= 100 else per_item
    p95 = q[94] if len(q) >= 95 else max(per_item)
    p99 = q[98] if len(q) >= 99 else max(per_item)

    print("=" * 72)
    print(f"INVENTARIO DE TOKENS")
    print("=" * 72)
    print(f"  Total tokens (description + unit + chapter): {total:>12,}")
    print(f"  Tokens/item   — mean:   {mean(per_item):>6.1f}")
    print(f"                — median: {p50:>6.0f}")
    print(f"                — p95:    {p95:>6.0f}")
    print(f"                — p99:    {p99:>6.0f}")
    print(f"                — max:    {max(per_item):>6}")
    print()

    # ----------------------------------------------------------------------
    # Escenarios de coste
    # ----------------------------------------------------------------------

    print("=" * 72)
    print("ESCENARIOS DE COSTE")
    print("=" * 72)

    # 1. Re-embedding del catálogo entero.
    print(f"\n1) Re-embedding del catálogo ({len(items):,} items, 1 token in/each):")
    e_cost = cost("gemini-embedding-001", total, 0)
    print(f"   Gemini embedding-001:  ${e_cost:.4f}")

    # 2. Generación dataset sintético: 10 paráfrasis + 10 negatives × 100 tokens output cada.
    n_pairs_per_item = 20  # 10 positives + 10 negatives
    out_tok_per_pair = 100
    total_in_synth = total  # cada item se pasa como contexto al prompt
    total_out_synth = n_pairs_per_item * out_tok_per_pair * len(items)

    print(f"\n2) Dataset sintético ({n_pairs_per_item} pares × {out_tok_per_pair} tok/par):")
    print(f"   Input total:  {total_in_synth:>12,} tokens")
    print(f"   Output total: {total_out_synth:>12,} tokens")
    for model in ("gemini-2.5-flash", "gemini-2.5-pro", "claude-haiku-4.5",
                  "claude-sonnet-4.6", "claude-opus-4.7"):
        c = cost(model, total_in_synth, total_out_synth)
        print(f"   {model:25s} ${c:>8.2f}")

    # 3. Catálogo augmentation: 5 paráfrasis × 50 tokens output cada.
    n_aug = 5
    out_tok_aug = 50
    total_out_aug = n_aug * out_tok_aug * len(items)

    print(f"\n3) Augmentation del catálogo ({n_aug} paráfrasis × {out_tok_aug} tok):")
    print(f"   Input total:  {total:>12,} tokens")
    print(f"   Output total: {total_out_aug:>12,} tokens")
    print(f"   (Alternativa BARATA al fine-tune; indexar paráfrasis con mismo code)")
    for model in ("gemini-2.5-flash", "gemini-2.5-pro", "claude-haiku-4.5"):
        c = cost(model, total, total_out_aug)
        print(f"   {model:25s} ${c:>8.2f}")

    # 4. Audit pass con LLM: 1 prompt por item, ~50 tokens output (diagnóstico).
    out_tok_audit = 50
    total_out_audit = out_tok_audit * len(items)

    print(f"\n4) Audit LLM-assisted ({out_tok_audit} tok output/item, diagnóstico):")
    print(f"   Input total:  {total:>12,} tokens")
    print(f"   Output total: {total_out_audit:>12,} tokens")
    for model in ("gemini-2.5-flash", "claude-haiku-4.5"):
        c = cost(model, total, total_out_audit)
        print(f"   {model:25s} ${c:>8.2f}")

    print()
    print("=" * 72)
    print(f"NOTA: Tokens estimados con {_tokenizer_label}.")
    print(f"      Para mediciones exactas Gemini, instalar `google-generativeai`")
    print(f"      y usar genai.count_tokens(). Diferencia típica <10%.")
    print("=" * 72)


if __name__ == "__main__":
    main()

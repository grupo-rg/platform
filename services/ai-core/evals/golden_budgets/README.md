# Golden Budgets — Benchmark de regresión del pipeline v005

Conjunto pequeño de pares `(input, expected)` que el pipeline debe aprobar
en cada release. Cada carpeta `NNN-slug/` es un golden independiente con:

- `input.pdf` o `brief.txt` — lo que el pipeline recibe.
- `expected.json` — verdad humana estructurada (golden 001), o baseline
  congelada del propio pipeline (golden 002), o lista de checks (golden 003).
- `meta.json` — metadatos del caso: `flow`, `rigor`, y valores esperables.

## Rigor de cada golden

| Rigor | Qué se compara | Cuándo elegirlo |
|---|---|---|
| **benchmark** | Salida del pipeline contra verdad humana real | Cuando hay PDF/Excel/BC3 firmado por el aparejador |
| **regression_guard** | Salida del pipeline contra baseline congelada | Cuando hay input real pero no verdad humana |
| **qualitative** | Checks funcionales (capítulos esperados, rango de magnitud, DAG) | Cuando ni siquiera hay baseline congelada (NL) |

## Cómo se ejecuta

Desde `services/ai-core/`:

```
venv/Scripts/python.exe scripts/eval_golden_budgets.py
```

Salida: `services/ai-core/evals/eval_v005.json` (commiteable, histórico de runs).

## Cómo añadir un nuevo golden

1. Crear carpeta `NNN-slug/` con ID secuencial.
2. Poner `input.pdf` (si es INLINE/ANNEXED) o `brief.txt` (si es NL).
3. Aportar `expected.json` tal como se define en el `meta.json` del rigor elegido.
4. Opcional: correr `eval_golden_budgets.py --only NNN-slug` para verificar.

## Inventario actual

| # | Golden | Flujo | Rigor |
|---|---|---|---|
| 001 | MU02 ↔ P030326 | INLINE | benchmark |
| 002 | SANITAS DENTAL | ANNEXED | regression_guard |
| 003 | NL Reforma Baño 5m² | NL | qualitative |

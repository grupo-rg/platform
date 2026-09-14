"""Diff de partidas: libro nuevo (extraído) vs libro activo (Firestore).

Compuerta 2 del asistente de actualización. Dado un conjunto de partidas
extraídas del PDF nuevo y un índice `code -> precio` del libro activo, clasifica
cada partida como:

  - `new`       — el código no existe en el libro activo.
  - `changed`   — el código existe pero el precio cambió (> epsilon).
  - `unchanged` — el código existe y el precio es igual (± epsilon).

Es lógica PURA (sin I/O): recibe dicts y un índice, devuelve el resultado. Así
se testea sin Firestore y se reutiliza tal cual desde el job de ingesta (4c),
que ya tendrá todas las partidas extraídas en memoria.

Nota: `removed` (códigos en el libro activo que ya no están en el nuevo) solo
tiene sentido cuando se extrae el libro COMPLETO. En el preview muestreado no
se calcula — se deja para el job de ingesta, que sí ve el universo entero.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterable, Optional

# Medio céntimo: por debajo de esto dos precios se consideran iguales (evita
# marcar "changed" por ruido de redondeo del parseo).
_PRICE_EPS = 0.005


@dataclass
class ItemDiff:
    code: str
    description: str
    unit: str
    status: str  # "new" | "changed" | "unchanged"
    new_price: float
    old_price: Optional[float]
    delta_abs: Optional[float]
    delta_pct: Optional[float]


@dataclass
class DiffSummary:
    extracted: int
    new: int
    changed: int
    unchanged: int
    matched: int  # changed + unchanged
    avg_change_pct: Optional[float]  # media de |Δ%| sobre los "changed"


@dataclass
class DiffResult:
    summary: DiffSummary
    samples: list[ItemDiff]  # destacando primero los cambios de mayor magnitud

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": asdict(self.summary),
            "samples": [asdict(s) for s in self.samples],
        }


def diff_items(
    extracted: Iterable[dict[str, Any]],
    active_index: dict[str, float],
    *,
    price_eps: float = _PRICE_EPS,
    max_samples: int = 60,
) -> DiffResult:
    """Compara partidas extraídas contra el índice del libro activo.

    Args:
        extracted: iterable de dicts con al menos `code`, `price_total`, y
            opcionalmente `description`, `unit`.
        active_index: mapa `code -> priceTotal` del libro activo.
        price_eps: tolerancia de igualdad de precio.
        max_samples: cuántas partidas devolver en `samples` (para la UI).
    """
    diffs: list[ItemDiff] = []
    new = changed = unchanged = 0
    pct_accum: list[float] = []

    for it in extracted:
        code = (str(it.get("code") or "")).strip()
        if not code:
            continue
        try:
            new_price = float(it.get("price_total") or 0.0)
        except (TypeError, ValueError):
            new_price = 0.0

        old = active_index.get(code)
        delta_abs: Optional[float] = None
        delta_pct: Optional[float] = None

        if old is None:
            status = "new"
            new += 1
        else:
            delta_abs = new_price - old
            if abs(delta_abs) <= price_eps:
                status = "unchanged"
                unchanged += 1
                delta_pct = 0.0
            else:
                status = "changed"
                changed += 1
                delta_pct = (delta_abs / old * 100.0) if old else None
                if delta_pct is not None:
                    pct_accum.append(abs(delta_pct))

        diffs.append(
            ItemDiff(
                code=code,
                description=(str(it.get("description") or ""))[:120],
                unit=str(it.get("unit") or ""),
                status=status,
                new_price=round(new_price, 2),
                old_price=(round(old, 2) if old is not None else None),
                delta_abs=(round(delta_abs, 2) if delta_abs is not None else None),
                delta_pct=(round(delta_pct, 2) if delta_pct is not None else None),
            )
        )

    matched = changed + unchanged
    avg = round(sum(pct_accum) / len(pct_accum), 2) if pct_accum else None

    # Orden para la UI: primero los cambios (mayor |Δ%| arriba), luego las
    # nuevas, luego las sin cambio.
    _order = {"changed": 0, "new": 1, "unchanged": 2}

    def _sort_key(d: ItemDiff) -> tuple[int, float]:
        mag = abs(d.delta_pct) if d.delta_pct is not None else 0.0
        return (_order[d.status], -mag)

    samples = sorted(diffs, key=_sort_key)[:max_samples]
    summary = DiffSummary(
        extracted=len(diffs),
        new=new,
        changed=changed,
        unchanged=unchanged,
        matched=matched,
        avg_change_pct=avg,
    )
    return DiffResult(summary=summary, samples=samples)


def even_sample(seq: list[int], k: int) -> list[int]:
    """Muestreo uniforme de `k` elementos repartidos por todo `seq`.

    Para el preview sincrónico: en vez de extraer solo las primeras páginas
    (un único capítulo), toma páginas repartidas por todo el libro para que el
    diff sea representativo. Preserva el orden.
    """
    n = len(seq)
    if k <= 0:
        return []
    if k >= n:
        return list(seq)
    step = n / k
    picked = [seq[min(n - 1, int(i * step))] for i in range(k)]
    # dedup preservando orden (por si el redondeo repite índices)
    seen: set[int] = set()
    out: list[int] = []
    for p in picked:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out

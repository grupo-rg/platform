"""
Phase 17 — Distribución de markup (GG + BI) en partidas y descompuesto.

Decisión arquitectónica (D3): GG y BI son intrínsecos a las partidas.
El cliente final nunca ve el desglose; solo ve PVP. El admin Grupo RG
mantiene control de los márgenes y los ve en el panel de auditoría.

Antes (phase15): partidas y componentes persistían raw PEM. El frontend
multiplicaba por markupFactor al renderizar. Bug: el PDF aplicaba markup
solo al header de partida, no a los componentes → descompuesto no sumaba.

Ahora (phase17): el backend bakea el markup en partidas Y componentes
antes de persistir. El frontend lee y renderiza tal cual. Snapshot raw
preservado en `aiResolution.calculated_unit_price_raw` y
`breakdown[].rawPrice/rawTotal` para auditoría.
"""
from __future__ import annotations

import logging
import os
from typing import Tuple

from src.budget.domain.entities import Budget, BudgetPartida

logger = logging.getLogger(__name__)

DEFAULT_GG_PCT = float(os.getenv("BAKE_MARKUP_GG", "10.0"))
DEFAULT_BI_PCT = float(os.getenv("BAKE_MARKUP_BI", "15.0"))
CALIBRATION_VERSION_PHASE17 = "phase17-markup-baked"


def bake_markup_into_budget(
    budget: Budget,
    gg_pct: float = DEFAULT_GG_PCT,
    bi_pct: float = DEFAULT_BI_PCT,
) -> Tuple[Budget, float]:
    """Multiplica unit_price y componentes por (1 + GG% + BI%) y stamp version.

    Defaults Grupo RG: GG=10, BI=15 → factor 1.25. Configurable vía env vars
    `BAKE_MARKUP_GG` / `BAKE_MARKUP_BI` o argumentos explícitos.

    Mutates the budget in place. Returns (budget, factor_aplicado).
    """
    factor = 1.0 + (gg_pct + bi_pct) / 100.0

    if factor <= 0:
        logger.warning(f"[bake_markup] factor inválido {factor}, no-op")
        budget.calibrationVersion = CALIBRATION_VERSION_PHASE17
        return budget, 1.0

    for chapter in budget.chapters:
        for item in chapter.items:
            if not isinstance(item, BudgetPartida):
                continue

            if item.ai_resolution is not None:
                item.ai_resolution.calculated_unit_price_raw = item.unitPrice

            item.unitPrice = round(item.unitPrice * factor, 2)
            item.totalPrice = round(item.unitPrice * item.quantity, 2)

            if item.breakdown:
                for b in item.breakdown:
                    b.rawPrice = b.price
                    b.rawTotal = b.total
                    b.price = round(b.price * factor, 2)
                    b.total = round(b.total * factor, 2)

        chapter.totalPrice = round(
            sum(
                (it.totalPrice if isinstance(it, BudgetPartida) else it.totalPrice)
                for it in chapter.items
            ),
            2,
        )

    budget.calibrationVersion = CALIBRATION_VERSION_PHASE17
    logger.info(
        f"[bake_markup] applied factor={factor:.4f} (GG={gg_pct}%, BI={bi_pct}%) "
        f"to budget {budget.id} ({sum(len(c.items) for c in budget.chapters)} items)"
    )
    return budget, factor

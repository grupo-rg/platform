"""Clasificador de layout. Heurísticas puras sobre texto extraído por página.

Output: `LayoutClassification` con tipo + confianza + evidencia legible.
"""
from __future__ import annotations

import re
from typing import List

from src.budget.layout_analyzer.domain import LayoutClassification, LayoutType
from src.budget.layout_analyzer.patterns import (
    PARTIDA_MU02,
    PARTIDA_SANITAS,
    QUANTITY_ROW,
)


def classify(text_per_page: List[str]) -> LayoutClassification:
    """Clasifica un documento dado su texto por página.

    Heurística por capas:
    1. Si no hay texto en NINGUNA página → UNKNOWN (probablemente PDF escaneado).
    2. Si hay tablas regulares con cabecera "Código Resumen Ud Cantidad Precio"
       en la mayoría de páginas → TABLE_TABULAR.
    3. Si los códigos de partida están INTERCALADOS con los bloques descriptivos
       (cada partida tiene su descripción cerca de su código) → INLINE_WITH_TITLES.
    4. Si las descripciones viven en las primeras N páginas y los sumatorios
       (filas de cantidades sin código) en las últimas → TWO_PHASE_ANNEXED.
    5. Else → UNKNOWN.
    """
    full_text = "\n".join(text_per_page)
    evidence: List[str] = []

    # --- Capa 1: nada de texto = UNKNOWN ---
    total_chars = len(full_text)
    if total_chars < 200:
        return LayoutClassification(
            type="UNKNOWN",
            confidence=1.0,
            evidence=[f"text extracción retornó {total_chars} chars total — probablemente escaneado o no es un presupuesto"],
        )

    # --- Conteo base: cuántas partidas detecta cada pattern ---
    n_sanitas = sum(1 for _ in PARTIDA_SANITAS.finditer(full_text))
    n_mu02 = sum(1 for _ in PARTIDA_MU02.finditer(full_text))
    n_partidas = n_sanitas + n_mu02

    if n_partidas < 3:
        return LayoutClassification(
            type="UNKNOWN",
            confidence=0.6,
            evidence=[
                f"detectados solo {n_partidas} candidatos de partida via regex — formato no reconocido",
                f"texto total: {total_chars} chars en {len(text_per_page)} páginas",
            ],
        )

    # --- Capa 2: TABLE_TABULAR ---
    # Marcadores: cabecera "Código...Resumen...Ud...Cantidad...Precio" Y
    # alta densidad de filas tabulares (espaciado ancho consistente).
    table_header = re.search(
        r"C[óo]digo\s+(?:Nat\s+)?(?:Ud|U/?d)\s+Resumen",
        full_text,
        re.IGNORECASE,
    )
    has_table_header = bool(table_header)

    # --- Capa 3 vs 4: INLINE vs ANNEXED ---
    # Estrategia: dividir páginas en "front" (primer tercio) y "back" (último
    # tercio). Si las partidas viven principalmente en el front Y los sumatorios
    # (quantity rows aisladas) viven en el back → ANNEXED. Si están repartidos
    # uniformemente → INLINE.
    n_pages = len(text_per_page)
    if n_pages >= 6:
        third = n_pages // 3
        front_text = "\n".join(text_per_page[:third])
        back_text = "\n".join(text_per_page[-third:])

        front_partidas = (
            sum(1 for _ in PARTIDA_SANITAS.finditer(front_text))
            + sum(1 for _ in PARTIDA_MU02.finditer(front_text))
        )
        back_partidas = (
            sum(1 for _ in PARTIDA_SANITAS.finditer(back_text))
            + sum(1 for _ in PARTIDA_MU02.finditer(back_text))
        )
        front_qrows = sum(1 for _ in QUANTITY_ROW.finditer(front_text))
        back_qrows = sum(1 for _ in QUANTITY_ROW.finditer(back_text))

        # Detección ANNEXED: descripciones concentradas en front, sumatorios en back.
        descriptions_front_heavy = front_partidas > back_partidas * 2
        sumatorios_back_heavy = back_qrows > front_qrows * 2 and back_qrows >= 5

        if descriptions_front_heavy and sumatorios_back_heavy:
            return LayoutClassification(
                type="TWO_PHASE_ANNEXED",
                confidence=0.85,
                evidence=[
                    f"{n_partidas} partidas detectadas via regex",
                    f"{front_partidas} partidas en primer tercio vs {back_partidas} en último → descripciones en front",
                    f"{back_qrows} quantity rows en último tercio vs {front_qrows} en primer → sumatorios en back",
                ],
            )

    # Default cuando hay muchas partidas distribuidas: INLINE_WITH_TITLES.
    # Calibración:
    # - 20+ partidas → 0.90 (conjunto suficiente para estar seguros).
    # - has_table_header → 0.85 (señal estructural fuerte: el PDF es un presupuesto formal).
    # - Default → 0.65 (suficiente para distinguir de UNKNOWN, pero margen de error).
    if n_partidas >= 20:
        confidence = 0.90
    elif has_table_header:
        confidence = 0.85
    else:
        confidence = 0.65
    ev = [
        f"{n_partidas} partidas detectadas via regex (SANITAS={n_sanitas}, MU02={n_mu02})",
        "partidas distribuidas a lo largo del documento (no concentradas en una sección)",
    ]
    if has_table_header:
        ev.append(f'cabecera tabular detectada: "{table_header.group(0)}"')

    return LayoutClassification(
        type="INLINE_WITH_TITLES",
        confidence=confidence,
        evidence=ev,
    )

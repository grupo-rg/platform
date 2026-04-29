"""Fase 9.5 — agrupado adaptativo de partidas para evaluación.

Objetivo: las partidas adyacentes "fáciles" (top score ≥ 0.85, unit match) en el
mismo capítulo se agrupan en un solo chunk de hasta 5 → una llamada Flash
batched. Las partidas "difíciles" quedan solas (singleton, Pro).

Esto reduce las llamadas al LLM aprox. ÷3 cuando el budget tiene clusters de
1:1 fáciles consecutivos en el mismo capítulo (caso típico en presupuestos
estructurados como SANITAS o MU02).
"""
from __future__ import annotations

from typing import Any, Dict, List

import pytest

from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import (
    _group_tasks_adaptively,
)


def _t(code: str) -> Dict[str, Any]:
    """Task dict como aparecen en `batch_tasks`."""
    return {"id": code, "prompt": f"prompt for {code}"}


def _item(code: str, chapter: str, unit: str = "m2") -> RestructuredItem:
    return RestructuredItem(code=code, description=f"D{code}", quantity=1.0, unit=unit, chapter=chapter)


def _easy_cands(unit: str = "m2") -> List[Dict[str, Any]]:
    """Top score 0.92, unit match → tier flash."""
    return [{"id": "C1", "matchScore": 0.92, "unit": unit, "priceTotal": 50.0}]


def _hard_cands() -> List[Dict[str, Any]]:
    """Top score 0.5, unit mismatch → tier pro."""
    return [{"id": "C1", "matchScore": 0.50, "unit": "h", "priceTotal": 25.0}]


def test_groups_adjacent_easy_partidas_in_same_chapter():
    tasks = [_t("C01.01"), _t("C01.02"), _t("C01.03")]
    items = {f"C01.0{i}": _item(f"C01.0{i}", "C01 DEMOLICIONES") for i in range(1, 4)}
    cands_map = {code: {"candidates": _easy_cands(), "item": items[code]} for code in items}

    groups = _group_tasks_adaptively(tasks, cands_map, items, max_batch=5)
    assert len(groups) == 1
    assert [t["id"] for t in groups[0]] == ["C01.01", "C01.02", "C01.03"]


def test_hard_partidas_become_singletons():
    tasks = [_t("C01.01"), _t("C01.02"), _t("C01.03")]
    items = {f"C01.0{i}": _item(f"C01.0{i}", "C01") for i in range(1, 4)}
    cands_map = {code: {"candidates": _hard_cands(), "item": items[code]} for code in items}

    groups = _group_tasks_adaptively(tasks, cands_map, items, max_batch=5)
    assert len(groups) == 3
    for g in groups:
        assert len(g) == 1


def test_hard_in_middle_breaks_easy_group():
    """easy, easy, HARD, easy, easy → debe partirse en [easy, easy] [HARD] [easy, easy]."""
    tasks = [_t(f"C01.0{i}") for i in range(1, 6)]
    items = {f"C01.0{i}": _item(f"C01.0{i}", "C01") for i in range(1, 6)}
    cands_map = {
        "C01.01": {"candidates": _easy_cands(), "item": items["C01.01"]},
        "C01.02": {"candidates": _easy_cands(), "item": items["C01.02"]},
        "C01.03": {"candidates": _hard_cands(), "item": items["C01.03"]},
        "C01.04": {"candidates": _easy_cands(), "item": items["C01.04"]},
        "C01.05": {"candidates": _easy_cands(), "item": items["C01.05"]},
    }
    groups = _group_tasks_adaptively(tasks, cands_map, items, max_batch=5)
    assert len(groups) == 3
    assert [t["id"] for t in groups[0]] == ["C01.01", "C01.02"]
    assert [t["id"] for t in groups[1]] == ["C01.03"]
    assert [t["id"] for t in groups[2]] == ["C01.04", "C01.05"]


def test_chapter_change_breaks_easy_group():
    tasks = [_t("C01.01"), _t("C01.02"), _t("C02.01")]
    items = {
        "C01.01": _item("C01.01", "C01 DEMOL"),
        "C01.02": _item("C01.02", "C01 DEMOL"),
        "C02.01": _item("C02.01", "C02 ALBAÑIL"),
    }
    cands_map = {code: {"candidates": _easy_cands(), "item": items[code]} for code in items}
    groups = _group_tasks_adaptively(tasks, cands_map, items, max_batch=5)
    assert len(groups) == 2
    assert [t["id"] for t in groups[0]] == ["C01.01", "C01.02"]
    assert [t["id"] for t in groups[1]] == ["C02.01"]


def test_max_batch_size_cap():
    """7 easy del mismo capítulo y max_batch=5 → 5 + 2."""
    tasks = [_t(f"C01.0{i}") for i in range(1, 8)]
    items = {f"C01.0{i}": _item(f"C01.0{i}", "C01") for i in range(1, 8)}
    cands_map = {code: {"candidates": _easy_cands(), "item": items[code]} for code in items}
    groups = _group_tasks_adaptively(tasks, cands_map, items, max_batch=5)
    assert len(groups) == 2
    assert len(groups[0]) == 5
    assert len(groups[1]) == 2


def test_empty_input_returns_empty():
    assert _group_tasks_adaptively([], {}, {}, max_batch=5) == []


def test_isolated_easy_partida_is_singleton_when_alone():
    tasks = [_t("C01.01"), _t("C01.02"), _t("C01.03")]
    items = {f"C01.0{i}": _item(f"C01.0{i}", "C01") for i in range(1, 4)}
    # Easy, hard, easy — el último easy queda solo.
    cands_map = {
        "C01.01": {"candidates": _easy_cands(), "item": items["C01.01"]},
        "C01.02": {"candidates": _hard_cands(), "item": items["C01.02"]},
        "C01.03": {"candidates": _easy_cands(), "item": items["C01.03"]},
    }
    groups = _group_tasks_adaptively(tasks, cands_map, items, max_batch=5)
    assert len(groups) == 3
    assert all(len(g) == 1 for g in groups)

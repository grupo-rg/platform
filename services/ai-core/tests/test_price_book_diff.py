"""Tests del diff de partidas (compuerta 2)."""

from __future__ import annotations

from src.budget.catalog.price_book_diff import diff_items, even_sample


def _item(code, price, desc="d", unit="m2"):
    return {"code": code, "price_total": price, "description": desc, "unit": unit}


def test_classifies_new_changed_unchanged():
    active = {"A01": 100.0, "B02": 50.0, "C03": 10.0}
    extracted = [
        _item("A01", 110.0),  # changed +10%
        _item("B02", 50.0),   # unchanged
        _item("Z99", 5.0),    # new
    ]
    res = diff_items(extracted, active)
    s = res.summary
    assert s.extracted == 3
    assert s.new == 1
    assert s.changed == 1
    assert s.unchanged == 1
    assert s.matched == 2
    # media de |Δ%| solo sobre changed → 10%
    assert s.avg_change_pct == 10.0


def test_price_eps_absorbs_rounding_noise():
    active = {"A01": 100.0}
    # diferencia de 0.004 € < eps 0.005 → unchanged
    res = diff_items([_item("A01", 100.004)], active)
    assert res.summary.unchanged == 1
    assert res.summary.changed == 0


def test_delta_fields_and_sign():
    active = {"A01": 200.0}
    res = diff_items([_item("A01", 150.0)], active)
    d = res.samples[0]
    assert d.status == "changed"
    assert d.old_price == 200.0
    assert d.new_price == 150.0
    assert d.delta_abs == -50.0
    assert d.delta_pct == -25.0


def test_samples_sorted_changed_by_magnitude_first():
    active = {"A": 100.0, "B": 100.0, "C": 100.0}
    extracted = [
        _item("A", 105.0),   # +5%
        _item("B", 130.0),   # +30%  ← debe salir primero
        _item("C", 100.0),   # unchanged
        _item("NEW", 9.0),   # new
    ]
    res = diff_items(extracted, active)
    order = [s.code for s in res.samples]
    assert order[0] == "B"      # mayor magnitud de cambio
    assert order[1] == "A"      # siguiente cambio
    assert order.index("NEW") < order.index("C")  # new antes que unchanged


def test_blank_codes_skipped():
    res = diff_items([_item("", 10.0), {"code": None, "price_total": 5}], {})
    assert res.summary.extracted == 0


def test_max_samples_caps_list_but_not_counts():
    active = {f"K{i}": 10.0 for i in range(100)}
    extracted = [_item(f"K{i}", 11.0) for i in range(100)]  # todos changed
    res = diff_items(extracted, active, max_samples=5)
    assert res.summary.changed == 100
    assert len(res.samples) == 5


def test_even_sample_spreads_across_range():
    seq = list(range(1, 101))  # 1..100
    picked = even_sample(seq, 5)
    assert len(picked) == 5
    assert picked[0] == 1
    assert picked[-1] <= 100 and picked[-1] >= 80  # último tramo
    # monótono creciente y sin duplicados
    assert picked == sorted(set(picked))


def test_even_sample_k_ge_n_returns_all():
    seq = [3, 7, 9]
    assert even_sample(seq, 10) == [3, 7, 9]
    assert even_sample(seq, 3) == [3, 7, 9]


def test_even_sample_k_zero():
    assert even_sample([1, 2, 3], 0) == []

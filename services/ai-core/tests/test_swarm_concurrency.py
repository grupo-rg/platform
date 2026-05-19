"""S1-A-07 — concurrencia del swarm via env var SWARM_CONCURRENCY.

Antes del Sprint 1, el `Semaphore(4)` estaba hardcodeado en
`swarm_pricing_service.evaluate_batch`. El incidente 2026-05-18 demostró
que con 4 slots el sistema se atascaba; el plan eleva el default a 8 y lo
hace configurable.

Estos tests cubren solo la lógica pura `_read_swarm_concurrency` (lo demás
está cubierto indirectamente vía los tests de integración del swarm).
"""
from __future__ import annotations

from src.budget.application.services.swarm_pricing_service import (
    _DEFAULT_SWARM_CONCURRENCY,
    _read_swarm_concurrency,
)


def test_default_when_env_unset(monkeypatch):
    monkeypatch.delenv("SWARM_CONCURRENCY", raising=False)
    assert _read_swarm_concurrency() == _DEFAULT_SWARM_CONCURRENCY
    # Sanity: el default post-S1-A-07 es 8.
    assert _DEFAULT_SWARM_CONCURRENCY == 8


def test_parses_valid_int(monkeypatch):
    monkeypatch.setenv("SWARM_CONCURRENCY", "16")
    assert _read_swarm_concurrency() == 16


def test_falls_back_on_invalid(monkeypatch):
    """Valores fuera de rango [1,64] o no-int caen al default."""
    for bad in ["0", "-1", "65", "1000", "abc", ""]:
        monkeypatch.setenv("SWARM_CONCURRENCY", bad)
        assert _read_swarm_concurrency() == _DEFAULT_SWARM_CONCURRENCY


def test_accepts_minimum_one(monkeypatch):
    monkeypatch.setenv("SWARM_CONCURRENCY", "1")
    assert _read_swarm_concurrency() == 1


def test_accepts_maximum_sixty_four(monkeypatch):
    monkeypatch.setenv("SWARM_CONCURRENCY", "64")
    assert _read_swarm_concurrency() == 64

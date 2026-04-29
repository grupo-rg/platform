"""Tests del InternalTokenMiddleware.

Valida los tres escenarios del contrato:
  1. Token configurado + header correcto → deja pasar.
  2. Token configurado + header incorrecto (o ausente) → 401.
  3. Token vacío (dev/local) → deja pasar sin validar (no bloquear desarrollo).
"""

from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.core.http.main import InternalTokenMiddleware


def _make_app() -> FastAPI:
    """Construye una app mínima con el middleware y dos rutas: una bajo
    `/api/v1/jobs/*` (protegida) y otra fuera (/health) para contrastar."""
    app = FastAPI()
    app.add_middleware(InternalTokenMiddleware)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/v1/jobs/dummy")
    def dummy():
        return {"ok": True}

    return app


def test_health_always_passes_even_without_token(monkeypatch):
    monkeypatch.setenv("INTERNAL_WORKER_TOKEN", "super-secret")
    client = TestClient(_make_app())
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_protected_route_rejects_without_header(monkeypatch):
    monkeypatch.setenv("INTERNAL_WORKER_TOKEN", "super-secret")
    client = TestClient(_make_app())
    r = client.post("/api/v1/jobs/dummy")
    assert r.status_code == 401
    assert "Unauthorized" in r.json().get("error", "")


def test_protected_route_rejects_with_wrong_header(monkeypatch):
    monkeypatch.setenv("INTERNAL_WORKER_TOKEN", "super-secret")
    client = TestClient(_make_app())
    r = client.post("/api/v1/jobs/dummy", headers={"x-internal-token": "nope"})
    assert r.status_code == 401


def test_protected_route_accepts_with_correct_header(monkeypatch):
    monkeypatch.setenv("INTERNAL_WORKER_TOKEN", "super-secret")
    client = TestClient(_make_app())
    r = client.post("/api/v1/jobs/dummy", headers={"x-internal-token": "super-secret"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_empty_token_allows_everything(monkeypatch):
    """En dev, si no hay INTERNAL_WORKER_TOKEN configurado, no debe bloquear."""
    monkeypatch.delenv("INTERNAL_WORKER_TOKEN", raising=False)
    client = TestClient(_make_app())
    r = client.post("/api/v1/jobs/dummy")
    assert r.status_code == 200


def test_whitespace_only_token_treated_as_empty(monkeypatch):
    monkeypatch.setenv("INTERNAL_WORKER_TOKEN", "   ")
    client = TestClient(_make_app())
    r = client.post("/api/v1/jobs/dummy")
    assert r.status_code == 200

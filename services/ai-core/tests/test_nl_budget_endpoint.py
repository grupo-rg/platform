"""Tests del endpoint POST /api/v1/jobs/nl-budget.

Usa FastAPI TestClient con un use case stub para evitar tocar LLM/Firestore.
Valida:
  - narrativa corta → 400
  - payload válido + auth OK → 202 + devuelve budgetId
  - error de schema del body → 422 (Pydantic automático)
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

# Forzamos que el middleware acepte todo en tests (token vacío = dev mode)
import os
os.environ.pop("INTERNAL_WORKER_TOKEN", None)

from src.core.http.main import app
from src.core.http.dependencies import get_generate_budget_from_nl_uc


class _StubUseCase:
    """Captura las llamadas y no ejecuta nada real."""

    def __init__(self):
        self.calls = []

    async def execute(self, narrative: str, lead_id: str = "anonymous", budget_id=None):
        self.calls.append({"narrative": narrative, "lead_id": lead_id, "budget_id": budget_id})
        # Devolvemos un Budget mock mínimo — el endpoint no lo inspecciona porque
        # el job corre en background.
        return None


@pytest.fixture
def client_with_stub():
    stub = _StubUseCase()
    app.dependency_overrides[get_generate_budget_from_nl_uc] = lambda: stub
    try:
        yield TestClient(app), stub
    finally:
        app.dependency_overrides.clear()


def test_rejects_narrative_too_short(client_with_stub):
    client, _ = client_with_stub
    r = client.post("/api/v1/jobs/nl-budget", json={
        "leadId": "l1",
        "budgetId": "b1",
        "narrative": "x",  # <10 chars
    })
    assert r.status_code == 400
    assert "narrative" in r.json()["detail"]


def test_accepts_valid_payload_and_returns_202(client_with_stub):
    client, _ = client_with_stub
    r = client.post("/api/v1/jobs/nl-budget", json={
        "leadId": "lead-42",
        "budgetId": "bid-42",
        "narrative": "Reforma cocina de 12 m² con demolición de alicatado y nueva fontanería.",
    })
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "processing"
    assert body["budgetId"] == "bid-42"
    assert body["leadId"] == "lead-42"


def test_rejects_malformed_body_with_422(client_with_stub):
    client, _ = client_with_stub
    # Falta el campo `narrative` requerido
    r = client.post("/api/v1/jobs/nl-budget", json={"leadId": "x"})
    assert r.status_code == 422


def test_defaults_lead_id_when_missing(client_with_stub):
    client, _ = client_with_stub
    r = client.post("/api/v1/jobs/nl-budget", json={
        "narrative": "Reforma cualquiera con al menos diez caracteres.",
    })
    assert r.status_code == 202
    assert r.json()["leadId"] == "anonymous"


def test_endpoint_requires_token_when_configured(monkeypatch):
    """Con INTERNAL_WORKER_TOKEN configurado, sin header el endpoint devuelve 401."""
    monkeypatch.setenv("INTERNAL_WORKER_TOKEN", "required-token")
    stub = _StubUseCase()
    app.dependency_overrides[get_generate_budget_from_nl_uc] = lambda: stub
    try:
        client = TestClient(app)
        r = client.post("/api/v1/jobs/nl-budget", json={"narrative": "Reforma ya definida y suficiente."})
        assert r.status_code == 401
    finally:
        app.dependency_overrides.clear()

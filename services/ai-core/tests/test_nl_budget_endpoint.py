"""Tests del endpoint POST /api/v1/jobs/nl-budget.

P5.a — refactor que migra el endpoint a Cloud Run Jobs dispatch.
Ahora el handler crea un PipelineJob en Firestore y dispara un worker; ya no
corre `GenerateBudgetFromNlUseCase` inline. Estos tests validan el shape
externo (status codes, response body) usando un repo en memoria y un mock
del executor.

Cobertura:
  - narrativa corta → 400
  - payload válido → 202 + devuelve {jobId, leadId, budgetId}
  - error de schema del body → 422 (Pydantic automático)
  - middleware INTERNAL_WORKER_TOKEN sigue funcionando
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

# Forzamos que el middleware acepte todo en tests (token vacío = dev mode).
os.environ.pop("INTERNAL_WORKER_TOKEN", None)

# main.py inicializa Firebase Admin al importarse — IMPORTANTE que se importe
# antes que dependencies.py para no romper `firestore.client()`.
from src.core.http.main import app  # noqa: E402
from src.core.http.dependencies import (  # noqa: E402
    get_job_executor as _deps_get_job_executor,
    get_pipeline_job_repository as _deps_get_pipeline_job_repository,
    get_worker_job_name as _deps_get_worker_job_name,
)
from src.pipeline_jobs.infrastructure.in_memory_pipeline_job_repository import (  # noqa: E402
    InMemoryPipelineJobRepository,
)

WORKER_JOB_NAME = (
    "projects/grupo-rg-a9929/locations/europe-southwest1/jobs/ai-core-worker"
)
EXEC_NAME = WORKER_JOB_NAME + "/executions/exec-test"


@pytest.fixture
def client_with_dispatcher(monkeypatch):
    """Mocks the dispatcher dependencies — no real Firestore / Cloud Run."""
    monkeypatch.delenv("INTERNAL_WORKER_TOKEN", raising=False)
    repo = InMemoryPipelineJobRepository()
    executor = MagicMock()
    executor.run_execution = AsyncMock(return_value=EXEC_NAME)
    app.dependency_overrides[_deps_get_pipeline_job_repository] = lambda: repo
    app.dependency_overrides[_deps_get_job_executor] = lambda: executor
    app.dependency_overrides[_deps_get_worker_job_name] = lambda: WORKER_JOB_NAME
    try:
        yield TestClient(app), repo, executor
    finally:
        app.dependency_overrides.clear()


def test_rejects_narrative_too_short(client_with_dispatcher):
    client, _, _ = client_with_dispatcher
    r = client.post("/api/v1/jobs/nl-budget", json={
        "leadId": "l1",
        "budgetId": "b1",
        "narrative": "x",  # <10 chars
    })
    assert r.status_code == 400
    assert "narrative" in r.json()["detail"]


def test_accepts_valid_payload_and_returns_202(client_with_dispatcher):
    client, repo, executor = client_with_dispatcher
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
    # New contract: jobId returned so the UI can subscribe to telemetry.
    assert body["jobId"]
    # Worker dispatched with JOB_ID env override.
    executor.run_execution.assert_awaited_once()
    kwargs = executor.run_execution.call_args.kwargs
    assert kwargs.get("env_overrides") == {"JOB_ID": body["jobId"]}


def test_rejects_malformed_body_with_422(client_with_dispatcher):
    client, _, _ = client_with_dispatcher
    # Falta el campo `narrative` requerido
    r = client.post("/api/v1/jobs/nl-budget", json={"leadId": "x"})
    assert r.status_code == 422


def test_defaults_lead_id_when_missing(client_with_dispatcher):
    client, _, _ = client_with_dispatcher
    r = client.post("/api/v1/jobs/nl-budget", json={
        "narrative": "Reforma cualquiera con al menos diez caracteres.",
    })
    assert r.status_code == 202
    assert r.json()["leadId"] == "anonymous"


def test_endpoint_requires_token_when_configured(monkeypatch):
    """Con INTERNAL_WORKER_TOKEN configurado, sin header el endpoint devuelve 401."""
    monkeypatch.setenv("INTERNAL_WORKER_TOKEN", "required-token")
    repo = InMemoryPipelineJobRepository()
    executor = MagicMock()
    executor.run_execution = AsyncMock(return_value=EXEC_NAME)
    app.dependency_overrides[_deps_get_pipeline_job_repository] = lambda: repo
    app.dependency_overrides[_deps_get_job_executor] = lambda: executor
    app.dependency_overrides[_deps_get_worker_job_name] = lambda: WORKER_JOB_NAME
    try:
        client = TestClient(app)
        r = client.post("/api/v1/jobs/nl-budget", json={"narrative": "Reforma ya definida y suficiente."})
        assert r.status_code == 401
    finally:
        app.dependency_overrides.clear()

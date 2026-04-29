"""Tests del ArchitectService.

Valida:
  - La construcción del prompt incluye catálogo + petición + reglas clave.
  - El loader de catálogo usa el archivo `data/pdf_index_2025.json`.
  - `decompose_request` llama al LLM con el schema correcto y propaga usage.
  - Las 2 formas de respuesta (ASKING / COMPLETE) deserializan correctamente.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Type

import pytest
from pydantic import BaseModel

from src.budget.application.ports.ports import ILLMProvider
from src.budget.application.services.architect_service import (
    ArchitectResponse,
    ArchitectService,
    ArchitectStatus,
    DecomposedTask,
)


class _StubLLM(ILLMProvider):
    def __init__(self, response: ArchitectResponse):
        self.response = response
        self.last_call: Optional[Dict[str, Any]] = None

    async def generate_structured(
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: Type[BaseModel],
        temperature: float = 0.2,
        model: str = "gemini-2.5-flash",
        image_base64: Optional[str] = None,
        max_output_tokens: int = 8192,
    ) -> tuple[BaseModel, Dict[str, int]]:
        self.last_call = {
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "response_schema": response_schema,
            "temperature": temperature,
            "model": model,
            "max_output_tokens": max_output_tokens,
        }
        return self.response, {"promptTokenCount": 100, "candidatesTokenCount": 50, "totalTokenCount": 150}

    async def get_embedding(self, text: str) -> List[float]:
        return [0.0] * 768


def _complete_response() -> ArchitectResponse:
    return ArchitectResponse(
        status=ArchitectStatus.COMPLETE,
        question=None,
        tasks=[
            DecomposedTask(
                taskId=1,
                dependsOn=[],
                chapter="DEMOLICIONES",
                subchapter="Picado",
                reasoning="Necesario antes de alicatar",
                task="Picar alicatado existente en cocina",
                userSpecificMaterial=None,
                isExplicitlyRequested=True,
                estimatedParametricUnit="m2",
                estimatedParametricQuantity=30.0,
            ),
        ],
    )


def test_catalog_is_loaded_and_injected_in_prompt():
    stub = _StubLLM(_complete_response())
    svc = ArchitectService(llm_provider=stub)
    asyncio.run(svc.decompose_request("Reforma cocina 12 m²"))
    assert stub.last_call is not None
    prompt = stub.last_call["user_prompt"]
    # Algunas marcas del catálogo COAATMCA deben aparecer.
    assert "DEMOLICIONES" in prompt
    assert "FONTANERIA Y GAS" in prompt or "FONTANERIA" in prompt
    # Y la petición original.
    assert "Reforma cocina 12 m²" in prompt


def test_uses_architect_response_schema_and_flash_model():
    stub = _StubLLM(_complete_response())
    svc = ArchitectService(llm_provider=stub)
    asyncio.run(svc.decompose_request("Reforma baño"))
    assert stub.last_call["response_schema"] is ArchitectResponse
    assert stub.last_call["model"] == "gemini-2.5-flash"
    assert stub.last_call["temperature"] == 0.1


def test_propagates_usage_metrics():
    stub = _StubLLM(_complete_response())
    svc = ArchitectService(llm_provider=stub)
    response, usage = asyncio.run(svc.decompose_request("Reforma X"))
    assert usage["promptTokenCount"] == 100
    assert usage["candidatesTokenCount"] == 50
    assert response.status == ArchitectStatus.COMPLETE
    assert len(response.tasks) == 1


def test_asking_response_passes_through():
    stub = _StubLLM(ArchitectResponse(
        status=ArchitectStatus.ASKING,
        question="¿Cuántos m²?",
        tasks=[],
    ))
    svc = ArchitectService(llm_provider=stub)
    response, _ = asyncio.run(svc.decompose_request("Algo ambiguo"))
    assert response.status == ArchitectStatus.ASKING
    assert response.question == "¿Cuántos m²?"
    assert response.tasks == []


def test_decomposed_task_schema_accepts_optional_fields():
    """Sanity check del schema Pydantic — campos opcionales no rompen la validación."""
    task = DecomposedTask(
        taskId=7,
        dependsOn=[1, 2],
        chapter="UNCLASSIFIED",
        reasoning="Tarea ambigua",
        task="Algo especial",
        estimatedParametricUnit="ud",
        estimatedParametricQuantity=1.0,
    )
    assert task.subchapter is None
    assert task.userSpecificMaterial is None
    assert task.isExplicitlyRequested is False


def test_missing_catalog_falls_back_to_empty_list(tmp_path):
    """Si el data dir no existe, el servicio no debe crashear; carga lista vacía."""
    stub = _StubLLM(_complete_response())
    svc = ArchitectService(llm_provider=stub, data_dir=str(tmp_path / "doesnt_exist"))
    asyncio.run(svc.decompose_request("Reforma cualquiera"))
    # El prompt sigue llegando al LLM aunque sin catálogo
    assert stub.last_call is not None
    assert "Reforma cualquiera" in stub.last_call["user_prompt"]

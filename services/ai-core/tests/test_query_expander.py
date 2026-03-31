import pytest
from unittest.mock import AsyncMock
from typing import Dict, Any, List, Optional

from src.budget.infrastructure.ai.query_expander import QueryExpander, QueryExpansionResult
from src.budget.application.ports.ports import ILLMProvider

class MockLLMProvider(ILLMProvider):
    def __init__(self, mock_result: QueryExpansionResult):
        self.mock_result = mock_result
        self.called_with = []

    async def generate_structured(self, system_prompt: str, user_prompt: str, response_schema: Any, temperature: float = 0.2, image_base64: Optional[str] = None) -> tuple[Any, Dict[str, int]]:
        self.called_with.append({
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "temperature": temperature
        })
        return self.mock_result, {"promptTokenCount": 10, "candidatesTokenCount": 5}

    async def get_embedding(self, text: str) -> List[float]:
        return [0.1, 0.2, 0.3]

    async def create_and_run_batch(self, tasks, response_schema, system_prompt, display_name, temperature=0.2):
        return "batch_123"

    async def poll_batch_status(self, job_name):
        return "JOB_STATE_SUCCEEDED"

    async def get_batch_results(self, job_name, response_schema):
        return {}


@pytest.mark.asyncio
async def test_query_expander_returns_multiple_queries():
    # Arrange
    expected_queries = ["Encachado grava 10cm", "Limpieza de parcela", "Acondicionamiento maquinaria"]
    mock_result = QueryExpansionResult(queries=expected_queries)
    mock_llm = MockLLMProvider(mock_result)
    expander = QueryExpander(mock_llm)

    # Act
    description = "Acondicionamiento de entrada para camiones 10cm grava."
    unit = "Ud"
    result = await expander.expand(description, unit)

    # Assert
    assert len(result) == 3
    assert result == expected_queries
    assert len(mock_llm.called_with) == 1
    assert "Acondicionamiento de entrada" in mock_llm.called_with[0]["user_prompt"]
    assert mock_llm.called_with[0]["temperature"] == 0.3

@pytest.mark.asyncio
async def test_query_expander_fallback_on_exception():
    # Arrange
    class FailingMockLLM(MockLLMProvider):
        async def generate_structured(self, *args, **kwargs):
            raise Exception("API Timeout")

    mock_llm = FailingMockLLM(QueryExpansionResult(queries=[]))
    expander = QueryExpander(mock_llm)

    # Act
    description = "Pintura plastica blanca."
    result = await expander.expand(description, "m2")

    # Assert
    assert len(result) == 1
    assert result[0] == description # Should fallback to original description safely

import pytest
from typing import List, Dict, Any, Optional

from src.budget.domain.entities import Budget
from src.budget.application.ports.ports import ILLMProvider, IVectorSearch, IGenerationEmitter, IBudgetRepository
from src.budget.application.use_cases.restructure_budget_uc import RestructureBudgetUseCase, RestructureChunkResult, RestructuredItem, PricingEvaluatorResult

class MockLLMProvider(ILLMProvider):
    def generate_structured(self, system_prompt: str, user_prompt: str, response_schema: Any, temperature: float = 0.2) -> Dict[str, Any]:
        if response_schema == RestructureChunkResult:
            return RestructureChunkResult(items=[
                RestructuredItem(
                    code="01.01",
                    description="Desbroce terreno",
                    quantity=100.0,
                    unit="m2",
                    chapter="01"
                )
            ])
        elif response_schema == PricingEvaluatorResult:
            return PricingEvaluatorResult(
                razonamiento="Encaja perfecto.",
                selectedCandidateId="P01.01",
                requiresEstimation=False,
                calculatedUnitPrice=2.50
            )

    def get_embedding(self, text: str) -> List[float]:
        return [0.1, 0.2, 0.3]

class MockVectorSearch(IVectorSearch):
    def search_similar_items(self, query_vector: List[float], query_text: str = "", limit: int = 3, score_threshold: float = 0.5) -> List[Dict[str, Any]]:
        return [{
            "id": "P01.01",
            "code": "C-01.01",
            "name": "Desbroce terreno",
            "unit": "m2",
            "price": 2.50,
            "type": "LABOR"
        }]

class MockEmitter(IGenerationEmitter):
    def emit_event(self, lead_id: str, event_type: str, data: Dict[str, Any]) -> None:
        pass

class MockRepository(IBudgetRepository):
    def __init__(self):
        self.saved_budget = None
        
    def save(self, budget: Budget) -> None:
        self.saved_budget = budget

    def find_by_id(self, budget_id: str) -> Optional[Budget]:
        return self.saved_budget

def test_restructure_budget_use_case_execution():
    """Test full orchestration mocking LLM and DB."""
    mock_llm = MockLLMProvider()
    mock_vector = MockVectorSearch()
    mock_emitter = MockEmitter()
    mock_repo = MockRepository()

    use_case = RestructureBudgetUseCase(
        llm_provider=mock_llm,
        vector_search=mock_vector,
        emitter=mock_emitter,
        repository=mock_repo
    )

    raw_items = [{"text": "Fake raw extraction"}]
    
    # Execute the core workflow
    budget = use_case.execute(raw_items, lead_id="test_lead")

    assert budget is not None
    assert budget.leadId == "test_lead"
    assert len(budget.chapters) == 1
    
    chapter = budget.chapters[0]
    assert chapter.name == "Capítulo 01"
    assert len(chapter.items) == 1
    
    partida = chapter.items[0]
    assert partida.code == "01.01"
    assert partida.unitPrice == 2.50
    assert partida.quantity == 100.0
    assert partida.totalPrice == 250.0  # 100 * 2.50
    assert partida.isEstimate is False
    assert partida.matchConfidence == 85
    
    # Assert DB Save was called
    assert mock_repo.saved_budget is not None
    assert mock_repo.saved_budget.id == budget.id

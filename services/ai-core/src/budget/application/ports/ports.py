from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from typing import List, Dict, Any, Optional, Type
from pydantic import BaseModel

from src.budget.domain.entities import Budget, HeuristicFragment

class IHeuristicsRepository(ABC):
    """Port for Reinforcement Learning & In-Context Learning heuristics storage."""
    @abstractmethod
    def save(self, heuristic: HeuristicFragment, embedding: List[float] = None) -> None:
        """Saves a golden heuristic fragment along with its semantic embedding."""
        pass
        
    @abstractmethod
    def find_nearest_golden_rules(self, query_vector: List[float], limit: int = 5) -> List[HeuristicFragment]:
        """Retrieves the top-k golden heuristics semantically matching the query vector."""
        pass

class ILLMProvider(ABC):
    """Port for Language Model interactions (e.g. Gemini 2.5 Flash)."""
    @abstractmethod
    async def generate_structured(self, system_prompt: str, user_prompt: str, response_schema: Type[BaseModel], temperature: float = 0.2, model: str = "gemini-2.5-flash", image_base64: Optional[str] = None) -> tuple[BaseModel, Dict[str, int]]:
        """Generate structured output obeying a Pydantic schema. Can use an explicit cached context."""
        pass

    @abstractmethod
    async def get_embedding(self, text: str) -> List[float]:
        """Generate a dense vector embedding for a piece of text."""
        pass

class IVectorSearch(ABC):
    """Port for finding catalog matches in a Vector Database."""
    @abstractmethod
    async def search_similar_items(self, query_vector: List[float], query_text: str = "", limit: int = 3, score_threshold: float = 0.5, chapter_filters: List[str] = None) -> List[Dict[str, Any]]:
        """Returns a list of candidate items matching the query."""
        pass

class IGenerationEmitter(ABC):
    """Port for real-time streaming of progress events to the client."""
    @abstractmethod
    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        """Publishes an event to the underlying messaging system (e.g. Firestore, WebSockets)."""
        pass

class IBudgetRepository(ABC):
    """Port for persistence of the final Budget aggregate."""
    @abstractmethod
    def save(self, budget: Budget) -> None:
        """Saves a fully constructed Budget entity to the database."""
        pass
    
    @abstractmethod
    def find_by_id(self, budget_id: str) -> Optional[Budget]:
        """Retrieves a Budget by its ID."""
        pass

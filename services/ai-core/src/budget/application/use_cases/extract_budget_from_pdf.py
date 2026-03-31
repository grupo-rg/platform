from typing import Dict, Any, List
from abc import ABC, abstractmethod
from src.budget.domain.entities import Budget

class IPdfReader(ABC):
    """Port to read text/layout spatially from a PDF."""
    @abstractmethod
    def extract_text_with_layout(self, pdf_path_or_bytes: Any) -> List[Dict[str, Any]]:
        pass

class ExtractBudgetFromPdfUseCase:
    """Core Use Case for extracting raw text from PDF and parsing to a Domain Entity."""
    
    def __init__(self, pdf_reader: IPdfReader):
        self.pdf_reader = pdf_reader
        
    def execute(self, pdf_input: Any) -> Dict[str, Any]:
        """
        Extracts raw spatial text. (The LLM restructuring happens in a subsequent use case).
        """
        raw_text = self.pdf_reader.extract_text_with_layout(pdf_input)
        
        # At this point, the text is returned to the worker or next UseCase
        # This mirrors what you had previously where the extractor just read it roughly
        return {
            "status": "success",
            "extracted_text": raw_text
        }

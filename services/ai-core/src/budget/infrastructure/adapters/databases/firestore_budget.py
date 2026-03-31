import logging
from typing import Optional
from firebase_admin import firestore
from src.budget.application.ports.ports import IBudgetRepository
from src.budget.domain.entities import Budget

logger = logging.getLogger(__name__)

class FirestoreBudgetRepository(IBudgetRepository):
    """
    Adapter for Google Cloud Firestore.
    Provides methods to save the fully structured Budget.
    Assumes firebase_admin has already been initialized in the main Application lifecycle.
    """
    
    def __init__(self, collection_name: str = "budgets"):
        self.collection_name = collection_name
        self.db = firestore.client()

    def save(self, budget: Budget) -> None:
        """
        Saves the Pydantic Budget deeply to Firestore using subcollections.
        Bypasses the 1MB document max size limit.
        """
        try:
            budget_dict = budget.model_dump(by_alias=True, exclude_none=True)
            
            # Extract chapters to avoid 1MB limit on the root document
            chapters = budget_dict.pop("chapters", [])
            
            batch = self.db.batch()
            doc_ref = self.db.collection(self.collection_name).document(budget.id)
            
            # Save budget metadata
            batch.set(doc_ref, budget_dict)
            
            # Eliminate existing chapter subcollections to prevent duplicate accumulation on multiple inference runs
            existing_chapters = doc_ref.collection("chapters").limit(300).get()
            for doc in existing_chapters:
                batch.delete(doc.reference)
            
            # Save chapters as Subcollection
            for idx, chapter in enumerate(chapters):
                # Ensure chapter has a strict ID
                chap_id = str(chapter.get("id") or f"chapter_{idx}")
                chapter_ref = doc_ref.collection("chapters").document(chap_id)
                batch.set(chapter_ref, chapter)
                
            batch.commit()
            logger.info(f"Successfully saved Budget {budget.id} to Firestore (Subcollections applied).")
        except Exception as e:
            logger.error(f"Failed to save Budget {budget.id} to Firestore: {str(e)}")
            raise e

    def find_by_id(self, budget_id: str) -> Optional[Budget]:
        """Reads a budget from Firestore and reconstructs the Pydantic Domain entity (including subcollections)."""
        try:
            doc_ref = self.db.collection(self.collection_name).document(budget_id)
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                # Hydrate chapters from subcollection
                chapters_snap = doc_ref.collection("chapters").order_by("order").get()
                data["chapters"] = [c.to_dict() for c in chapters_snap]
                
                return Budget.model_validate(data)
            return None
            
        except Exception as e:
            logger.error(f"Failed to retrieve Budget {budget_id} from Firestore: {str(e)}")
            raise e

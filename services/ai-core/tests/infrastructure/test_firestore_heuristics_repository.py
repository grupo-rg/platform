import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime

from src.budget.domain.entities import (
    HeuristicFragment, 
    HeuristicContext,
    HeuristicAIInferenceTrace,
    HeuristicHumanCorrection
)
from src.budget.infrastructure.search.firestore_heuristics_repository import FirestoreHeuristicsRepository

def test_save_heuristic_with_embedding():
    mock_db = MagicMock()
    mock_collection = MagicMock()
    mock_db.collection.return_value = mock_collection
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    
    repo = FirestoreHeuristicsRepository(db_client=mock_db)
    
    fragment = HeuristicFragment(
        id="test_id",
        sourceType="internal_admin",
        status="golden",
        context=HeuristicContext(budgetId="b1"),
        aiInferenceTrace=HeuristicAIInferenceTrace(proposedUnitPrice=10.0),
        humanCorrection=HeuristicHumanCorrection(heuristicRule="Test rule"),
        timestamp=datetime.utcnow()
    )
    
    repo.save(fragment, embedding=[0.1, 0.2, 0.3])
    
    mock_db.collection.assert_called_once_with('training_heuristics')
    mock_collection.document.assert_called_once_with('test_id')
    
    args, _ = mock_doc.set.call_args
    saved_data = args[0]
    assert saved_data['id'] == "test_id"
    assert "embedding" in saved_data

def test_find_nearest_golden_rules():
    mock_db = MagicMock()
    mock_collection = MagicMock()
    mock_db.collection.return_value = mock_collection
    
    mock_vector_query = MagicMock()
    mock_collection.where.return_value.find_nearest.return_value = mock_vector_query
    
    mock_doc_snap = MagicMock()
    mock_doc_snap.to_dict.return_value = {
        "id": "match_1",
        "sourceType": "internal_admin",
        "status": "golden",
        "context": {"budgetId": "b1"},
        "aiInferenceTrace": {"proposedUnitPrice": 10.0},
        "humanCorrection": {"heuristicRule": "Match rule"},
        "timestamp": datetime.utcnow()
    }
    
    # Simulate chaining: .find_nearest().get()
    mock_vector_query.get.return_value = [mock_doc_snap]
    
    repo = FirestoreHeuristicsRepository(db_client=mock_db)
    results = repo.find_nearest_golden_rules([0.1, 0.2, 0.3], limit=2)
    
    assert len(results) == 1
    assert results[0].id == "match_1"
    assert results[0].humanCorrection.heuristicRule == "Match rule"

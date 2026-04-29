import asyncio
import json
import os
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv
from src.budget.infrastructure.adapters.databases.firestore_price_book import FirestorePriceBookAdapter
from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter

async def main():
    load_dotenv()
    
    if not firebase_admin._apps:
        project_id = os.environ.get("FIREBASE_PROJECT_ID", "")
        private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "")
        client_email = os.environ.get("FIREBASE_CLIENT_EMAIL", "")
        if private_key:
            formatted_private_key = private_key.replace('\\n', '\n')
            cred = credentials.Certificate({
                "type": "service_account",
                "project_id": project_id,
                "private_key": formatted_private_key,
                "client_email": client_email,
                "token_uri": "https://oauth2.googleapis.com/token",
            })
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()
            
    # Initialize the adapters
    gemini = GoogleGenerativeAIAdapter()
    db = FirestorePriceBookAdapter()

    # The query we want to search for
    query_text = "Acondicionamiento de la entrada del solar para camiones"
    print(f"1. Getting embedding for query: '{query_text}'")
    
    try:
        query_vector = await gemini.get_embedding(query_text)
        print(f"2. Got vector of length {len(query_vector)}")
    except Exception as e:
        print(f"Failed to get embedding: {e}")
        return

    print("3. Querying Firestore vector database...")
    try:
        results = db.search_similar_items(query_vector, query_text, limit=1)
        
        print("\n--- RAW DATABASE RESULT ENTIRE DICTIONARY ---")
        if results:
            # Print the raw dict natively
            print(results[0])
            print("\n--- KEYS AVAILABLE ---")
            print(list(results[0].keys()))
        else:
            print("No results found.")
            
    except Exception as e:
        print(f"Failed to query database: {e}")

if __name__ == "__main__":
    asyncio.run(main())

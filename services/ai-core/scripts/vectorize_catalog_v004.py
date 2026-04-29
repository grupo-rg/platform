import os
import json
import logging
import asyncio
import httpx
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.vector import Vector
from google.oauth2 import service_account
from google.auth.transport.requests import Request
import uuid

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load .env variables
load_dotenv(".env")

class VertexBatchEmbedder:
    def __init__(self):
        project_id = os.environ.get("FIREBASE_PROJECT_ID")
        client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
        private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace('\\n', '\n')
        
        info = {
            "type": "service_account",
            "project_id": project_id,
            "private_key_id": "auto",
            "private_key": private_key,
            "client_email": client_email,
            "client_id": "auto",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": f"https://www.googleapis.com/robot/v1/metadata/x509/{client_email.replace('@', '%40')}"
        }
        
        scopes = ['https://www.googleapis.com/auth/cloud-platform']
        self.credentials = service_account.Credentials.from_service_account_info(info, scopes=scopes)
        
        # Also init Firebase Admin
        try:
            cred = credentials.Certificate(info)
            firebase_admin.initialize_app(cred)
        except ValueError:
            pass # Already initialized
            
        self.db = firestore.client()
        
    async def get_embeddings(self, texts: list[str]) -> list[list[float]]:
        if not self.credentials.valid:
            self.credentials.refresh(Request())
            
        url = "https://us-central1-aiplatform.googleapis.com/v1/projects/local-digital-eye/locations/us-central1/publishers/google/models/text-embedding-004:predict"
        
        instances = [{"content": t} for t in texts]
        payload = {"instances": instances}
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.credentials.token}'
        }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.error(f"Vertex API Error: {resp.text}")
            resp.raise_for_status()
            data = resp.json()
            
        return [pred["embeddings"]["values"] for pred in data["predictions"]]

async def main():
    embedder = VertexBatchEmbedder()
    collection_name = "price_book_v004"
    
    # Load atomic catalog items
    catalog_path = r"c:\Users\Usuario\Documents\github\works\nexoai\prices\new\2025_complete.json"
    with open(catalog_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    items = []
    for chapter in data:
        for item in chapter.get("items", []):
            items.append(item)
            
    logger.info(f"Loaded {len(items)} atomic pricing items from JSON catalog. Commencing resume at index 450.")
    items = items[450:]
    batch_size = 25 # Reduced from 50 to prevent exceeding the 20,000 token limit of text-embedding-004
    total_embedded = 0
    
    col_ref = embedder.db.collection(collection_name)
    
    for i in range(0, len(items), batch_size):
        batch_items = items[i:i+batch_size]
        texts = [f"{item.get('chapter', '')} - {item.get('section', '')} - {item.get('code', '')}: {item.get('description', '')}" for item in batch_items]
        
        try:
            embeddings_matrix = await embedder.get_embeddings(texts)
            
            # Firestore batch write (max 500 per batch)
            db_batch = embedder.db.batch()
            for item, vector in zip(batch_items, embeddings_matrix):
                doc_ref = col_ref.document()
                item['embedding'] = Vector(vector)
                db_batch.set(doc_ref, item)
            
            db_batch.commit()
            total_embedded += len(batch_items)
            logger.info(f"Commit batch {i} to {i+len(batch_items)} / {len(items)} to Firestore {collection_name}")
            
        except Exception as e:
            logger.error(f"Failed embedding batch {i}-{i+len(batch_items)}: {e}")
            break
            
    logger.info(f"✅ Master upload complete! Total vectors in {collection_name}: {total_embedded}")

if __name__ == "__main__":
    asyncio.run(main())

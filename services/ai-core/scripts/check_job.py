import os
import asyncio
from dotenv import load_dotenv
import time

load_dotenv()

async def check_job():
    from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter
    adapter = GoogleGenerativeAIAdapter()
    job_id = "batches/kvkzwzizl3s4qurrkr8avntgf62mk3u6adqs"
    
    while True:
        try:
            print(f"[{time.strftime('%H:%M:%S')}] Buscando status de {job_id}...")
            status = await adapter.poll_batch_status(job_id)
            print(f"[{time.strftime('%H:%M:%S')}] Status actual: {status}")
            
            if status in ['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']:
                print(f"Job ha terminado con estado: {status}. Saliendo del monitor.")
                break
                
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] Error al consultar: {e}")
            
        await asyncio.sleep(300) # Sleep 5 minutes

if __name__ == "__main__":
    asyncio.run(check_job())

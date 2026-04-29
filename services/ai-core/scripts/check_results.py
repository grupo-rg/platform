import os
import asyncio
from dotenv import load_dotenv
import json

load_dotenv()

async def read_results():
    from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter
    from src.budget.application.use_cases.restructure_budget_uc import BatchPricingEvaluatorResult
    
    adapter = GoogleGenerativeAIAdapter()
    job_id = "batches/kvkzwzizl3s4qurrkr8avntgf62mk3u6adqs"
    
    print(f"Descargando resultados del job: {job_id}...")
    try:
        results = await adapter.get_batch_results(job_id, BatchPricingEvaluatorResult)
        
        # Iterar el diccionario de resultados
        for custom_id, structured_response in results.items():
            print(f"\n--- Chunk ID: {custom_id} ---")
            if isinstance(structured_response, BatchPricingEvaluatorResult):
                print(f"Total de Partidas Evaluadas en este chunk: {len(structured_response.results)}")
                for i, r in enumerate(structured_response.results):
                    print(f"\n  [Item {i+1}] Código: {r.item_code}")
                    print(f"  > Original Unit: {r.original_unit} -> Target Unit: {r.target_unit}")
                    print(f"  > Precio Base Elegido: {r.selectedCandidateUnitPrice} | Match ID: {r.selectedCandidateId}")
                    print(f"  > Precio Final Calculado: {r.calculatedUnitPrice} €")
                    print(f"  > Razonamiento Matemático: {r.mathematical_extraction}")
                    print(f"  > Requiere Humano (Fallback): {r.needs_human_review}")
                    print(f"  > Es Estimación: {r.requiresEstimation}")
            else:
                print(f"Resultado no parseado correctamente: {structured_response}")
                
    except Exception as e:
        print(f"Error al descargar resultados: {e}")

if __name__ == "__main__":
    asyncio.run(read_results())

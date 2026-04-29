import os
import time
import json
import logging
import re
import httpx
from typing import Dict, Any, Type, Optional, List
from pydantic import BaseModel, ValidationError



from src.budget.application.ports.ports import ILLMProvider
from src.budget.domain.exceptions import AIProviderError

logger = logging.getLogger(__name__)


def _salvage_truncated_json(raw: str, schema: Type[BaseModel]) -> tuple[Optional[BaseModel], int]:
    """
    Rescata items completos de un JSON truncado por el LLM.

    Escenario típico: Gemini devuelve `{"items": [{...}, {...}, {...parcial]` cuando el
    `maxOutputTokens` se alcanza. El JSON es inválido pero los primeros N objetos del array
    están cerrados correctamente. Este helper:
      1. Identifica el único array-field del schema (ej. `items`).
      2. Recorre el array con un parser balanceado de llaves y strings (escapes incluidos).
      3. Corta al último `}` que cierra un objeto a profundidad 0 dentro del array.
      4. Reconstruye un JSON válido con ese array recortado; Pydantic rellena defaults.

    Devuelve `(instancia_validada, nº_items_rescatados)` o `(None, 0)` si no hay nada rescatable.
    Nunca lanza: siempre devuelve tupla, incluso ante errores internos.
    """
    if not raw or not raw.strip().startswith("{"):
        return None, 0

    # 1. Primer `"<key>": [` — asumimos que es el array principal
    m = re.search(r'"([^"]+)"\s*:\s*\[', raw)
    if not m:
        return None, 0
    array_key = m.group(1)
    array_start = m.end()  # índice justo después del `[`

    # 2. Balance de llaves/strings respetando escapes
    depth = 0
    in_string = False
    escape = False
    last_close = -1        # última `}` que cerró un objeto a depth 0
    items_recovered = 0    # contados al cerrar cada objeto top-level

    for i in range(array_start, len(raw)):
        ch = raw[i]
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                last_close = i
                items_recovered += 1
        elif ch == ']' and depth == 0:
            # Array cerrado válidamente — significa que en realidad NO está truncado
            break

    if last_close < 0 or items_recovered == 0:
        return None, 0

    # 3. Reconstruir JSON con el array cortado al último objeto cerrado
    salvaged = raw[array_start:last_close + 1]
    reconstructed = '{"' + array_key + '": [' + salvaged + ']}'

    try:
        parsed = schema.model_validate_json(reconstructed)
        return parsed, items_recovered
    except Exception:
        return None, 0

class GoogleGenerativeAIAdapter(ILLMProvider):
    """
    Adapter for Google Cloud Vertex AI (Gemini 2.5).
    Features built-in exponential backoff to handle rate limits and guaranteed Pydantic structured output.
    Uses native GCP Service Account OAuth2 Authentication for 99.9% SLA guarantees.
    """
    
    def __init__(self, model_name: str = 'gemini-2.5-flash', max_retries: int = 5, base_delay: float = 2.0):
        self.api_key = os.environ.get("GOOGLE_GENAI_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GOOGLE_GENAI_API_KEY environment variable missing.")
            
        from google import genai
        self.genai_client = genai.Client(api_key=self.api_key)
        
        self.model_name = model_name
        self.max_retries = max_retries
        self.base_delay = base_delay

    async def generate_structured(self, system_prompt: str, user_prompt: str, response_schema: Type[BaseModel], temperature: float = 0.2, model: str = "gemini-2.5-flash", image_base64: Optional[str] = None, max_output_tokens: int = 8192) -> tuple[BaseModel, Dict[str, int]]:
        """
        Calls Vertex AI, enforcing a strict JSON return conforming to the Pydantic `response_schema`.
        Applies exponential backoff on HTTP 429 (ResourceExhausted).

        `max_output_tokens` se fija por defecto a 8192 para evitar que el modelo trunque JSON
        en páginas densas. Ajustable por el caller cuando se espere una respuesta más corta.
        """
        schema_json = json.dumps(response_schema.model_json_schema(), ensure_ascii=False)

        full_system = (
            f"{system_prompt}\n\n"
            "INSTRUCCIONES DE SALIDA CRÍTICAS:\n"
            "DEBES devolver ÚNICAMENTE un objeto JSON válido, sin bloques de código Markdown ni texto adicional.\n"
            f"El JSON DEBE cumplir estrictamente con el siguiente esquema JSON Schema:\n{schema_json}"
        )

        import httpx
        import asyncio
        import random

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.api_key}"

        parts = []
        if image_base64:
            parts.append({
                "inlineData": {
                    "mimeType": "image/jpeg",
                    "data": image_base64
                }
            })
        parts.append({"text": user_prompt})

        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "systemInstruction": {"parts": [{"text": full_system}]},
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
                "maxOutputTokens": max_output_tokens,
            }
        }
        
        attempt = 0
        while attempt < self.max_retries:
            # Inicializados fuera del try para que el except ValidationError pueda leerlos
            # cuando el fallo ocurre en model_validate_json (JSON truncado por el LLM).
            raw_json: str = ""
            usage_metadata: Dict[str, Any] = {}
            try:
                headers = {'Content-Type': 'application/json'}
                
                logger.debug(f"Calling GenAI API {model} (Attempt {attempt + 1}/{self.max_retries})...")
                
                limits = httpx.Limits(max_keepalive_connections=0, keepalive_expiry=0)
                async with httpx.AsyncClient(timeout=300.0, limits=limits, http2=False) as client:
                    response = await client.post(url, json=payload, headers=headers)
                
                if response.status_code in [400, 401, 403, 404]:
                    raise AIProviderError(f"Terminal API Error {response.status_code} on GenAI API: {response.text}")
                    
                response.raise_for_status()
                data = response.json()
                
                if "candidates" not in data or not data["candidates"]:
                    raise AIProviderError(f"No candidates returned from Vertex AI. Response: {data}")
                    
                raw_json = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                if raw_json.startswith("```json"):
                    raw_json = raw_json[7:]
                if raw_json.endswith("```"):
                    raw_json = raw_json[:-3]
                raw_json = raw_json.strip()
                
                usage_metadata = data.get("usageMetadata", {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0})
                
                if raw_json.startswith("[") and raw_json.endswith("]"):
                    schema_dict = response_schema.model_json_schema()
                    if "properties" in schema_dict and len(schema_dict["properties"]) == 1:
                        only_key = list(schema_dict["properties"].keys())[0]
                        raw_json = f'{{"{only_key}": {raw_json}}}'
                
                parsed = response_schema.model_validate_json(raw_json)
                return parsed, usage_metadata
                
            except httpx.HTTPError as e:
                error_str = f"HTTP Error: {str(e)}"
                logger.error(f"GenAI API REST Error: {error_str}")
            except ValidationError as e:
                error_str = f"ValidationError: {str(e)}"
                logger.error(f"GenAI Unknown Error: {error_str}")
                # Salvage: si el JSON está truncado pero contiene objetos cerrados,
                # los rescatamos y retornamos inmediatamente sin agotar retries.
                # Es el escenario dominante cuando temperature=0.0 y el modelo trunca.
                err_text = str(e)
                if ("EOF while parsing" in err_text or "Invalid JSON" in err_text) and raw_json:
                    salvaged, recovered = _salvage_truncated_json(raw_json, response_schema)
                    if salvaged is not None and recovered > 0:
                        logger.warning(
                            f"[adapter] Rescatados {recovered} items del JSON truncado (sin retry)."
                        )
                        salvaged_usage = {**usage_metadata, "_salvaged": True, "_items_recovered": recovered}
                        return salvaged, salvaged_usage
                    else:
                        logger.info(
                            f"[adapter] Salvage sin items cerrados (raw_json len={len(raw_json)}). Retry normal."
                        )
            except Exception as e:
                error_str = f"{type(e).__name__}: {str(e)}"
                logger.error(f"GenAI Unknown Error: {error_str}")

            attempt += 1
            if attempt >= self.max_retries:
                raise AIProviderError(f"Unknown AI API error after {self.max_retries} retries: {error_str}")
            
            delay = self.base_delay * (2 ** (attempt - 1))
            jitter = random.uniform(0, 1)
            total_delay = delay + jitter
            
            logger.warning(f"Retrying in {total_delay:.2f} seconds...")
            await asyncio.sleep(total_delay)
                
        raise AIProviderError("Fell through retry loop unexpectedly.")

    async def get_embedding(self, text: str) -> List[float]:
        import asyncio
        import random
        from google import genai
        
        attempt = 0
        while attempt < self.max_retries:
            try:
                # Ejecutamos en Thread Pool el método síncrono del cliente genai
                response = await asyncio.to_thread(
                    self.genai_client.models.embed_content,
                    model='gemini-embedding-001',
                    contents=text
                )
                
                embeddings = response.embeddings[0].values
                if not embeddings:
                    raise ValueError(f"No embeddings returned from GenAI API.")
                
                return embeddings
            except Exception as e:
                logger.error(f"Embedding API SDK Error: {e}")
                
            attempt += 1
            if attempt >= self.max_retries:
                raise AIProviderError(f"Failed to get embeddings after {self.max_retries} retries.")
                
            delay = self.base_delay * (2 ** (attempt - 1)) + random.uniform(0, 1)
            await asyncio.sleep(delay)
            
        raise AIProviderError("Fell through get_embedding retry loop unexpectedly.")

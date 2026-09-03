import asyncio
import collections
import os
import time
import json
import logging
import re
from typing import Deque, Dict, Any, Type, Optional, List
from pydantic import BaseModel, ValidationError



from src.budget.application.ports.ports import ILLMProvider
from src.budget.domain.exceptions import AIProviderError
from src.budget.infrastructure.config.model_registry import get_model

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# S2-A-02 — Circuit breaker para Gemini.
#
# Objetivo: si Gemini falla repetidamente (>3 fallos en 5 min), abrimos el
# circuit para no quemar más tokens en una API rota. Durante 2 min en
# `degraded`, todas las llamadas devuelven None inmediatamente. Tras 2 min,
# probamos una call ("half-open"); si OK → `healthy`, si falla → reset el
# período de 2 min.
#
# Estados:
#   healthy: comportamiento normal.
#   degraded: las llamadas devuelven None sin tocar la API.
#   half_open: la próxima call será la única que llegue a la API; si
#     funciona pasamos a healthy, si falla volvemos a degraded.
#
# Compartido entre instancias (módulo-level) porque DI usa un singleton del
# adapter. Si hay tests paralelos que necesitan aislamiento, usar
# `_reset_circuit_for_tests`.
# ---------------------------------------------------------------------------


CIRCUIT_HEALTHY = "healthy"
CIRCUIT_DEGRADED = "degraded"
CIRCUIT_HALF_OPEN = "half_open"

# Ventana en la que contamos fallos consecutivos antes de abrir el circuit.
_CIRCUIT_FAILURE_WINDOW_SECONDS: float = 300.0  # 5 min
# Número de fallos en la ventana para abrir el circuit.
_CIRCUIT_FAILURE_THRESHOLD: int = 3
# Tiempo que mantenemos el circuit `degraded` antes de pasar a `half_open`.
_CIRCUIT_OPEN_DURATION_SECONDS: float = 120.0  # 2 min


class _CircuitBreaker:
    """Stateful breaker compartido vía singleton de módulo.

    Thread-unsafe deliberadamente (asyncio single-thread). Cualquier acceso
    es desde el event loop principal del worker.
    """

    def __init__(self) -> None:
        # Timestamps de los últimos fallos. Sólo guardamos los más recientes
        # (deque con maxlen=20 — suficiente para la ventana de 5 min).
        self.failure_timestamps: Deque[float] = collections.deque(maxlen=20)
        self.state: str = CIRCUIT_HEALTHY
        # Cuándo entramos a `degraded`. Usado para decidir half-open transition.
        self.opened_at: float = 0.0

    def record_success(self) -> None:
        """Llamada exitosa: limpia el historial y vuelve a healthy."""
        self.failure_timestamps.clear()
        if self.state != CIRCUIT_HEALTHY:
            logger.info(
                f"[circuit_breaker] success in state={self.state!r}; "
                f"transitioning to healthy"
            )
        self.state = CIRCUIT_HEALTHY
        self.opened_at = 0.0

    def record_failure(self) -> None:
        """Llamada fallida: graba timestamp y, si supera el threshold dentro
        de la ventana, abre el circuit."""
        now = time.monotonic()
        # Garbage-collect timestamps fuera de la ventana antes de añadir.
        cutoff = now - _CIRCUIT_FAILURE_WINDOW_SECONDS
        while self.failure_timestamps and self.failure_timestamps[0] < cutoff:
            self.failure_timestamps.popleft()
        self.failure_timestamps.append(now)

        if (
            self.state in (CIRCUIT_HEALTHY, CIRCUIT_HALF_OPEN)
            and len(self.failure_timestamps) >= _CIRCUIT_FAILURE_THRESHOLD
        ):
            # Abrimos el circuit.
            self.state = CIRCUIT_DEGRADED
            self.opened_at = now
            logger.warning(
                f"[circuit_breaker] OPEN — {len(self.failure_timestamps)} failures "
                f"in last {_CIRCUIT_FAILURE_WINDOW_SECONDS:.0f}s; entering degraded "
                f"for {_CIRCUIT_OPEN_DURATION_SECONDS:.0f}s"
            )

    def should_allow_call(self) -> bool:
        """Returns True si se permite la llamada al API; False si el circuit
        está abierto y aún en período de degradación.

        Side-effect: si llevamos en `degraded` más de `_CIRCUIT_OPEN_DURATION_SECONDS`,
        transicionamos a `half_open` y devolvemos True (esa próxima call
        será la única que llegue al API hasta que sepamos su resultado).
        """
        if self.state == CIRCUIT_HEALTHY:
            return True
        if self.state == CIRCUIT_HALF_OPEN:
            # Ya estamos en half-open: solo permitimos UNA llamada de
            # prueba a la vez. Aquí siempre permitimos (la primera call
            # registrará success o failure y transicionará).
            return True
        # degraded.
        now = time.monotonic()
        if (now - self.opened_at) >= _CIRCUIT_OPEN_DURATION_SECONDS:
            self.state = CIRCUIT_HALF_OPEN
            logger.info(
                f"[circuit_breaker] degraded → half_open after "
                f"{_CIRCUIT_OPEN_DURATION_SECONDS:.0f}s; attempting probe call"
            )
            return True
        # Aún degraded — bloquear.
        return False


# Singleton del breaker (compartido entre instancias del adapter).
_circuit_breaker = _CircuitBreaker()


def get_circuit_breaker() -> _CircuitBreaker:
    """Accessor para tests y diagnostics. Devuelve la instancia módulo-level."""
    return _circuit_breaker


def _reset_circuit_for_tests() -> None:
    """Resetea el breaker — solo para tests."""
    global _circuit_breaker
    _circuit_breaker = _CircuitBreaker()


# S1-A-06 — defaults para el timeout y los retries por llamada LLM.
# Antes del Sprint 1 el adapter sólo tenía `httpx timeout=300s` total (incluyendo
# todos los retries), y `max_retries=5` por defecto. El incidente 2026-05-18
# reveló que un retry colgado bloquea un slot del semaphore indefinidamente.
# Solución: timeout duro por intento + max_retries explícito y bajo.
_DEFAULT_LLM_CALL_TIMEOUT_SECONDS: float = 60.0
_DEFAULT_LLM_CALL_MAX_RETRIES: int = 2


def _read_llm_call_timeout_seconds() -> float:
    """Lee `LLM_CALL_TIMEOUT_SECONDS` del entorno; usa default si no está set
    o si el valor es inválido. Acepta floats (3.5) o ints (60).
    """
    raw = (os.environ.get("LLM_CALL_TIMEOUT_SECONDS") or "").strip()
    if not raw:
        return _DEFAULT_LLM_CALL_TIMEOUT_SECONDS
    try:
        v = float(raw)
        # Sanity: rechaza valores absurdos (≤0 o >600). Cae a default.
        if v <= 0 or v > 600:
            logger.warning(
                "LLM_CALL_TIMEOUT_SECONDS=%s fuera de rango (0,600]; usando default %.1f",
                raw, _DEFAULT_LLM_CALL_TIMEOUT_SECONDS,
            )
            return _DEFAULT_LLM_CALL_TIMEOUT_SECONDS
        return v
    except ValueError:
        logger.warning(
            "LLM_CALL_TIMEOUT_SECONDS=%s no es float válido; usando default %.1f",
            raw, _DEFAULT_LLM_CALL_TIMEOUT_SECONDS,
        )
        return _DEFAULT_LLM_CALL_TIMEOUT_SECONDS


def _read_llm_call_max_retries() -> int:
    """Lee `LLM_CALL_MAX_RETRIES` del entorno; default = 2."""
    raw = (os.environ.get("LLM_CALL_MAX_RETRIES") or "").strip()
    if not raw:
        return _DEFAULT_LLM_CALL_MAX_RETRIES
    try:
        v = int(raw)
        if v < 1 or v > 10:
            logger.warning(
                "LLM_CALL_MAX_RETRIES=%s fuera de rango [1,10]; usando default %d",
                raw, _DEFAULT_LLM_CALL_MAX_RETRIES,
            )
            return _DEFAULT_LLM_CALL_MAX_RETRIES
        return v
    except ValueError:
        logger.warning(
            "LLM_CALL_MAX_RETRIES=%s no es int válido; usando default %d",
            raw, _DEFAULT_LLM_CALL_MAX_RETRIES,
        )
        return _DEFAULT_LLM_CALL_MAX_RETRIES


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
    
    def __init__(
        self,
        model_name: str = 'gemini-2.5-flash',
        max_retries: Optional[int] = None,
        base_delay: float = 2.0,
        per_call_timeout_seconds: Optional[float] = None,
    ):
        # Vertex AI (Gemini Enterprise Agent Platform): pago por uso vía la cuenta
        # de facturación de GCP, autenticado con ADC del service-account de runtime
        # (Cloud Run) o `gcloud auth application-default login` (local). Ya no se usa
        # la Gemini Developer API / API key (saldo prepago agotado).
        self.project = (
            os.environ.get("GOOGLE_CLOUD_PROJECT")
            or os.environ.get("GCLOUD_PROJECT")
            or os.environ.get("FIREBASE_PROJECT_ID")
        )
        self.location = os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-southwest1")
        if not self.project:
            raise ValueError(
                "GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT / FIREBASE_PROJECT_ID missing for Vertex AI."
            )

        from google import genai
        self.genai_client = genai.Client(
            vertexai=True, project=self.project, location=self.location
        )

        self.model_name = model_name
        # S1-A-06 — defaults configurables vía env vars. Las llamadas pueden
        # seguir pasando un override explícito (tests).
        self.max_retries = (
            max_retries if max_retries is not None else _read_llm_call_max_retries()
        )
        self.base_delay = base_delay
        self.per_call_timeout_seconds = (
            per_call_timeout_seconds
            if per_call_timeout_seconds is not None
            else _read_llm_call_timeout_seconds()
        )

    async def generate_structured(self, system_prompt: str, user_prompt: str, response_schema: Type[BaseModel], temperature: float = 0.2, model: str = "gemini-2.5-flash", image_base64: Optional[str] = None, max_output_tokens: int = 32768) -> tuple[BaseModel, Dict[str, int]]:
        """
        Calls Vertex AI, enforcing a strict JSON return conforming to the Pydantic `response_schema`.
        Applies exponential backoff on HTTP 429 (ResourceExhausted).

        `max_output_tokens` se fija por defecto a 32768. El máximo de gemini-2.5-flash es 65535,
        pero 32k cubre con margen briefs complejos (Architect con 50+ tareas o pages PDF densas).
        Con el valor previo de 8192 el modelo truncaba JSON a mitad de string en reformas
        multi-habitación → ValidationError EOF → retries de salida igual de truncada.
        Ajustable por el caller cuando se espere una respuesta más corta.

        S2-A-02 — Circuit breaker:
          Si el breaker está en `degraded` (>3 fallos en 5 min, dentro de los
          últimos 2 min), devolvemos `(None_placeholder, {})` SIN llamar a la
          API. El caller que use el resultado debe manejar el caso None (la
          mayoría de los callers en el swarm ya lo hacen vía try/except o
          chequeo `if eval_res and eval_res.results`).
        """
        # S2-A-02 — circuit breaker check antes de cualquier trabajo.
        # Si el circuit está abierto, retornamos None inmediatamente.
        # IMPORTANTE: el contract de ILLMProvider.generate_structured es
        # tuple[BaseModel, dict]. Para no romper el tipado, levantamos un
        # AIProviderError específico que los call sites del swarm ya
        # capturan (igual que cualquier otro fallo del LLM).
        if not _circuit_breaker.should_allow_call():
            raise AIProviderError(
                "circuit_breaker_open: Gemini in degraded state; "
                f"retry in {max(0.0, _CIRCUIT_OPEN_DURATION_SECONDS - (time.monotonic() - _circuit_breaker.opened_at)):.0f}s"
            )

        schema_json = json.dumps(response_schema.model_json_schema(), ensure_ascii=False)

        full_system = (
            f"{system_prompt}\n\n"
            "INSTRUCCIONES DE SALIDA CRÍTICAS:\n"
            "DEBES devolver ÚNICAMENTE un objeto JSON válido, sin bloques de código Markdown ni texto adicional.\n"
            f"El JSON DEBE cumplir estrictamente con el siguiente esquema JSON Schema:\n{schema_json}"
        )

        import asyncio
        import random
        import base64
        from google.genai import types
        from google.genai import errors as genai_errors

        # Contenidos + config para el SDK google-genai en modo Vertex.
        parts: List[Any] = []
        if image_base64:
            parts.append(
                types.Part(
                    inline_data=types.Blob(
                        mime_type="image/jpeg",
                        data=base64.b64decode(image_base64),
                    )
                )
            )
        parts.append(types.Part(text=user_prompt))
        contents = [types.Content(role="user", parts=parts)]

        gen_config = types.GenerateContentConfig(
            temperature=temperature,
            response_mime_type="application/json",
            max_output_tokens=max_output_tokens,
            system_instruction=full_system,
        )
        
        attempt = 0
        while attempt < self.max_retries:
            # Inicializados fuera del try para que el except ValidationError pueda leerlos
            # cuando el fallo ocurre en model_validate_json (JSON truncado por el LLM).
            raw_json: str = ""
            usage_metadata: Dict[str, Any] = {}
            try:
                logger.debug(f"Calling Vertex AI {model} (Attempt {attempt + 1}/{self.max_retries})...")

                # S1-A-06 - per-call timeout via `asyncio.wait_for`. Sin esto, un
                # retry interno del SDK puede bloquear el slot del semaphore del
                # swarm indefinidamente (incidente 2026-05-18). Al expirar lanzamos
                # `asyncio.TimeoutError`, capturado por el except de abajo.
                call_started_at = time.monotonic()
                response = await asyncio.wait_for(
                    self.genai_client.aio.models.generate_content(
                        model=model, contents=contents, config=gen_config
                    ),
                    timeout=self.per_call_timeout_seconds,
                )

                if not response.candidates:
                    raise AIProviderError(f"No candidates returned from Vertex AI. Response: {response}")

                candidate = response.candidates[0]
                _content = getattr(candidate, "content", None)
                _parts = getattr(_content, "parts", None) if _content else None
                raw_json = (_parts[0].text or "").strip() if (_parts and _parts[0].text) else ""
                if raw_json.startswith("```json"):
                    raw_json = raw_json[7:]
                if raw_json.endswith("```"):
                    raw_json = raw_json[:-3]
                raw_json = raw_json.strip()

                # finishReason != STOP indica truncado/bloqueo (p.ej. MAX_TOKENS
                # deja el JSON truncado). Lo loggeamos antes de parsear.
                finish_reason = getattr(candidate, "finish_reason", None)
                finish_reason_str = getattr(finish_reason, "name", None) or (str(finish_reason) if finish_reason is not None else None)
                if finish_reason_str and finish_reason_str != "STOP":
                    logger.warning(
                        f"[adapter] finishReason={finish_reason_str} (model={model}, "
                        f"max_output_tokens={max_output_tokens}, raw_len={len(raw_json)}). "
                        f"Si es MAX_TOKENS, subir max_output_tokens."
                    )

                _um = getattr(response, "usage_metadata", None)
                usage_metadata = {
                    "promptTokenCount": getattr(_um, "prompt_token_count", 0) or 0,
                    "candidatesTokenCount": getattr(_um, "candidates_token_count", 0) or 0,
                    "totalTokenCount": getattr(_um, "total_token_count", 0) or 0,
                } if _um else {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0}
                
                if raw_json.startswith("[") and raw_json.endswith("]"):
                    schema_dict = response_schema.model_json_schema()
                    if "properties" in schema_dict and len(schema_dict["properties"]) == 1:
                        only_key = list(schema_dict["properties"].keys())[0]
                        raw_json = f'{{"{only_key}": {raw_json}}}'
                
                parsed = response_schema.model_validate_json(raw_json)
                # S2-A-02 — éxito: limpia el contador del circuit breaker.
                _circuit_breaker.record_success()
                return parsed, usage_metadata

            except asyncio.TimeoutError:
                # S1-A-06 — per-call timeout. Loggeamos elapsed real para que el
                # operador pueda calibrar `LLM_CALL_TIMEOUT_SECONDS`. Marcamos
                # con un prefijo claro para grep en Cloud Logging.
                elapsed = time.monotonic() - call_started_at
                error_str = (
                    f"llm_call_timeout: model={model} elapsed={elapsed:.1f}s "
                    f"> timeout={self.per_call_timeout_seconds:.1f}s "
                    f"(attempt {attempt + 1}/{self.max_retries})"
                )
                logger.warning(error_str)
            except genai_errors.APIError as e:
                code = getattr(e, "code", None)
                if code in (400, 401, 403, 404):
                    # S2-A-02 - terminal error: cuenta como failure y abre el
                    # circuit rapido para no quemar recursos.
                    _circuit_breaker.record_failure()
                    raise AIProviderError(f"Terminal API Error {code} on Vertex AI: {e}")
                error_str = f"Vertex API Error {code}: {e}"
                logger.error(f"Vertex AI Error: {error_str}")
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
                        # S2-A-02 — salvage cuenta como éxito (la API respondió,
                        # solo el output estaba truncado pero usable).
                        _circuit_breaker.record_success()
                        return salvaged, salvaged_usage
                    else:
                        # Cuando salvage falla, dumpeamos los últimos 200 chars del raw_json
                        # para entender por qué (a veces el modelo emite un solo item
                        # gigante o un schema con anidaciones inesperadas).
                        tail = raw_json[-200:] if len(raw_json) > 200 else raw_json
                        logger.info(
                            f"[adapter] Salvage sin items cerrados (raw_json len={len(raw_json)}). "
                            f"Tail: ...{tail!r}. Retry normal."
                        )
            except Exception as e:
                error_str = f"{type(e).__name__}: {str(e)}"
                logger.error(f"GenAI Unknown Error: {error_str}")

            attempt += 1
            if attempt >= self.max_retries:
                # S2-A-02 — agotamos retries: marcamos un fallo en el circuit
                # breaker. Si llevamos >3 fallos en 5 min, el próximo call
                # se bloqueará en `should_allow_call`.
                _circuit_breaker.record_failure()
                raise AIProviderError(f"Unknown AI API error after {self.max_retries} retries: {error_str}")

            delay = self.base_delay * (2 ** (attempt - 1))
            jitter = random.uniform(0, 1)
            total_delay = delay + jitter

            logger.warning(f"Retrying in {total_delay:.2f} seconds...")
            await asyncio.sleep(total_delay)

        # S2-A-02 — defensa adicional (no debería llegar aquí).
        _circuit_breaker.record_failure()
        raise AIProviderError("Fell through retry loop unexpectedly.")

    async def get_embedding(self, text: str) -> List[float]:
        import asyncio
        import random
        from google.genai import types

        attempt = 0
        while attempt < self.max_retries:
            try:
                # Ejecutamos en Thread Pool el método síncrono del cliente genai.
                # Phase 0 — el id del modelo de embeddings viene del registry
                # configurable (``model_registry/embedding``), TTL-cached y
                # no-fatal; cae a ``gemini-embedding-001`` si no hay doc.
                # output_dimensionality=768 se mantiene FIJO para casar con los
                # vectores ya almacenados en Firestore (gemini-embedding-001 @768)
                # — NUNCA lo decide el registry (cambiar dims invalida vectores).
                embedding_model = get_model(
                    "embedding", default_model_id="gemini-embedding-001"
                ).model_id
                response = await asyncio.to_thread(
                    self.genai_client.models.embed_content,
                    model=embedding_model,
                    contents=text,
                    config=types.EmbedContentConfig(output_dimensionality=768),
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

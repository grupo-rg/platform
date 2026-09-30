"""Configuración de generación por FAMILIA de modelo Gemini (2.5 vs 3.x).

Punto único donde se decide qué parámetros se mandan a Vertex según el modelo,
para que el adapter (``gemini_adapter``) y cualquier otro llamador construyan el
``GenerateContentConfig`` igual. La config 2.5 queda INTACTA (rollback trivial:
basta con volver a un id ``gemini-2.5-*``).

Gemini 3.x — recomendaciones oficiales aplicadas
(https://ai.google.dev/gemini-api/docs/gemini-3 y /thinking):

* **Temperatura**: "we strongly recommend keeping the temperature parameter at
  its default value of 1.0"; bajarla "may lead to unexpected behavior, such as
  looping or degraded performance". → En 3.x NO se envía ``temperature`` (el
  servidor usa 1.0) aunque el llamador pida 0.0. Override de emergencia con la
  env ``GEMINI3_TEMPERATURE``.
* **Thinking**: 3.x se controla con ``thinking_level`` (``thinking_budget`` es
  legacy; enviar ambos → 400, verificado). No se puede apagar del todo:
  ``minimal`` "does not guarantee that thinking is off". ``gemini-3.1-pro-preview``
  NO acepta ``minimal`` (400 verificado) → se sube a ``low``.
  Defaults: Flash → ``GEMINI_FLASH_THINKING_LEVEL`` (``low``), Pro →
  ``GEMINI_PRO_THINKING_LEVEL`` (``medium``).
* **Salida**: hasta 64k tokens. OJO: en 3.x ``max_output_tokens`` INCLUYE el
  thinking (verificado) → se suma margen por nivel (``with_thinking_headroom``).

Región: los 3.x SOLO se sirven en el endpoint ``global`` (sondeo 2026-09-30:
404 en europe-southwest1/europe-west1/europe-west4). ``generation_location()``
devuelve ``GEMINI_GENERATION_LOCATION`` (default ``global``); los embeddings
siguen en ``GOOGLE_CLOUD_LOCATION`` (europe-southwest1) con su propio cliente.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

DEFAULT_GENERATION_LOCATION = "global"
DEFAULT_EMBEDDING_LOCATION = "europe-southwest1"

_VALID_LEVELS = ("minimal", "low", "medium", "high")
_DEFAULT_FLASH_LEVEL = "low"
_DEFAULT_PRO_LEVEL = "medium"

_warned_no_thinking_level = False


def generation_location() -> str:
    """Región de Vertex para GENERACIÓN (Gemini 3.x solo existe en ``global``)."""
    return (os.environ.get("GEMINI_GENERATION_LOCATION") or "").strip() or DEFAULT_GENERATION_LOCATION


def embedding_location() -> str:
    """Región de Vertex para EMBEDDINGS (residencia UE; sin cambio)."""
    return (os.environ.get("GOOGLE_CLOUD_LOCATION") or "").strip() or DEFAULT_EMBEDDING_LOCATION


def _bare(model: str) -> str:
    m = (model or "").strip().lower()
    for prefix in ("vertexai/", "googleai/", "models/", "publishers/google/models/"):
        if m.startswith(prefix):
            m = m[len(prefix):]
    return m


def is_gemini3_family(model: str) -> bool:
    """True para cualquier ``gemini-3*`` (3, 3.1, 3.5, ...)."""
    return _bare(model).startswith("gemini-3")


def is_pro_model(model: str) -> bool:
    return "-pro" in _bare(model)


def is_image_model(model: str) -> bool:
    return "-image" in _bare(model)


def _env_level(name: str, default: str) -> str:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in _VALID_LEVELS:
        return raw
    if raw:
        logger.warning("%s=%r no es un thinking_level válido %s; usando %r", name, raw, _VALID_LEVELS, default)
    return default


def resolve_thinking_level(model: str, requested: Optional[str] = None) -> Optional[str]:
    """``thinking_level`` efectivo para ``model`` (None si no aplica: 2.5/imagen).

    ``requested`` (si válido) tiene prioridad sobre el default por familia.
    Pro no admite ``minimal`` → se eleva a ``low``.
    """
    if not is_gemini3_family(model) or is_image_model(model):
        return None
    level = (requested or "").strip().lower() or None
    if level not in _VALID_LEVELS:
        level = (
            _env_level("GEMINI_PRO_THINKING_LEVEL", _DEFAULT_PRO_LEVEL)
            if is_pro_model(model)
            else _env_level("GEMINI_FLASH_THINKING_LEVEL", _DEFAULT_FLASH_LEVEL)
        )
    if level == "minimal" and is_pro_model(model):
        level = "low"
    return level


def resolve_temperature(model: str, requested: Optional[float]) -> Optional[float]:
    """Temperatura a ENVIAR (None = no se envía y rige el default del servidor).

    2.5 → la pedida (comportamiento histórico). 3.x → None salvo override
    explícito vía ``GEMINI3_TEMPERATURE`` (Google recomienda 1.0).
    """
    if not is_gemini3_family(model):
        return requested
    raw = (os.environ.get("GEMINI3_TEMPERATURE") or "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            logger.warning("GEMINI3_TEMPERATURE=%r no es float; se ignora", raw)
    return None


# En Gemini 3.x ``max_output_tokens`` INCLUYE los tokens de pensamiento
# (sondeo 2026-09-30: 3.5-flash con level=low y max=64 → MAX_TOKENS sin texto,
# 61 tokens de thoughts). Tratamos el límite del llamador como presupuesto de
# RESPUESTA y le sumamos margen para el thinking según el nivel.
_THINKING_HEADROOM = {"minimal": 512, "low": 2048, "medium": 8192, "high": 16384}
_MAX_OUTPUT_TOKENS_CAP = 65536


def with_thinking_headroom(max_output_tokens: int, level: Optional[str]) -> int:
    """``max_output_tokens`` + margen de thinking (sin cambio si no hay thinking)."""
    if level is None:
        return max_output_tokens
    return min(_MAX_OUTPUT_TOKENS_CAP, max_output_tokens + _THINKING_HEADROOM.get(level, 8192))


def build_generate_content_config(
    types: Any,
    *,
    model: str,
    temperature: Optional[float],
    max_output_tokens: Optional[int] = None,
    system_instruction: Optional[str] = None,
    response_mime_type: Optional[str] = None,
    thinking_level: Optional[str] = None,
) -> Any:
    """Construye ``types.GenerateContentConfig`` según la familia de ``model``.

    ``types`` es ``google.genai.types`` (inyectado para no forzar el import al
    cargar el módulo y facilitar tests). Para 2.5 el resultado es idéntico al
    que construía el adapter antes de la migración.
    """
    kwargs: dict[str, Any] = {}
    temp = resolve_temperature(model, temperature)
    if temp is not None:
        kwargs["temperature"] = temp
    if response_mime_type:
        kwargs["response_mime_type"] = response_mime_type
    level = resolve_thinking_level(model, thinking_level)
    if max_output_tokens is not None:
        kwargs["max_output_tokens"] = with_thinking_headroom(max_output_tokens, level)
    if system_instruction is not None:
        kwargs["system_instruction"] = system_instruction

    if level is not None:
        thinking_cfg = _thinking_config(types, level)
        if thinking_cfg is not None:
            kwargs["thinking_config"] = thinking_cfg
    return types.GenerateContentConfig(**kwargs)


# Equivalencia level → thinking_budget SOLO para SDKs sin ``thinking_level``.
# Google mantiene ``thinking_budget`` en Gemini 3 "for backward compatibility"
# (verificado: 3.5-flash y 3.1-pro-preview aceptan budget; -1 = dinámico).
_LEVEL_TO_BUDGET = {"minimal": 0, "low": 1024, "medium": 8192, "high": -1}


def _thinking_config(types: Any, level: str) -> Any:
    """``ThinkingConfig(thinking_level=...)``; con SDK antiguo, equivalente en budget.

    ``thinking_level`` llegó en google-genai 1.51 (que exige pydantic>=2.9). Con
    un SDK anterior (p.ej. 1.46 + pydantic 2.7.4) no rompemos: se traduce el
    nivel a ``thinking_budget`` (nunca ambos: 400) y se avisa una vez.
    """
    global _warned_no_thinking_level
    thinking_config_cls = getattr(types, "ThinkingConfig", None)
    if thinking_config_cls is None:
        return None
    fields = getattr(thinking_config_cls, "model_fields", {}) or {}
    if "thinking_level" in fields:
        return thinking_config_cls(thinking_level=level.upper())
    if "thinking_budget" in fields:
        if not _warned_no_thinking_level:
            logger.warning(
                "google-genai sin thinking_level (<1.51): usando thinking_budget "
                "equivalente para Gemini 3.x; actualiza google-genai"
            )
            _warned_no_thinking_level = True
        return thinking_config_cls(thinking_budget=_LEVEL_TO_BUDGET.get(level, -1))
    return None

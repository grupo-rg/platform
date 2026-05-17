"""Extract budget header metadata (client name, budget title, project address)
from the first page of a measurement PDF.

The full pricing pipeline is heavy (Architect + Swarm + Assembly + Storage
roundtrips), and we want the UI to surface a fast prefilled form before
dispatching that pipeline. This service runs *only* on the first page using
Gemini Flash with structured output, so a typical call is ~1-2s and well
under $0.005.

Failure mode: if Flash can't see a header (scanned poorly, no client info
visible, etc.) we return empty fields and the UI keeps an editable form.
We never block the dispatcher on a poor extraction — the user can always
type the values manually.
"""

from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel, Field

from src.budget.application.ports.ports import ILLMProvider

logger = logging.getLogger(__name__)


class ExtractedBudgetMetadata(BaseModel):
    """Structured output we ask Gemini Flash to return."""

    clientName: Optional[str] = Field(
        None,
        description=(
            "Nombre del cliente o promotor que aparece en el encabezado del "
            "documento (e.g. 'D. Juan Pérez', 'Constructora XYZ SL'). Devuelve "
            "null si no aparece de forma clara."
        ),
    )
    budgetTitle: Optional[str] = Field(
        None,
        description=(
            "Título o nombre del presupuesto/proyecto tal y como figura en el "
            "documento (e.g. 'Reforma cocina Calle Mayor 23', 'Memoria de "
            "obra nueva Almazora'). Devuelve null si no aparece."
        ),
    )
    projectAddress: Optional[str] = Field(
        None,
        description=(
            "Dirección de la obra/proyecto si aparece. Devuelve null si no "
            "es identificable con certeza."
        ),
    )
    confidence: float = Field(
        0.0,
        ge=0.0,
        le=1.0,
        description=(
            "Confianza global 0–1 del modelo sobre la extracción. "
            "<0.5 = sugerencias dudosas que el usuario debería revisar."
        ),
    )


_SYSTEM_PROMPT = (
    "Eres un extractor especializado en encabezados de presupuestos y mediciones "
    "del sector construcción español (formatos típicos: BC3, Presto, plantillas "
    "Word/Excel). Te enseñamos la primera página de un PDF y debes devolver los "
    "campos solicitados copiándolos literalmente del documento cuando aparezcan. "
    "Si un campo no aparece o no estás seguro al ≥70%, devuelve null en ese "
    "campo en lugar de inventar texto. Prefiere texto corto y útil sobre cadenas "
    "largas con metadatos accesorios. Nunca devuelvas el número del documento o "
    "el código de capítulo como `budgetTitle`."
)

_USER_PROMPT = (
    "Analiza la imagen adjunta (primera página del PDF). Identifica:\n"
    " 1. clientName — nombre del cliente / promotor de la obra.\n"
    " 2. budgetTitle — nombre del proyecto o presupuesto.\n"
    " 3. projectAddress — dirección de la obra si está visible.\n"
    " 4. confidence — tu confianza global (0–1).\n\n"
    "Devuelve el JSON conforme al schema. Si un campo no aparece, ponlo a null. "
    "No alucines: prefiere null antes que adivinar."
)


class BudgetMetadataExtractor:
    """Single-shot first-page metadata extraction over Gemini Flash."""

    def __init__(self, llm_provider: ILLMProvider) -> None:
        self._llm = llm_provider

    async def extract(self, image_base64: str) -> ExtractedBudgetMetadata:
        """Run the extraction. Caller is responsible for getting the first
        page as a base64-encoded image (the same encoding used by the
        pipeline's `_pdf_bytes_to_image_chunks` helper)."""
        if not image_base64:
            logger.warning("budget_metadata_extractor: empty image_base64; returning empty")
            return ExtractedBudgetMetadata()

        try:
            result, _usage = await self._llm.generate_structured(
                system_prompt=_SYSTEM_PROMPT,
                user_prompt=_USER_PROMPT,
                response_schema=ExtractedBudgetMetadata,
                temperature=0.0,
                model="gemini-2.5-flash",
                image_base64=image_base64,
            )
            assert isinstance(result, ExtractedBudgetMetadata)
            logger.info(
                "budget_metadata_extracted",
                extra={
                    "clientName": result.clientName,
                    "budgetTitle": result.budgetTitle,
                    "projectAddress": result.projectAddress,
                    "confidence": result.confidence,
                },
            )
            return result
        except Exception as exc:  # noqa: BLE001 — never let extraction failures block dispatch
            logger.exception("budget_metadata_extractor failed", extra={"error": str(exc)})
            return ExtractedBudgetMetadata()

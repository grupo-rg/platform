"""S2-A-03 — Determinismo en extracción de PDF.

Política:
  1. `temperature=0.0` en ambos extractors (INLINE + ANNEXED).
  2. Post-process sort estable por (page_number, position_y, position_x) o
     orden de aparición.
  3. Code fallback determinista: f"AUTO-{page:03d}-{idx:03d}-{slug(description)[:20]}".

Estos tests no usan el LLM real — mockean el adapter para inducir
diferentes scenarios y verificar la salida.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Type

import pytest
from pydantic import BaseModel

from src.budget.application.ports.ports import ILLMProvider, IGenerationEmitter
from src.budget.application.services.pdf_extractor_service import (
    AnnexedPdfExtractorService,
    DescriptionItem,
    InlinePdfExtractorService,
    Phase1Result,
    Phase2Result,
    RestructureChunkResult,
    RestructuredItem,
    SummatoryItem,
    _build_deterministic_code,
    _is_valid_code,
    _slug_for_code,
    _stable_sort_items,
)


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events = []

    def emit_event(self, b, t, d):
        self.events.append({"type": t, "data": d})


# ---- Pure helpers ---------------------------------------------------------


def test_slug_for_code_normalizes_unicode():
    """Acentos → ascii."""
    assert _slug_for_code("Demolición de pavimento") == "DEMOLICION-DE-PAVIME"
    assert _slug_for_code("Solera HM-20") == "SOLERA-HM-20"


def test_slug_for_code_truncates_to_20():
    """Slug respeta max_chars=20 default."""
    s = _slug_for_code("a" * 100)
    assert len(s) <= 20


def test_slug_for_code_handles_empty():
    """Description vacía → 'ITEM' (no crash)."""
    assert _slug_for_code("") == "ITEM"
    assert _slug_for_code(None) == "ITEM"  # type: ignore[arg-type]


def test_slug_for_code_handles_only_symbols():
    """Description con solo símbolos → 'ITEM' (no slug vacío)."""
    assert _slug_for_code("@#$%^&*") == "ITEM"


def test_build_deterministic_code_is_reproducible():
    """Misma entrada → mismo output (3 veces)."""
    args = dict(page_number=5, item_index=12, description="Solera HM-20")
    c1 = _build_deterministic_code(**args)
    c2 = _build_deterministic_code(**args)
    c3 = _build_deterministic_code(**args)
    assert c1 == c2 == c3
    # Format esperado.
    assert c1 == "AUTO-005-012-SOLERA-HM-20"


def test_build_deterministic_code_changes_with_inputs():
    """Cambios en page o idx producen códigos diferentes."""
    c1 = _build_deterministic_code(page_number=1, item_index=0, description="A")
    c2 = _build_deterministic_code(page_number=1, item_index=1, description="A")
    c3 = _build_deterministic_code(page_number=2, item_index=0, description="A")
    assert c1 != c2 != c3


def test_is_valid_code():
    """Heurística de validez de code."""
    assert _is_valid_code("2.1") is True
    assert _is_valid_code("C03.04") is True
    assert _is_valid_code("01.02.03") is True
    assert _is_valid_code("P-001") is True
    # Inválidos.
    assert _is_valid_code("") is False
    assert _is_valid_code(None) is False
    assert _is_valid_code("   ") is False
    assert _is_valid_code("N/A") is False
    assert _is_valid_code("[REDACTED]") is False
    assert _is_valid_code("—") is False
    assert _is_valid_code("?") is False
    assert _is_valid_code("***") is False


def test_stable_sort_items_preserves_order_without_position():
    """Sin position fields, el sort cae al orden de aparición (stable sort)."""
    items = [
        RestructuredItem(code="A", description="a", quantity=1.0, unit="ud", chapter="C"),
        RestructuredItem(code="B", description="b", quantity=1.0, unit="ud", chapter="C"),
        RestructuredItem(code="C", description="c", quantity=1.0, unit="ud", chapter="C"),
    ]
    sorted_items = _stable_sort_items(items)
    assert [i.code for i in sorted_items] == ["A", "B", "C"]


# ---- Integration: extractor uses temperature=0 + fallback codes -----------


class _DeterministicLLM(ILLMProvider):
    """Retorna siempre los mismos resultados (simula temperature=0)."""

    def __init__(self, items_per_page: List[List[RestructuredItem]]):
        self.items_per_page = items_per_page
        self.calls = []
        self.call_idx = 0

    async def generate_structured(
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: Type[BaseModel],
        temperature: float = 0.2,
        model: str = "gemini-2.5-flash",
        image_base64: Optional[str] = None,
        max_output_tokens: int = 8192,
    ):
        self.calls.append({"temperature": temperature, "schema": response_schema.__name__})
        # Para INLINE: RestructureChunkResult.
        if response_schema.__name__ == "RestructureChunkResult":
            page_idx = self.call_idx if self.call_idx < len(self.items_per_page) else 0
            self.call_idx += 1
            items = self.items_per_page[page_idx] if page_idx < len(self.items_per_page) else []
            return RestructureChunkResult(
                items=items,
                has_more_items=False,
                last_extracted_code="",
            ), {"promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2}
        if response_schema.__name__ == "RestructureChunkResultMinimal":
            return response_schema(items=[]), {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0}
        raise AssertionError(response_schema.__name__)

    async def get_embedding(self, text: str):
        return [0.0] * 768


@pytest.mark.asyncio
async def test_inline_extractor_uses_temperature_zero():
    """INLINE extractor pasa temperature=0.0 al LLM (S2-A-03)."""
    llm = _DeterministicLLM([[
        RestructuredItem(code="1.1", description="A", quantity=1.0, unit="ud", chapter="C"),
    ]])
    svc = InlinePdfExtractorService(llm_provider=llm, emitter=_SpyEmitter())
    await svc.extract(
        [{"image_base64": "x", "page_number": 0, "is_summatory": False}],
        budget_id="b1",
        metrics={"prompt": 0, "completion": 0, "total": 0, "cost": 0.0},
    )
    # Al menos una llamada y todas con temperature=0.0.
    assert llm.calls
    for c in llm.calls:
        if c["schema"] == "RestructureChunkResult":
            assert c["temperature"] == 0.0


@pytest.mark.asyncio
async def test_inline_extractor_fills_missing_codes_with_deterministic_fallback():
    """Items con code vacío reciben un AUTO-… determinístico y misma entrada
    produce el mismo array de codes en runs sucesivos."""
    def _make_page():
        return [
            RestructuredItem(code="", description="Demolición pavimento", quantity=10.0, unit="m2", chapter="C01"),
            RestructuredItem(code="2.1", description="Solera HM-20", quantity=20.0, unit="m2", chapter="C01"),
            RestructuredItem(code="N/A", description="Encachado piedra", quantity=15.0, unit="m2", chapter="C01"),
        ]

    runs = []
    for _ in range(3):
        llm = _DeterministicLLM([_make_page()])
        svc = InlinePdfExtractorService(llm_provider=llm, emitter=_SpyEmitter())
        items = await svc.extract(
            [{"image_base64": "x", "page_number": 0, "is_summatory": False}],
            budget_id=f"b-{_}",
            metrics={"prompt": 0, "completion": 0, "total": 0, "cost": 0.0},
        )
        runs.append([i.code for i in items])

    # 3 runs producen el mismo array de codes.
    assert runs[0] == runs[1] == runs[2]
    # Los codes vacíos/inválidos fueron reemplazados por AUTO-….
    codes = runs[0]
    assert any(c.startswith("AUTO-") for c in codes), (
        f"Esperaba al menos un code AUTO- en {codes}"
    )
    # El code válido se preservó.
    assert "2.1" in codes
    # El "N/A" fue reemplazado.
    assert "N/A" not in codes


@pytest.mark.asyncio
async def test_inline_extractor_preserves_valid_codes():
    """Codes válidos del LLM no se reemplazan por AUTO-…."""
    llm = _DeterministicLLM([[
        RestructuredItem(code="03.04.01", description="X", quantity=1.0, unit="ud", chapter="C"),
        RestructuredItem(code="C-007", description="Y", quantity=1.0, unit="ud", chapter="C"),
    ]])
    svc = InlinePdfExtractorService(llm_provider=llm, emitter=_SpyEmitter())
    items = await svc.extract(
        [{"image_base64": "x", "page_number": 0, "is_summatory": False}],
        budget_id="b-keep-codes",
        metrics={"prompt": 0, "completion": 0, "total": 0, "cost": 0.0},
    )
    codes = [i.code for i in items]
    assert "03.04.01" in codes
    assert "C-007" in codes


@pytest.mark.asyncio
async def test_inline_extractor_same_input_same_output():
    """Tres re-corridas con misma entrada producen `code[]` idéntico (criterio
    de S2-A-03)."""
    pages = [
        [
            RestructuredItem(code="", description="Solera m2", quantity=10.0, unit="m2", chapter="C01 TRABAJOS"),
            RestructuredItem(code="1.2", description="Encachado", quantity=20.0, unit="m2", chapter="C01 TRABAJOS"),
        ],
        [
            RestructuredItem(code="2.1", description="Tabique pladur", quantity=30.0, unit="m2", chapter="C02 ALBAÑILERIA"),
            RestructuredItem(code="", description="Trasdosado", quantity=5.0, unit="m2", chapter="C02 ALBAÑILERIA"),
        ],
    ]

    runs = []
    for _ in range(3):
        llm = _DeterministicLLM([list(p) for p in pages])  # copies
        svc = InlinePdfExtractorService(llm_provider=llm, emitter=_SpyEmitter())
        items = await svc.extract(
            [
                {"image_base64": "p1", "page_number": 0, "is_summatory": False},
                {"image_base64": "p2", "page_number": 1, "is_summatory": False},
            ],
            budget_id=f"b-run-{_}",
            metrics={"prompt": 0, "completion": 0, "total": 0, "cost": 0.0},
        )
        runs.append([i.code for i in items])

    assert runs[0] == runs[1] == runs[2], (
        f"Los runs difieren: {runs[0]} vs {runs[1]} vs {runs[2]}"
    )


# ---- ANNEXED determinism --------------------------------------------------


class _AnnexedDeterministicLLM(ILLMProvider):
    def __init__(self, desc_per_page: List[List[DescriptionItem]], summ: List[SummatoryItem]):
        self.desc_per_page = desc_per_page
        self.summ = summ
        self.desc_idx = 0
        self.calls = []

    async def generate_structured(
        self, system_prompt, user_prompt, response_schema,
        temperature=0.2, model="gemini-2.5-flash", image_base64=None,
        max_output_tokens=8192,
    ):
        self.calls.append({"temperature": temperature, "schema": response_schema.__name__})
        if response_schema.__name__ == "Phase1Result":
            idx = self.desc_idx
            self.desc_idx += 1
            items = self.desc_per_page[idx] if idx < len(self.desc_per_page) else []
            return Phase1Result(items=items, has_more_items=False), {
                "promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2,
            }
        if response_schema.__name__ == "Phase2Result":
            return Phase2Result(items=self.summ), {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0}
        raise AssertionError(response_schema.__name__)

    async def get_embedding(self, text: str):
        return [0.0] * 768


@pytest.mark.asyncio
async def test_annexed_extractor_uses_temperature_zero():
    """ANNEXED extractor también pasa temperature=0.0."""
    llm = _AnnexedDeterministicLLM(
        desc_per_page=[[
            DescriptionItem(code="1.1", description="A" * 80, unit="m2", chapter="C01"),
        ]],
        summ=[SummatoryItem(code="11", total_quantity=10.0)],
    )
    svc = AnnexedPdfExtractorService(llm_provider=llm, emitter=_SpyEmitter())
    await svc.extract(
        [
            {"image_base64": "d1", "is_summatory": False},
            {"image_base64": "s1", "is_summatory": True},
        ],
        budget_id="b-annexed-temp",
        metrics={"prompt": 0, "completion": 0, "total": 0, "cost": 0.0},
    )
    for c in llm.calls:
        assert c["temperature"] == 0.0


@pytest.mark.asyncio
async def test_annexed_extractor_fills_missing_codes():
    """ANNEXED también aplica el fallback determinista para codes vacíos."""
    llm = _AnnexedDeterministicLLM(
        desc_per_page=[[
            DescriptionItem(code="", description="A" * 80, unit="m2", chapter="C01"),
            DescriptionItem(code="2.1", description="B" * 80, unit="m2", chapter="C01"),
        ]],
        summ=[SummatoryItem(code="21", total_quantity=10.0)],
    )
    svc = AnnexedPdfExtractorService(llm_provider=llm, emitter=_SpyEmitter())
    items = await svc.extract(
        [
            {"image_base64": "d1", "is_summatory": False},
            {"image_base64": "s1", "is_summatory": True},
        ],
        budget_id="b-annexed-codes",
        metrics={"prompt": 0, "completion": 0, "total": 0, "cost": 0.0},
    )
    codes = [i.code for i in items]
    # El code "2.1" se preserva; el vacío recibe AUTO-.
    assert "2.1" in codes
    assert any(c.startswith("AUTO-") for c in codes)

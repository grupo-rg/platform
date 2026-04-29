"""Fase 5.A.6 + 5.A.7 — tests del wiring v005 del SwarmPricingService.

Cubre los cambios de integración:
  - Constructor acepta (opcional, backward-compat) `catalog_lookup`, `rules`
    y `dag`. Los defaults son `None` / "" — los callers legacy no se rompen.
  - `CHUNK_SIZE = 1` (era 3) — una partida por prompt del Pro para eliminar
    cross-talk. Expuesto como atributo de clase para que se pueda monkeypatch.
  - `_load_prompt()` renderiza `{{rules}}` en el **system** prompt (antes
    solo reemplazaba en el user), y `{{tool_context}}` + `{{dag_context}}`
    en el user.
  - `fetch_item_candidates()` pasa `partida_unit_dimension` al
    `vector_search.search_similar_items()` cuando la partida lo aporta.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import SwarmPricingService


def _fake_llm() -> MagicMock:
    m = MagicMock()

    async def _embed(_text):
        return [0.0] * 768
    m.get_embedding = _embed
    return m


def _fake_search() -> MagicMock:
    m = MagicMock()
    m.search_similar_items = MagicMock(return_value=[])
    return m


# -------- Constructor acepta deps v005 (opcionales) --------------------------


class TestConstructorAcceptsV005Deps:
    def test_accepts_catalog_lookup_rules_and_dag(self) -> None:
        from src.budget.catalog.application.services.catalog_lookup_service import (
            CatalogLookupService,
        )
        from src.budget.catalog.domain.construction_dag import ConstructionDag
        from src.budget.catalog.infrastructure.adapters.in_memory_catalog_repository import (
            InMemoryCatalogRepository,
        )

        catalog = CatalogLookupService(repo=InMemoryCatalogRepository())
        dag = ConstructionDag(nodes=[], transversal_chapters=[])
        svc = SwarmPricingService(
            llm_provider=_fake_llm(),
            vector_search=_fake_search(),
            catalog_lookup=catalog,
            rules="# Rules markdown test",
            dag=dag,
        )
        assert svc.catalog_lookup is catalog
        assert svc.rules == "# Rules markdown test"
        assert svc.dag is dag

    def test_legacy_constructor_still_works_without_v005_deps(self) -> None:
        svc = SwarmPricingService(
            llm_provider=_fake_llm(),
            vector_search=_fake_search(),
        )
        assert svc.catalog_lookup is None
        assert svc.rules == ""
        assert svc.dag is None


# -------- CHUNK_SIZE = 1 ------------------------------------------------------


class TestChunkSizeIsOne:
    def test_class_constant_is_1(self) -> None:
        assert SwarmPricingService.CHUNK_SIZE == 1


# -------- _load_prompt con placeholders v005 ---------------------------------


class TestLoadPromptRendersV005Placeholders:
    def test_rules_renders_in_system_prompt(self) -> None:
        svc = SwarmPricingService(
            llm_provider=_fake_llm(), vector_search=_fake_search()
        )
        sys_p, usr_p = svc._load_prompt(
            "pricing_evaluator.prompt",
            rules="# NORMAS DE TEST",
            batch_items="[]",
            golden_examples="",
            tool_context="{}",
            dag_context="",
        )
        assert "# NORMAS DE TEST" in sys_p, (
            "rules debería renderizar en el SYSTEM prompt"
        )
        # Los marcadores Handlebars no deben quedar sin sustituir
        assert "{{rules}}" not in sys_p

    def test_tool_context_renders_in_user_prompt(self) -> None:
        svc = SwarmPricingService(
            llm_provider=_fake_llm(), vector_search=_fake_search()
        )
        sys_p, usr_p = svc._load_prompt(
            "pricing_evaluator.prompt",
            rules="",
            batch_items="[]",
            golden_examples="",
            tool_context='{"conversions": [{"from_unit": "m2", "to_unit": "m3"}]}',
            dag_context="",
        )
        assert "conversions" in usr_p
        assert "{{tool_context}}" not in usr_p

    def test_dag_context_renders_in_user_prompt(self) -> None:
        svc = SwarmPricingService(
            llm_provider=_fake_llm(), vector_search=_fake_search()
        )
        sys_p, usr_p = svc._load_prompt(
            "pricing_evaluator.prompt",
            rules="",
            batch_items="[]",
            golden_examples="",
            tool_context="{}",
            dag_context="FASE: acabados_finos | Precedentes: REVOCOS | Siguientes: —",
        )
        assert "FASE: acabados_finos" in usr_p
        assert "{{dag_context}}" not in usr_p


# -------- partida_unit_dimension llega al vector_search ----------------------


class TestPartidaUnitDimensionPassedToSearch:
    """Cuando la partida tiene `unit_dimension`, el Swarm debe pasarlo al
    vector_search para que degrade candidatos dimensionalmente incompatibles.
    """

    def test_search_receives_partida_unit_dimension_when_available(self) -> None:
        svc = SwarmPricingService(
            llm_provider=_fake_llm(), vector_search=_fake_search()
        )

        partida = RestructuredItem(
            code="X.1",
            description="solado cerámico",
            quantity=10.0,
            unit="m2",
            unit_normalized="m2",
            unit_dimension="superficie",
            chapter="SOLADOS Y ALICATADOS",
        )

        asyncio.run(svc._firestore_vector_swarm(
            queries=["solado ceramico"],
            partida_unit_dimension=partida.unit_dimension,
        ))

        # El mock captura la kwarg
        svc.vector_search.search_similar_items.assert_called()
        call = svc.vector_search.search_similar_items.call_args
        assert call.kwargs.get("partida_unit_dimension") == "superficie"

    def test_search_not_passed_when_partida_dimension_missing(self) -> None:
        svc = SwarmPricingService(
            llm_provider=_fake_llm(), vector_search=_fake_search()
        )
        asyncio.run(svc._firestore_vector_swarm(
            queries=["algo"],
            partida_unit_dimension=None,
        ))
        call = svc.vector_search.search_similar_items.call_args
        # None o ausente — ambas formas son aceptables
        assert call.kwargs.get("partida_unit_dimension") is None

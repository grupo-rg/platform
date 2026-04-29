"""Fase 5.A.9 — tests del `ConstructionDag`.

DAG acíclico que modela el orden lógico de ejecución de una obra según los
34 capítulos del libro COAATMCA 2025 (`pdf_index_2025.json`).

Consumidores (fase 5.A.6/5.A.7):
  - **Reordenador del Swarm**: al ensamblar `BudgetPartida`s finales, las
    ordena topológicamente (demoliciones primero, pintura al final).
  - **Contexto al Judge**: inyecta en el prompt "este capítulo pertenece a
    la fase X, sus precedentes son Y, sus seguidores son Z" para que el
    razonamiento sobre precios tenga anclaje temporal.

Invariantes CRÍTICAS que los tests blindan:
  - Al construir, el DAG valida que NO hay ciclos (construir un DAG con un
    ciclo debe lanzar explícitamente — si no, `topological_sort` cuelga).
  - Las aristas `depends_on` solo referencian capítulos existentes en los
    nodos (sin referencias a capítulos fantasma).
  - `topological_sort(chapters)` devuelve una permutación válida según las
    dependencias entre los chapters presentes.
"""

from __future__ import annotations

import pytest

from src.budget.catalog.domain.construction_dag import (
    ConstructionDag,
    ConstructionDagNode,
    CycleDetectedError,
)


def _node(
    key: str,
    phase: str = "estructura",
    depends_on: list[str] | None = None,
    typical_companions: list[str] | None = None,
) -> ConstructionDagNode:
    return ConstructionDagNode(
        key=key,
        phase=phase,
        depends_on=depends_on or [],
        typical_companions=typical_companions or [],
    )


# -------- Construcción + validación de ciclos ---------------------------------


class TestDagConstruction:
    def test_builds_empty_dag(self) -> None:
        dag = ConstructionDag(nodes=[], transversal_chapters=[])
        assert dag.all_keys() == []

    def test_builds_valid_dag_with_linear_chain(self) -> None:
        dag = ConstructionDag(
            nodes=[
                _node("A"),
                _node("B", depends_on=["A"]),
                _node("C", depends_on=["B"]),
            ],
            transversal_chapters=[],
        )
        assert set(dag.all_keys()) == {"A", "B", "C"}

    def test_detects_simple_cycle(self) -> None:
        # A → B → A
        with pytest.raises(CycleDetectedError):
            ConstructionDag(
                nodes=[
                    _node("A", depends_on=["B"]),
                    _node("B", depends_on=["A"]),
                ],
                transversal_chapters=[],
            )

    def test_detects_self_loop(self) -> None:
        # A depende de A
        with pytest.raises(CycleDetectedError):
            ConstructionDag(
                nodes=[_node("A", depends_on=["A"])],
                transversal_chapters=[],
            )

    def test_detects_indirect_cycle(self) -> None:
        # A → B → C → A
        with pytest.raises(CycleDetectedError):
            ConstructionDag(
                nodes=[
                    _node("A", depends_on=["C"]),
                    _node("B", depends_on=["A"]),
                    _node("C", depends_on=["B"]),
                ],
                transversal_chapters=[],
            )

    def test_rejects_depends_on_unknown_chapter(self) -> None:
        with pytest.raises(ValueError, match="GHOST"):
            ConstructionDag(
                nodes=[_node("A", depends_on=["GHOST"])],
                transversal_chapters=[],
            )

    def test_rejects_duplicate_keys(self) -> None:
        with pytest.raises(ValueError, match="duplicate"):
            ConstructionDag(
                nodes=[_node("A"), _node("A")],
                transversal_chapters=[],
            )


# -------- Topological sort ----------------------------------------------------


class TestTopologicalSort:
    def test_returns_empty_for_empty_input(self) -> None:
        dag = ConstructionDag(nodes=[_node("A"), _node("B")], transversal_chapters=[])
        assert dag.topological_sort([]) == []

    def test_respects_direct_dependencies(self) -> None:
        dag = ConstructionDag(
            nodes=[
                _node("DEMOLICIONES"),
                _node("MOVIMIENTO DE TIERRAS", depends_on=["DEMOLICIONES"]),
                _node("HORMIGONES", depends_on=["MOVIMIENTO DE TIERRAS"]),
            ],
            transversal_chapters=[],
        )
        # Entrada desordenada → salida en orden topológico
        result = dag.topological_sort(["HORMIGONES", "DEMOLICIONES", "MOVIMIENTO DE TIERRAS"])
        assert result == ["DEMOLICIONES", "MOVIMIENTO DE TIERRAS", "HORMIGONES"]

    def test_ignores_dependencies_on_chapters_not_in_subset(self) -> None:
        """Si el subset no incluye una dependencia, se omite silenciosamente —
        no se "auto-añade" el prerequisito ausente. (La detección de ausentes
        va en `missing_prerequisites`.)"""
        dag = ConstructionDag(
            nodes=[
                _node("A"),
                _node("B", depends_on=["A"]),
            ],
            transversal_chapters=[],
        )
        assert dag.topological_sort(["B"]) == ["B"]

    def test_places_transversals_at_end_preserving_input_order(self) -> None:
        dag = ConstructionDag(
            nodes=[
                _node("A", phase="preparacion"),
                _node("B", depends_on=["A"], phase="estructura"),
                _node("SyS", phase="transversal"),
                _node("ENSAYOS", phase="transversal"),
            ],
            transversal_chapters=["SyS", "ENSAYOS"],
        )
        result = dag.topological_sort(["SyS", "B", "ENSAYOS", "A"])
        # Los transversales se agrupan al final; los ordinarios se ordenan por DAG.
        assert result.index("A") < result.index("B")
        assert result.index("B") < result.index("SyS")
        assert result.index("B") < result.index("ENSAYOS")

    def test_unknown_chapters_are_appended_last_in_input_order(self) -> None:
        dag = ConstructionDag(
            nodes=[_node("A"), _node("B", depends_on=["A"])],
            transversal_chapters=[],
        )
        result = dag.topological_sort(["B", "X_UNKNOWN", "A", "Y_UNKNOWN"])
        # Los conocidos se ordenan primero; los desconocidos caen al final en
        # el orden que llegaron → permite tolerar capítulos legacy sin romper.
        assert result[:2] == ["A", "B"]
        assert result[2:] == ["X_UNKNOWN", "Y_UNKNOWN"]


# -------- Missing prerequisites ----------------------------------------------


class TestMissingPrerequisites:
    def test_empty_chapters_returns_empty(self) -> None:
        dag = ConstructionDag(nodes=[_node("A")], transversal_chapters=[])
        assert dag.missing_prerequisites([]) == []

    def test_detects_missing_direct_prereq(self) -> None:
        dag = ConstructionDag(
            nodes=[
                _node("REVOCOS"),
                _node("PINTURA", depends_on=["REVOCOS"]),
            ],
            transversal_chapters=[],
        )
        # El budget pinta sin haber enlucido → se detecta.
        missing = dag.missing_prerequisites(["PINTURA"])
        assert len(missing) == 1
        assert missing[0].chapter == "PINTURA"
        assert "REVOCOS" in missing[0].missing_depends_on

    def test_when_all_prereqs_present_returns_empty(self) -> None:
        dag = ConstructionDag(
            nodes=[
                _node("REVOCOS"),
                _node("PINTURA", depends_on=["REVOCOS"]),
            ],
            transversal_chapters=[],
        )
        assert dag.missing_prerequisites(["REVOCOS", "PINTURA"]) == []

    def test_chains_missing_prereqs_per_chapter(self) -> None:
        dag = ConstructionDag(
            nodes=[
                _node("A"),
                _node("B", depends_on=["A"]),
                _node("C", depends_on=["B"]),
            ],
            transversal_chapters=[],
        )
        missing = dag.missing_prerequisites(["C"])
        assert len(missing) == 1
        assert missing[0].chapter == "C"
        assert "B" in missing[0].missing_depends_on

    def test_transversal_chapters_never_report_missing(self) -> None:
        dag = ConstructionDag(
            nodes=[
                _node("A"),
                _node("SyS", phase="transversal", depends_on=["A"]),
            ],
            transversal_chapters=["SyS"],
        )
        # El transversal no requiere sus "prereqs" en estricto — pueden no
        # estar.  Devolvemos lista vacía.
        assert dag.missing_prerequisites(["SyS"]) == []


# -------- Context for the Judge ---------------------------------------------


class TestChapterContext:
    def test_returns_phase_precedents_and_followers(self) -> None:
        dag = ConstructionDag(
            nodes=[
                _node("A", phase="preparacion"),
                _node("B", phase="estructura", depends_on=["A"]),
                _node("C", phase="envolvente", depends_on=["B"]),
                _node("D", phase="envolvente", depends_on=["B"]),
            ],
            transversal_chapters=[],
        )
        ctx = dag.context_for("B")
        assert ctx.phase == "estructura"
        assert ctx.precedents == ["A"]
        # C y D dependen de B, ambos son followers (orden estable)
        assert set(ctx.followers) == {"C", "D"}
        assert ctx.is_transversal is False

    def test_transversal_chapter_is_flagged(self) -> None:
        dag = ConstructionDag(
            nodes=[_node("SyS", phase="transversal")],
            transversal_chapters=["SyS"],
        )
        ctx = dag.context_for("SyS")
        assert ctx.is_transversal is True

    def test_unknown_chapter_returns_none(self) -> None:
        dag = ConstructionDag(
            nodes=[_node("A")], transversal_chapters=[]
        )
        assert dag.context_for("NOPE") is None


# -------- Loader + JSON real --------------------------------------------------


class TestLoadConstructionDag:
    def test_load_returns_a_valid_dag(self) -> None:
        from src.budget.catalog.domain.construction_dag import load_construction_dag
        dag = load_construction_dag()
        assert isinstance(dag, ConstructionDag)
        assert len(dag.all_keys()) > 0

    def test_loaded_dag_is_cached(self) -> None:
        from src.budget.catalog.domain.construction_dag import load_construction_dag
        a = load_construction_dag()
        b = load_construction_dag()
        assert a is b  # lru_cache

    def test_loaded_dag_matches_pdf_index(self) -> None:
        """El DAG debe tener exactamente los capítulos del pdf_index_2025.json.
        Si alguien añade un capítulo al pdf_index, este test detecta el drift."""
        import json
        from pathlib import Path
        from src.budget.catalog.domain.construction_dag import load_construction_dag

        pdf_index_path = Path(__file__).resolve().parents[1] / "data" / "pdf_index_2025.json"
        with pdf_index_path.open("r", encoding="utf-8") as f:
            pdf_index = json.load(f)
        pdf_chapters = {ch["name"] for ch in pdf_index}

        dag = load_construction_dag()
        dag_chapters = set(dag.all_keys())
        missing = pdf_chapters - dag_chapters
        assert not missing, f"DAG falta los capítulos del pdf_index: {missing}"

    def test_loaded_dag_has_no_cycles(self) -> None:
        from src.budget.catalog.domain.construction_dag import load_construction_dag
        # Si había un ciclo, ya habría lanzado al cargar. Nos aseguramos aquí.
        dag = load_construction_dag()
        sorted_keys = dag.topological_sort(dag.all_keys())
        assert len(sorted_keys) == len(dag.all_keys())

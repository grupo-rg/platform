"""DAG del orden lógico de ejecución de obra — derivado del libro COAATMCA.

Modela las dependencias temporales entre los capítulos del libro (p. ej.
no se pinta sin enlucir, no se enlucir sin tabicar). Se consume desde:

  - `SwarmPricingService` al ensamblar el presupuesto final: reordena las
    `BudgetPartida` en orden topológico para que el aparejador vea
    demoliciones arriba y pintura abajo.
  - El system prompt del Judge: inyecta el contexto de fase + precedentes
    + seguidores por capítulo, anclando el razonamiento temporal.
  - (Sprint 3) El Evaluator global: detecta omisiones tipo "pintas sin
    haber enlucido" como `needs_human_review`.

Design:
  - Los nodos son sólo los 34 capítulos top-level del libro (no los
    subchapters; demasiado granular para este uso).
  - Las aristas `depends_on` son estrictas: "A debe venir antes que B".
  - `typical_companions` es informativa para sugerencias futuras.
  - Los capítulos `transversal` (S&S, ensayos) no se integran al topo-sort;
    se añaden al final preservando el orden de entrada.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from functools import lru_cache
from typing import List, Optional

from pydantic import BaseModel, Field


class CycleDetectedError(ValueError):
    """Raised si el DAG tiene un ciclo (lo hace inválido por definición)."""


class ConstructionDagNode(BaseModel):
    key: str = Field(min_length=1)
    phase: str = Field(min_length=1)
    depends_on: List[str] = Field(default_factory=list)
    typical_companions: List[str] = Field(default_factory=list)


@dataclass(frozen=True)
class ChapterContext:
    """Snapshot del contexto de un capítulo — útil para el prompt del Judge."""
    phase: str
    precedents: List[str]       # capítulos que DEBEN venir antes (directos)
    followers: List[str]        # capítulos que dependen de este
    is_transversal: bool


@dataclass(frozen=True)
class MissingPrerequisiteRecord:
    chapter: str
    missing_depends_on: List[str]


class ConstructionDag:
    """DAG inmutable. Valida invariantes en el constructor."""

    def __init__(
        self,
        nodes: List[ConstructionDagNode],
        transversal_chapters: List[str],
    ) -> None:
        seen: set[str] = set()
        for node in nodes:
            if node.key in seen:
                raise ValueError(f"duplicate node key: {node.key}")
            seen.add(node.key)

        self._nodes: dict[str, ConstructionDagNode] = {n.key: n for n in nodes}
        self._transversal: set[str] = set(transversal_chapters)

        # Validar que todos los depends_on apunten a keys existentes.
        for node in nodes:
            for dep in node.depends_on:
                if dep not in self._nodes:
                    raise ValueError(
                        f"node '{node.key}' depends_on unknown chapter '{dep}'"
                    )

        # Pre-computar followers por nodo (inverso de depends_on).
        self._followers: dict[str, list[str]] = {k: [] for k in self._nodes}
        for node in nodes:
            for dep in node.depends_on:
                self._followers[dep].append(node.key)

        self._validate_no_cycles()

    # -------- Inspección ------------------------------------------------------

    def all_keys(self) -> List[str]:
        return list(self._nodes.keys())

    def context_for(self, chapter: str) -> Optional[ChapterContext]:
        node = self._nodes.get(chapter)
        if node is None:
            return None
        return ChapterContext(
            phase=node.phase,
            precedents=list(node.depends_on),
            followers=list(self._followers.get(chapter, [])),
            is_transversal=chapter in self._transversal,
        )

    # -------- Validación de ciclos -------------------------------------------

    def _validate_no_cycles(self) -> None:
        # DFS con coloreo blanco/gris/negro.
        WHITE, GRAY, BLACK = 0, 1, 2
        color: dict[str, int] = {k: WHITE for k in self._nodes}

        def dfs(u: str) -> None:
            color[u] = GRAY
            for dep in self._nodes[u].depends_on:
                if color[dep] == GRAY:
                    raise CycleDetectedError(
                        f"cycle detected involving {u} -> {dep}"
                    )
                if color[dep] == WHITE:
                    dfs(dep)
            color[u] = BLACK

        for k in self._nodes:
            if color[k] == WHITE:
                dfs(k)

    # -------- Topological sort -----------------------------------------------

    def topological_sort(self, chapters: List[str]) -> List[str]:
        """Ordena una selección de capítulos según dependencias.

        Estrategia:
          1. Conocidos no-transversales → Kahn's algorithm restringido al subset.
          2. Conocidos transversales → al final, preservando orden de entrada.
          3. Desconocidos → al final de todo, preservando orden de entrada.
        """
        subset = set(chapters)
        input_order = {ch: i for i, ch in enumerate(chapters)}

        known_ordinary = [
            c for c in chapters
            if c in self._nodes and c not in self._transversal
        ]
        known_transversal = [
            c for c in chapters
            if c in self._nodes and c in self._transversal
        ]
        unknown = [c for c in chapters if c not in self._nodes]

        # Kahn's sobre subset ordinario.
        indeg: dict[str, int] = {c: 0 for c in known_ordinary}
        for c in known_ordinary:
            for dep in self._nodes[c].depends_on:
                if dep in indeg:
                    indeg[c] += 1

        # Priorizamos el orden de entrada al desempatar — da estabilidad.
        ready: deque[str] = deque(
            sorted([c for c in known_ordinary if indeg[c] == 0],
                   key=lambda x: input_order[x])
        )
        sorted_ordinary: list[str] = []
        while ready:
            node = ready.popleft()
            sorted_ordinary.append(node)
            for follower in self._followers.get(node, []):
                if follower in indeg:
                    indeg[follower] -= 1
                    if indeg[follower] == 0:
                        # Inserción manteniendo orden de entrada entre iguales.
                        self._insert_by_input_order(ready, follower, input_order)

        # En caso improbable de subset-ciclo (no debería pasar si self DAG es válido).
        if len(sorted_ordinary) != len(known_ordinary):
            # Añadimos los no procesados al final, preservando orden entrada.
            remaining = [c for c in known_ordinary if c not in sorted_ordinary]
            sorted_ordinary.extend(sorted(remaining, key=lambda x: input_order[x]))

        # Transversales al final, orden de entrada.
        known_transversal.sort(key=lambda x: input_order[x])
        # Desconocidos preservando orden de entrada.
        unknown.sort(key=lambda x: input_order[x])

        return sorted_ordinary + known_transversal + unknown

    @staticmethod
    def _insert_by_input_order(
        q: deque, item: str, input_order: dict[str, int]
    ) -> None:
        """Inserta `item` en la deque manteniendo orden por `input_order`."""
        idx = input_order[item]
        for i, existing in enumerate(q):
            if input_order[existing] > idx:
                q.insert(i, item)
                return
        q.append(item)

    # -------- Missing prerequisites ------------------------------------------

    def missing_prerequisites(
        self, chapters: List[str]
    ) -> List[MissingPrerequisiteRecord]:
        """Para cada capítulo del subset, lista los depends_on que FALTAN."""
        subset = set(chapters)
        result: List[MissingPrerequisiteRecord] = []
        for ch in chapters:
            if ch not in self._nodes:
                continue
            if ch in self._transversal:
                # Los transversales se ejecutan en paralelo a la obra;
                # no aplicamos su estricto depends_on aquí.
                continue
            deps = self._nodes[ch].depends_on
            missing = [d for d in deps if d not in subset]
            if missing:
                result.append(MissingPrerequisiteRecord(
                    chapter=ch, missing_depends_on=missing
                ))
        return result


# -------- Loader del JSON versionado ----------------------------------------


def _dag_path():
    from pathlib import Path
    return Path(__file__).resolve().parents[4] / "data" / "construction_dag_2025.json"


@lru_cache(maxsize=1)
def load_construction_dag() -> ConstructionDag:
    """Carga `services/ai-core/data/construction_dag_2025.json` una sola vez."""
    import json
    path = _dag_path()
    if not path.exists():
        raise FileNotFoundError(f"Missing DAG file: {path}")
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    nodes = [ConstructionDagNode.model_validate(n) for n in payload["nodes"]]
    transversal = payload.get("transversal_chapters", [])
    return ConstructionDag(nodes=nodes, transversal_chapters=transversal)

"""Puerto de búsqueda semántica sobre el catálogo de materiales OBRAMAT.

`material_catalog` (~29k productos con precio real + embedding 768-dim,
ingestados con el MISMO modelo `gemini-embedding-001@768` que usa la query
del pricing) es la fuente de precios de MATERIAL para componer partidas
`from_scratch` — así el agente NO inventa precios de material, los toma de un
catálogo real y auditable.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class IMaterialSearch(ABC):
    @abstractmethod
    def search_materials(
        self,
        query_vector: List[float],
        query_text: str = "",
        limit: int = 5,
        category_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Devuelve los materiales más similares a la query.

        Cada candidato: ``{sku, id, name, description, unit, price, category,
        matchScore}`` donde ``matchScore`` es el coseno (0..~1) con boost
        léxico opcional. Ordenados por ``matchScore`` desc. Nunca lanza:
        devuelve ``[]`` ante error.
        """
        ...

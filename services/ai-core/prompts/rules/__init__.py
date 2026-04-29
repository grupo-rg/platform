"""Carga y cacheo de las normas del libro COAATMCA 2025.

El markdown `coaatmca_2025_rules.md` vive en este mismo directorio y es la
única fuente de verdad de las reglas que el Judge y el Evaluator aplican
al razonar precios. El loader:
  - Lee el fichero una sola vez (cache in-memory).
  - Devuelve el contenido como `str` sin tocarlo.
  - Si falta el fichero, lanza `FileNotFoundError` explícito — el servicio
    NO debería arrancar sin normas.

`load_rules()` se invoca al montar el contenedor DI (ver
`services/ai-core/src/core/http/dependencies.py`) y el resultado se
inyecta en el constructor del `SwarmPricingService`.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_RULES_FILENAME = "coaatmca_2025_rules.md"


@lru_cache(maxsize=1)
def load_rules() -> str:
    """Lee el markdown de normas una sola vez y cachea el resultado."""
    path = Path(__file__).parent / _RULES_FILENAME
    if not path.exists():
        raise FileNotFoundError(f"Missing rules markdown: {path}")
    return path.read_text(encoding="utf-8")

"""Value Object `Unit` — única fuente de verdad para la jerga de unidades.

El pipeline recibe unidades escritas por aparejadores y arquitectos distintos
con notaciones inconsistentes: "Ud"/"ud"/"UD"/"u" son la misma cosa,
"m²"/"m2"/"M2" también. Este módulo normaliza todo a un canonical lowercase
reducido a 10 unidades finales, y mapea cada canonical a su dimensión física.

Responsabilidades:
  - `normalize(raw)`: sinónimo → canonical. `None` si no reconoce.
  - `dimension_of(raw)`: canonical → dimensión física. `None` si no reconoce.
  - `same_dimension(a, b)`: shortcut para comparar dimensiones.

No decide compatibilidad "vía bridge" (eso vive en UnitConverter).
"""

from __future__ import annotations

from typing import Optional


class Unit:
    """Tabla canonical de unidades y sus dimensiones físicas."""

    # Cada canonical -> conjunto de sinónimos escritos tal cual los usan los
    # aparejadores (ya en lowercase trim). El canonical SIEMPRE está incluido
    # en su propio set para que `normalize("ud")` también funcione.
    SYNONYMS: dict[str, set[str]] = {
        "ud": {"ud", "u", "uds", "und", "unidad", "unit"},
        "m2": {"m2", "m²", "m.cuad", "m cuadrados", "metro cuadrado"},
        "m3": {"m3", "m³", "m.cub", "m cubicos", "metro cubico"},
        "ml": {"ml", "m", "m.l.", "metro lineal", "mts", "mtl"},
        "kg": {"kg", "kgs", "kilo", "kilogramo"},
        "t": {"t", "ton", "tonelada", "tn"},
        "h": {"h", "hora", "hr", "hrs"},
        "l": {"l", "litro", "lts", "lt"},
        "%": {"%", "porcentaje", "pct"},
        "pa": {"pa", "p.a.", "partida alzada"},
    }

    DIMENSION: dict[str, str] = {
        "m2": "superficie",
        "m3": "volumen",
        "ml": "lineal",
        "kg": "masa",
        "t": "masa",
        "h": "tiempo",
        "l": "volumen_liquido",
        "ud": "discreto",
        "%": "porcentaje",
        "pa": "importe",
    }

    # Índice inverso sinónimo->canonical, construido una vez al importar.
    _REVERSE_INDEX: dict[str, str] = {
        syn: canonical
        for canonical, synonyms in SYNONYMS.items()
        for syn in synonyms
    }

    @classmethod
    def normalize(cls, raw: Optional[str]) -> Optional[str]:
        if raw is None:
            return None
        stripped = raw.strip().lower()
        if not stripped:
            return None
        return cls._REVERSE_INDEX.get(stripped)

    @classmethod
    def dimension_of(cls, raw: Optional[str]) -> Optional[str]:
        canonical = cls.normalize(raw)
        if canonical is None:
            return None
        return cls.DIMENSION.get(canonical)

    @classmethod
    def same_dimension(cls, a: Optional[str], b: Optional[str]) -> bool:
        dim_a = cls.dimension_of(a)
        dim_b = cls.dimension_of(b)
        if dim_a is None or dim_b is None:
            return False
        return dim_a == dim_b

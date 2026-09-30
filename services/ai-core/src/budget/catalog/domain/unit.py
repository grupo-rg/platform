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


# ---- Compatibilidad dimensional "blanda" (retrieval) ------------------------

# Alias de dimensión que aparecen en datos/tests legacy (inglés) o en la jerga
# de los planes ("longitud", "unidad"). Se pliegan al vocabulario canónico de
# `Unit.DIMENSION` antes de comparar.
_DIMENSION_ALIASES: dict[str, str] = {
    "surface_area": "superficie",
    "surface": "superficie",
    "area": "superficie",
    "volume": "volumen",
    "length": "lineal",
    "longitud": "lineal",
    "linear": "lineal",
    "unidad": "discreto",
    "unit": "discreto",
    "count": "discreto",
    "time": "tiempo",
    "percentage": "porcentaje",
    "percent": "porcentaje",
    "amount": "importe",
    "lump_sum": "importe",
    "mass": "masa",
    "liquid_volume": "volumen_liquido",
}

# Pares de dimensiones PUENTEABLES: una partida en m² se valora a menudo con un
# precio en m³ (espesor) y viceversa; una en ml con precios por ud (piezas por
# metro) y viceversa. No se penalizan en el retrieval: decide el Judge con el
# `unit_conversion_hints`.
_BRIDGEABLE_DIMENSIONS: frozenset[frozenset[str]] = frozenset({
    frozenset({"superficie", "volumen"}),
    frozenset({"lineal", "discreto"}),
})

# Dimensiones de PARTIDA que no admiten comparación física con el candidato:
# una partida alzada (pa), un porcentaje (%) o unas horas (h) pueden valorarse
# con candidatos de cualquier unidad → nunca se penaliza ni filtra.
_UNCONSTRAINED_PARTIDA_DIMENSIONS: frozenset[str] = frozenset({
    "importe", "porcentaje", "tiempo",
})


_KNOWN_DIMENSIONS: frozenset[str] = frozenset(Unit.DIMENSION.values())


def canonical_dimension(dim: Optional[str]) -> Optional[str]:
    """Normaliza el nombre de una dimensión (alias inglés/legacy → canónico).
    None si está vacía o no es una dimensión conocida."""
    if not dim:
        return None
    d = str(dim).strip().lower()
    if not d:
        return None
    d = _DIMENSION_ALIASES.get(d, d)
    return d if d in _KNOWN_DIMENSIONS else None


def dimension_mismatch(
    partida_dim: Optional[str], candidate_dim: Optional[str]
) -> bool:
    """True si el candidato merece PENALIZACIÓN (nunca exclusión) por unidad.

    No hay mismatch cuando:
      - alguna de las dos dimensiones es desconocida/vacía (permisivo);
      - la partida es importe/porcentaje/tiempo (pa, %, h);
      - son iguales;
      - forman un par puenteable (superficie↔volumen, lineal↔discreto).
    """
    p = canonical_dimension(partida_dim)
    c = canonical_dimension(candidate_dim)
    if p is None or c is None:
        return False
    if p in _UNCONSTRAINED_PARTIDA_DIMENSIONS:
        return False
    if p == c:
        return False
    if frozenset({p, c}) in _BRIDGEABLE_DIMENSIONS:
        return False
    return True

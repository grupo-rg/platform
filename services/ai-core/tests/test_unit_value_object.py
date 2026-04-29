"""Fase 1.1 — tests del Value Object Unit.

Convención TDD: estos tests DEBEN fallar inicialmente porque el módulo no
existe. El mensaje esperado es `ImportError`. Cuando el ciclo verde esté
listo, todos deben pasar sin modificar este archivo.

El Unit value object es la única fuente de verdad para normalizar la "jerga"
del aparejador: "Ud"/"ud"/"UD"/"u" -> "ud"; "m²"/"m2"/"M2" -> "m2"; etc.
Se usa transversalmente (extractor, swarm, architect) así que su contrato es
crítico: inputs basura no deben romper el pipeline, pero deben marcar
`None` para que el caller decida.
"""

from __future__ import annotations

import pytest

from src.budget.catalog.domain.unit import Unit


class TestUnitNormalize:
    """`Unit.normalize()` acepta la jerga y devuelve el canonical lowercase."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            # Unidad discreta: ud
            ("ud", "ud"),
            ("Ud", "ud"),
            ("UD", "ud"),
            ("u", "ud"),
            ("U", "ud"),
            ("uds", "ud"),
            ("und", "ud"),
            ("unidad", "ud"),
            ("unit", "ud"),
            # Superficie: m2
            ("m2", "m2"),
            ("M2", "m2"),
            ("m²", "m2"),
            ("metro cuadrado", "m2"),
            # Volumen: m3
            ("m3", "m3"),
            ("m³", "m3"),
            ("metro cubico", "m3"),
            # Lineal: ml
            ("ml", "ml"),
            ("m", "ml"),
            ("mts", "ml"),
            ("metro lineal", "ml"),
            # Masa
            ("kg", "kg"),
            ("KG", "kg"),
            ("kilo", "kg"),
            ("t", "t"),
            ("tonelada", "t"),
            # Tiempo
            ("h", "h"),
            ("hora", "h"),
            ("hr", "h"),
            # Volumen líquido
            ("l", "l"),
            ("litro", "l"),
            # Porcentaje y partida alzada
            ("%", "%"),
            ("pa", "pa"),
            ("p.a.", "pa"),
            ("partida alzada", "pa"),
        ],
    )
    def test_canonicalizes_common_synonyms(self, raw: str, expected: str) -> None:
        assert Unit.normalize(raw) == expected

    @pytest.mark.parametrize("raw", ["  ud ", "\tUd\n", " m² "])
    def test_trims_whitespace_before_normalizing(self, raw: str) -> None:
        assert Unit.normalize(raw) in {"ud", "m2"}

    @pytest.mark.parametrize("raw", [None, "", "   ", "\t\n"])
    def test_returns_none_for_empty_input(self, raw) -> None:
        assert Unit.normalize(raw) is None

    @pytest.mark.parametrize("raw", ["xyz", "zorrobotico", "???"])
    def test_returns_none_for_unknown_unit(self, raw: str) -> None:
        assert Unit.normalize(raw) is None


class TestUnitDimension:
    """Cada unidad canonical pertenece a exactamente UNA dimensión física."""

    @pytest.mark.parametrize(
        "unit,expected_dimension",
        [
            ("m2", "superficie"),
            ("m3", "volumen"),
            ("ml", "lineal"),
            ("kg", "masa"),
            ("t", "masa"),
            ("h", "tiempo"),
            ("l", "volumen_liquido"),
            ("ud", "discreto"),
            ("%", "porcentaje"),
            ("pa", "importe"),
        ],
    )
    def test_maps_canonical_unit_to_dimension(
        self, unit: str, expected_dimension: str
    ) -> None:
        assert Unit.dimension_of(unit) == expected_dimension

    def test_accepts_raw_input_and_normalizes_first(self) -> None:
        # Aceptar "Ud" directamente sin forzar al caller a llamar normalize antes.
        assert Unit.dimension_of("Ud") == "discreto"
        assert Unit.dimension_of("m²") == "superficie"

    @pytest.mark.parametrize("raw", [None, "", "xyz"])
    def test_returns_none_for_unknown_or_empty(self, raw) -> None:
        assert Unit.dimension_of(raw) is None


class TestUnitSameDimension:
    """Dos unidades comparten dimensión si su DIMENSION es la misma."""

    def test_synonyms_share_dimension(self) -> None:
        assert Unit.same_dimension("Ud", "u") is True
        assert Unit.same_dimension("m²", "m2") is True

    def test_masa_units_share_dimension(self) -> None:
        # kg y t son ambos 'masa' — deben ser compatibles
        assert Unit.same_dimension("kg", "t") is True

    def test_surface_and_volume_are_not_same_dimension(self) -> None:
        # m² y m³ son dimensiones distintas; requieren bridge explícito
        # para convertir. La compatibilidad "vía bridge" NO se decide aquí.
        assert Unit.same_dimension("m2", "m3") is False

    def test_discrete_and_continuous_never_share_dimension(self) -> None:
        assert Unit.same_dimension("ud", "m2") is False
        assert Unit.same_dimension("ud", "kg") is False

    @pytest.mark.parametrize("a,b", [("xyz", "m2"), ("m2", None), (None, None)])
    def test_returns_false_when_either_unknown(self, a, b) -> None:
        assert Unit.same_dimension(a, b) is False

"""Fase 1.2 — tests de `Measurement` + `UnitConverter`.

El `UnitConverter` traduce cantidades entre unidades SOLO cuando la
descripción de la partida ha aportado el puente (bridge) explícito que
habilita la conversión. No es un conversor genérico: es el guardia que
asegura que el agente no "se invente" conversiones físicamente imposibles
(ej. m² → ud, m² → kg sin densidad).

Conversiones permitidas (tabla finita y auditable):
  - m2 ↔ m3       con bridge `thickness_m`
  - kg ↔ m3       con bridge `density_kg_m3`
  - ml ↔ ud       con bridge `piece_length_m`
  - t  ↔ kg       sin bridge (factor × 1000)

Todo lo demás devuelve `None` y el Judge marca `needs_human_review`.
"""

from __future__ import annotations

import pytest

from src.budget.catalog.domain.measurement import Measurement, UnitConverter


class TestMeasurementDataclass:
    """`Measurement` es un simple contenedor inmutable (value, unit)."""

    def test_stores_value_and_unit(self) -> None:
        m = Measurement(value=50.0, unit="m2")
        assert m.value == 50.0
        assert m.unit == "m2"

    def test_is_immutable(self) -> None:
        m = Measurement(value=1.0, unit="m2")
        with pytest.raises(Exception):
            # frozen dataclass: asignar a un atributo existente lanza
            m.value = 2.0  # type: ignore[misc]


class TestUnitConverterTrivialCases:
    """Si source.unit == target_unit → devuelve el mismo Measurement."""

    def test_returns_equal_measurement_for_identical_units(self) -> None:
        result = UnitConverter.convert(Measurement(value=42.0, unit="m2"), target_unit="m2")
        assert result is not None
        assert result.value == pytest.approx(42.0)
        assert result.unit == "m2"

    def test_normalizes_target_unit_before_comparing(self) -> None:
        # Pasar "M2" / "m²" al target no debe romper la identidad.
        result = UnitConverter.convert(Measurement(value=10.0, unit="m2"), target_unit="M2")
        assert result is not None
        assert result.value == pytest.approx(10.0)

    def test_returns_none_for_unknown_target_unit(self) -> None:
        assert UnitConverter.convert(Measurement(value=1.0, unit="m2"), target_unit="zorro") is None


class TestM2ToM3WithThickness:
    """m² → m³ con espesor explícito. El caso canónico del acondicionamiento."""

    def test_50_m2_with_10cm_thickness_gives_5_m3(self) -> None:
        # "Meter 10 cm de grava, 50 m²" -> 5 m³
        result = UnitConverter.convert(
            Measurement(value=50.0, unit="m2"),
            target_unit="m3",
            bridge={"thickness_m": 0.10},
        )
        assert result is not None
        assert result.unit == "m3"
        assert result.value == pytest.approx(5.0)

    def test_m3_to_m2_inverse_with_thickness(self) -> None:
        # 5 m³ con espesor 0.10 m -> 50 m²
        result = UnitConverter.convert(
            Measurement(value=5.0, unit="m3"),
            target_unit="m2",
            bridge={"thickness_m": 0.10},
        )
        assert result is not None
        assert result.unit == "m2"
        assert result.value == pytest.approx(50.0)

    def test_returns_none_when_thickness_missing(self) -> None:
        # Sin bridge → None, el Judge marca needs_human_review.
        assert UnitConverter.convert(
            Measurement(value=50.0, unit="m2"), target_unit="m3"
        ) is None
        assert UnitConverter.convert(
            Measurement(value=50.0, unit="m2"), target_unit="m3", bridge={}
        ) is None

    def test_returns_none_for_non_positive_thickness(self) -> None:
        for thickness in (0.0, -0.1):
            assert UnitConverter.convert(
                Measurement(value=50.0, unit="m2"),
                target_unit="m3",
                bridge={"thickness_m": thickness},
            ) is None


class TestKgM3WithDensity:
    """kg ↔ m³ con densidad explícita. Ej: hormigón 2400 kg/m³."""

    def test_m3_to_kg_with_density(self) -> None:
        # 1 m³ de hormigón con densidad 2400 kg/m³ -> 2400 kg
        result = UnitConverter.convert(
            Measurement(value=1.0, unit="m3"),
            target_unit="kg",
            bridge={"density_kg_m3": 2400.0},
        )
        assert result is not None
        assert result.unit == "kg"
        assert result.value == pytest.approx(2400.0)

    def test_kg_to_m3_with_density(self) -> None:
        # 2400 kg de hormigón con densidad 2400 kg/m³ -> 1 m³
        result = UnitConverter.convert(
            Measurement(value=2400.0, unit="kg"),
            target_unit="m3",
            bridge={"density_kg_m3": 2400.0},
        )
        assert result is not None
        assert result.unit == "m3"
        assert result.value == pytest.approx(1.0)

    def test_returns_none_without_density(self) -> None:
        assert UnitConverter.convert(
            Measurement(value=1.0, unit="m3"), target_unit="kg"
        ) is None


class TestMlUdWithPieceLength:
    """ml ↔ ud con tamaño unitario. Ej: tubería de 3 m cada pieza."""

    def test_ml_to_ud_with_piece_length(self) -> None:
        # 30 ml con piezas de 3 m -> 10 ud
        result = UnitConverter.convert(
            Measurement(value=30.0, unit="ml"),
            target_unit="ud",
            bridge={"piece_length_m": 3.0},
        )
        assert result is not None
        assert result.unit == "ud"
        assert result.value == pytest.approx(10.0)

    def test_ud_to_ml_with_piece_length(self) -> None:
        # 10 ud × 3 m = 30 ml
        result = UnitConverter.convert(
            Measurement(value=10.0, unit="ud"),
            target_unit="ml",
            bridge={"piece_length_m": 3.0},
        )
        assert result is not None
        assert result.unit == "ml"
        assert result.value == pytest.approx(30.0)

    def test_returns_none_without_piece_length(self) -> None:
        assert UnitConverter.convert(
            Measurement(value=30.0, unit="ml"), target_unit="ud"
        ) is None


class TestMassConversions:
    """t ↔ kg tiene factor determinista; no requiere bridge."""

    def test_t_to_kg(self) -> None:
        result = UnitConverter.convert(Measurement(value=2.5, unit="t"), target_unit="kg")
        assert result is not None
        assert result.unit == "kg"
        assert result.value == pytest.approx(2500.0)

    def test_kg_to_t(self) -> None:
        result = UnitConverter.convert(Measurement(value=500.0, unit="kg"), target_unit="t")
        assert result is not None
        assert result.unit == "t"
        assert result.value == pytest.approx(0.5)


class TestForbiddenConversions:
    """Conversiones sin puente válido devuelven None — NO se inventa el puente."""

    @pytest.mark.parametrize(
        "src_unit,tgt_unit",
        [
            ("m2", "ud"),   # superficie → discreto
            ("m3", "ud"),   # volumen → discreto
            ("ud", "m2"),   # discreto → superficie
            ("m2", "kg"),   # superficie → masa (sin densidad+espesor)
            ("h", "m2"),    # tiempo → superficie (no tiene sentido)
            ("%", "m2"),
        ],
    )
    def test_incompatible_dimensions_always_return_none(
        self, src_unit: str, tgt_unit: str
    ) -> None:
        # Incluso con bridge presente, estas duplas no son convertibles.
        assert UnitConverter.convert(
            Measurement(value=10.0, unit=src_unit),
            target_unit=tgt_unit,
            bridge={"thickness_m": 0.1, "density_kg_m3": 2000, "piece_length_m": 1.0},
        ) is None


class TestSourceUnitNormalization:
    """UnitConverter acepta unidades en jerga y normaliza antes de operar."""

    def test_raw_jerga_on_source_measurement(self) -> None:
        # El caller pasa "Ud" o "m²" — deben normalizarse transparentemente.
        # (Si el dataclass es estricto, el caller debería normalizar antes;
        #  aquí probamos la robustez end-to-end del convert con target raw.)
        result = UnitConverter.convert(
            Measurement(value=10.0, unit="m2"), target_unit="m²"
        )
        assert result is not None
        assert result.value == pytest.approx(10.0)

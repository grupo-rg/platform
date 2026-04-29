"""Fase 5.A.4 — tests de la ampliación de `PricingFinalResultDB`.

El schema gana dos campos nuevos que el Judge DEBE emitir para que el
pipeline pueda razonar/auditar aguas abajo:

  - `match_kind: Literal["1:1", "1:N", "from_scratch"]` — cómo se resolvió
    la partida. Es contractual, el Judge no puede omitirlo.
  - `unit_conversion_applied: Optional[UnitConversionRecord]` — registro
    auditable de la conversión matemática que se aplicó (ej. m² → m³ con
    espesor). Nullable: solo se rellena si se aplicó conversión.

Ambos campos se persisten en `BudgetPartida` (Fase 5.E) y se muestran en
el panel de auditoría del editor (Fase 5.F). Romper su forma aquí propaga
hacia arriba en cadena — de ahí los tests de schema dedicados.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.budget.application.services.swarm_pricing_service import (
    PricingFinalResultDB,
    UnitConversionRecord,
)


def _base_fields(**overrides) -> dict:
    """Campos mínimos actualmente requeridos para construir el schema."""
    base = {
        "pensamiento_calculista": "cálculo ok",
        "calculated_unit_price": 100.0,
        "needs_human_review": False,
        "match_kind": "1:1",
    }
    base.update(overrides)
    return base


class TestMatchKindField:
    def test_accepts_the_three_literals(self) -> None:
        for kind in ("1:1", "1:N", "from_scratch"):
            obj = PricingFinalResultDB(**_base_fields(match_kind=kind))
            assert obj.match_kind == kind

    def test_rejects_unknown_literal(self) -> None:
        with pytest.raises(ValidationError):
            PricingFinalResultDB(**_base_fields(match_kind="yolo"))

    def test_is_required(self) -> None:
        payload = _base_fields()
        payload.pop("match_kind")
        with pytest.raises(ValidationError):
            PricingFinalResultDB(**payload)


class TestUnitConversionRecord:
    def test_conversion_record_captures_all_audit_fields(self) -> None:
        conv = UnitConversionRecord(
            value=50.0,
            from_unit="m2",
            to_unit="m3",
            bridge={"thickness_m": 0.10},
            result=5.0,
        )
        assert conv.value == 50.0
        assert conv.from_unit == "m2"
        assert conv.to_unit == "m3"
        assert conv.bridge == {"thickness_m": 0.10}
        assert conv.result == 5.0

    def test_rejects_non_positive_result(self) -> None:
        # Si el Judge calcula un resultado ≤ 0, algo salió mal en la conversión —
        # lo rechazamos explícitamente para que no se persista basura.
        with pytest.raises(ValidationError):
            UnitConversionRecord(
                value=50.0, from_unit="m2", to_unit="m3",
                bridge={"thickness_m": 0.10}, result=0.0,
            )


class TestUnitConversionAppliedInPricingResult:
    def test_defaults_to_none(self) -> None:
        obj = PricingFinalResultDB(**_base_fields())
        assert obj.unit_conversion_applied is None

    def test_accepts_a_conversion_record(self) -> None:
        conv = {
            "value": 50.0, "from_unit": "m2", "to_unit": "m3",
            "bridge": {"thickness_m": 0.10}, "result": 5.0,
        }
        obj = PricingFinalResultDB(**_base_fields(unit_conversion_applied=conv))
        assert obj.unit_conversion_applied is not None
        assert obj.unit_conversion_applied.result == 5.0


class TestBackwardCompatSerialization:
    """Presupuestos viejos (sin los nuevos campos) deben seguir leyéndose
    correctamente — dropeamos pero con defaults cuando es posible.
    """

    def test_legacy_payload_without_new_fields_fails_cleanly(self) -> None:
        # Los legacy carecen de match_kind → debe fallar con mensaje claro.
        # Es intencional: cuando leemos de Firestore siempre tendrá `None`
        # si es legacy y ahí SQS/adapter rellena un default, no el schema.
        payload = {
            "pensamiento_calculista": "x",
            "calculated_unit_price": 1.0,
            "needs_human_review": False,
        }
        with pytest.raises(ValidationError):
            PricingFinalResultDB(**payload)

    def test_dict_roundtrip(self) -> None:
        original = PricingFinalResultDB(**_base_fields(
            match_kind="1:N",
            unit_conversion_applied={
                "value": 50.0, "from_unit": "m2", "to_unit": "m3",
                "bridge": {"thickness_m": 0.10}, "result": 5.0,
            },
        ))
        dumped = original.model_dump()
        restored = PricingFinalResultDB.model_validate(dumped)
        assert restored == original

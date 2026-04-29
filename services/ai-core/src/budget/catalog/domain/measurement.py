"""Value Object `Measurement` + servicio `UnitConverter`.

`Measurement` es un par inmutable (valor, unidad). Inmutable porque es un
VO clásico: dos medidas son iguales ssi tienen los mismos datos.

`UnitConverter` traduce `Measurement`s entre unidades SOLO mediante una tabla
finita de reglas permitidas. Cada regla requiere (o no) un `bridge` — un
diccionario con el puente físico que habilita la conversión:

  - `thickness_m` (metros) → permite m2 ↔ m3
  - `density_kg_m3` (kg/m³) → permite m3 ↔ kg
  - `piece_length_m` (metros) → permite ml ↔ ud

Cualquier otra dupla (o falta de bridge) devuelve `None`. El Judge que lo
invoca debe entonces marcar `needs_human_review: true`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .unit import Unit


@dataclass(frozen=True)
class Measurement:
    value: float
    unit: str


# Tipo bridge: diccionario con llaves específicas según la conversión.
Bridge = dict  # e.g. {"thickness_m": 0.10}


class UnitConverter:
    """Conversiones deterministas entre unidades con puente explícito."""

    @staticmethod
    def convert(
        source: Measurement,
        target_unit: str,
        bridge: Optional[Bridge] = None,
    ) -> Optional[Measurement]:
        src_canonical = Unit.normalize(source.unit)
        tgt_canonical = Unit.normalize(target_unit)
        if src_canonical is None or tgt_canonical is None:
            return None

        # Caso trivial: misma unidad canonical.
        if src_canonical == tgt_canonical:
            return Measurement(value=source.value, unit=tgt_canonical)

        # Determinista: factores de escala dentro de la misma dimensión.
        if src_canonical == "t" and tgt_canonical == "kg":
            return Measurement(value=source.value * 1000.0, unit="kg")
        if src_canonical == "kg" and tgt_canonical == "t":
            return Measurement(value=source.value / 1000.0, unit="t")

        # Conversiones con bridge.
        b = bridge or {}

        # m2 ↔ m3 con thickness_m.
        if (src_canonical, tgt_canonical) == ("m2", "m3"):
            thickness = b.get("thickness_m")
            if thickness is None or thickness <= 0:
                return None
            return Measurement(value=source.value * thickness, unit="m3")
        if (src_canonical, tgt_canonical) == ("m3", "m2"):
            thickness = b.get("thickness_m")
            if thickness is None or thickness <= 0:
                return None
            return Measurement(value=source.value / thickness, unit="m2")

        # kg ↔ m3 con density_kg_m3.
        if (src_canonical, tgt_canonical) == ("m3", "kg"):
            density = b.get("density_kg_m3")
            if density is None or density <= 0:
                return None
            return Measurement(value=source.value * density, unit="kg")
        if (src_canonical, tgt_canonical) == ("kg", "m3"):
            density = b.get("density_kg_m3")
            if density is None or density <= 0:
                return None
            return Measurement(value=source.value / density, unit="m3")

        # ml ↔ ud con piece_length_m.
        if (src_canonical, tgt_canonical) == ("ml", "ud"):
            piece = b.get("piece_length_m")
            if piece is None or piece <= 0:
                return None
            return Measurement(value=source.value / piece, unit="ud")
        if (src_canonical, tgt_canonical) == ("ud", "ml"):
            piece = b.get("piece_length_m")
            if piece is None or piece <= 0:
                return None
            return Measurement(value=source.value * piece, unit="ml")

        # Todo lo demás: imposible sin puente explícito.
        return None

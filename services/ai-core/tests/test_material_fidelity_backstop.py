"""Backstop determinista de fidelidad de material (regla 15 dura).

Si la partida pide un material explícito y NINGÚN candidato del catálogo lo
refleja, se debe forzar from_scratch (el helper devuelve el material pedido).
"""

from src.budget.application.services.swarm_pricing_service import (
    _no_candidate_matches_explicit_material,
)


def _c(desc: str, price: float = 100.0):
    return {"id": desc[:6], "description": desc, "priceTotal": price}


def test_resina_sin_candidato_devuelve_material():
    # Caso real: se pide plato de RESINA, catálogo solo tiene acrílico/porcelana.
    desc = "Suministro y colocación de plato de ducha. [MATERIAL EXPLÍCITO: resina antideslizante]"
    candidates = [
        _c("Plato de ducha acrílico, rectangular, para empotrar", 740.0),
        _c("Suministro e instalación de plato de ducha acrílico 75x75", 331.0),
        _c("Suministro e instalación de plato de ducha de porcelana sanitaria", 276.0),
    ]
    assert _no_candidate_matches_explicit_material(desc, candidates) == "resina antideslizante"


def test_material_presente_en_candidato_no_interviene():
    desc = "Alicatado con [MATERIAL EXPLÍCITO: gres porcelánico]"
    candidates = [_c("Baldosa cerámica de gres esmaltado 30x30")]  # 'gres' presente
    assert _no_candidate_matches_explicit_material(desc, candidates) is None


def test_sin_material_explicito_no_interviene():
    desc = "Suministro y colocación de inodoro con cisterna."
    candidates = [_c("Inodoro de porcelana sanitaria con tanque bajo")]
    assert _no_candidate_matches_explicit_material(desc, candidates) is None


def test_sin_candidatos_con_material_devuelve_material():
    desc = "Encimera de [MATERIAL EXPLÍCITO: granito]"
    assert _no_candidate_matches_explicit_material(desc, []) == "granito"


def test_qualificador_compartido_no_protege_material_equivocado():
    # 'antideslizante' es cualificador compartido; NO debe contar como material resina.
    desc = "Plato de ducha. [MATERIAL EXPLÍCITO: resina antideslizante]"
    candidates = [_c("Plato de ducha acrílico con fondo antideslizante")]
    assert _no_candidate_matches_explicit_material(desc, candidates) == "resina antideslizante"

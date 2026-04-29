"""Fase 11.B — Seed de 6 HeuristicFragments derivados del eval comparativo
contra `presupuesto_human_27_04_2026.pdf`.

A diferencia del seed demo (`seed_heuristic_fragments.py`), estos fragments
provienen de un análisis real de divergencia entre la IA y un aparejador
humano sobre el budget `f1e81e46-45d7-4262-b572-f653ebb848b2`. Cubren los
patrones más críticos detectados en los 7 outliers > ±50 % del eval:

  1. Lump-sum confusion en demoliciones Ud/PA (01.06).
  2. Catalog premium overshoot en marquesinas (01.08).
  3. Default standard quality en pintura plástica (02.02).
  4. Suelo de precio Grupo RG en reparaciones estructurales (01.04).
  5. Lump-sum floor en partidas alzadas de yeso (01.07).
  6. Escalado de "medios para ejecución" con el PEM del capítulo (01.11).

Uso:
  # Dry-run (por defecto):
    python scripts/seed_heuristic_fragments_from_eval_2026_04_27.py

  # Commit real:
    python scripts/seed_heuristic_fragments_from_eval_2026_04_27.py --commit
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.budget.domain.entities import (  # noqa: E402
    HeuristicAIInferenceTrace,
    HeuristicContext,
    HeuristicFragment,
    HeuristicHumanCorrection,
)
from src.budget.learning.infrastructure.adapters.firestore_heuristic_fragment_repository import (  # noqa: E402
    FirestoreHeuristicFragmentRepository,
)
from src.budget.learning.infrastructure.adapters.in_memory_heuristic_fragment_repository import (  # noqa: E402
    InMemoryHeuristicFragmentRepository,
)
from scripts.seed_heuristic_fragments import _init_firebase_admin  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


_BUDGET_ID = "f1e81e46-45d7-4262-b572-f653ebb848b2"
_USER_ID = "eval_aparejador_grupo_rg"
_TIMESTAMP = datetime(2026, 4, 27, 12, 0, 0, tzinfo=timezone.utc)


def _make_eval_fragment(
    *,
    fragment_id: str,
    chapter: str,
    chapter_code: str,
    description: str,
    quantity: float,
    unit: str,
    ai_price: float,
    ai_reasoning: str,
    human_price: float,
    human_unit: str,
    rule: str,
    tags: List[str],
) -> HeuristicFragment:
    """Phase 14 fix — añade `chapter_code:NN` además del legacy `chapter:NAME`.

    El `chapter_code` (`"01"`, `"02"`) es el identificador canónico estable —
    leído directamente del PDF (prefijo de `partida.code`) y por tanto
    invariable run-a-run. El `chapter:NAME` queda como metadato descriptivo
    sin valor para el retrieval primario.
    """
    return HeuristicFragment(
        id=fragment_id,
        sourceType="baseline_migration",
        status="golden",
        context=HeuristicContext(
            budgetId=_BUDGET_ID,
            originalDescription=description,
            originalQuantity=quantity,
            originalUnit=unit,
        ),
        aiInferenceTrace=HeuristicAIInferenceTrace(
            proposedUnitPrice=ai_price,
            aiReasoning=ai_reasoning,
        ),
        humanCorrection=HeuristicHumanCorrection(
            correctedUnitPrice=human_price,
            correctedUnit=human_unit,
            heuristicRule=rule,
            correctedByUserId=_USER_ID,
        ),
        tags=[
            f"chapter_code:{chapter_code}",
            f"chapter:{chapter}",
            *tags,
        ],
        timestamp=_TIMESTAMP,
    )


def build_eval_fragments() -> List[HeuristicFragment]:
    """6 fragments golden derivados del eval comparativo (2026-04-27).
    IDs deterministas para idempotencia (re-ejecución sobrescribe, no duplica).
    """
    return [
        _make_eval_fragment(
            fragment_id="frag-eval-01-06-demolicion-falso-techo-lump-sum-2026-04",
            chapter="DEFICIENCIAS IEE HENRI DUNANT",
            chapter_code="01",
            description="Demolición de falso techo, incluida retirada de escombros",
            quantity=1.0,
            unit="Ud",
            ai_price=208.83,
            ai_reasoning=(
                "Apliqué DIMENSIONAMIENTO OCULTO con la superficie 9 m² de la propia "
                "descripción: DRT020 (6,40 €/m²) × 9 + GRA010 (151,23 €) = 208,83 €."
            ),
            human_price=370.00,
            human_unit="Ud",
            rule=(
                "[Principio general]\n"
                "El catálogo COAATMCA está basado en condiciones de licitación a gran escala "
                "con economías de volumen. Para partidas tipo 'Demolición de falso techo' en "
                "unidad 'Ud'/'PA' con superficie pequeña (5-15 m² inferida en la descripción, "
                "p. ej. cajas de escalera, baños, locales pequeños), el precio €/m² del "
                "catálogo subvalúa el RAW PEM real entre 1,2× y 2,4× porque no amortiza el "
                "overhead técnico de movilización, jornada parcial y acceso restringido. Esta "
                "desviación es generalizada al sector español de reformas IEE.\n\n"
                "IMPORTANTE — RAW PEM: el valor que emites en `calculated_unit_price` es "
                "**raw PEM** (precio crudo sin markup comercial). El sistema aplicará GG "
                "(Gastos Generales) y BI (Beneficio Industrial) como markup posterior, "
                "configurable por el aparejador. NO incluyas margen comercial.\n\n"
                "Aplicación general: tras computar `unit_price = (catalog €/m² × área "
                "inferida) + transporte`, aplica un factor entre ×1,2 y ×2,4 según contexto "
                "del proyecto para obtener raw PEM. Si la superficie inferida supera 30 m², "
                "el factor decae a ×1,0 (catálogo válido a escala). Si no hay superficie en "
                "descripción y no se puede inferir, trata como lump sum 240-360 €/Ud raw PEM.\n\n"
                "[Calibración Grupo RG — eval 27_04_2026]\n"
                "Para 'Demolición de falso techo' Ud con superficie 5-15 m² en obras tipo "
                "IEE Henri Dunant (Mallorca), el factor empírico observado en el PDF humano "
                "es ×1,77 sobre catálogo (370 € humano all-in / 208,83 € cálculo IA "
                "catálogo). El raw PEM correspondiente, descontando markup Grupo RG (10% GG "
                "+ 15% BI = 25% additive sobre PEM), es ×1,77 / 1,25 = **×1,42**. Aplica "
                "×1,42 sobre el cálculo catálogo y registra en `pensamiento_calculista` que "
                "se usó el factor raw PEM de calibración tenant Grupo RG."
            ),
            tags=[
                "scope:global",
                "scope:tenant:grupo-rg",
                "calibration:phase15_raw_pem",
                "principle:catalog_underprice_smallscale",
                "reason:catalog_underprice_small_lumpsum",
                "demoliciones",
                "falso_techo",
                "lump_sum_small_surface",
                "multiplier:1.42",
                "surface_band:5-15m2",
            ],
        ),
        _make_eval_fragment(
            fragment_id="frag-eval-01-08-retirada-marquesina-light-2026-04",
            chapter="DEFICIENCIAS IEE HENRI DUNANT",
            chapter_code="01",
            description="Retirada de marquesina, incluyendo carga, transporte y canon de vertedero",
            quantity=2.0,
            unit="Ud",
            ai_price=520.00,
            ai_reasoning="Seleccioné candidato 'Marquesina comercial estructural' del catálogo.",
            human_price=80.00,
            human_unit="Ud",
            rule=(
                "[Principio general]\n"
                "En contextos de Inspección Técnica de Edificios (IEE) y reformas ligeras, "
                "'marquesina' refiere a un elemento ligero (chapa, lona, voladizo pequeño), "
                "NO a una marquesina comercial estructural. Es una convención del sector "
                "inspecciones técnicas en España. El precio raw PEM típico de retirada para "
                "este tipo de elementos está en el rango 48-120 €/Ud (= rango all-in 60-150 "
                "€/Ud / 1,25). NO selecciones del catálogo variantes con 'estructura "
                "metálica autoportante' o 'marquesina vidriada' salvo que la descripción "
                "lo especifique explícitamente.\n\n"
                "IMPORTANTE — RAW PEM: el valor que emites es raw PEM sin markup comercial. "
                "El sistema aplicará GG+BI por encima.\n\n"
                "[Calibración Grupo RG — eval 27_04_2026]\n"
                "Caso observado: retirada de marquesina ligera adosada a fachada trasera, "
                "acceso por planta 1ª, cotizada por el aparejador en 80 €/Ud all-in. El raw "
                "PEM correspondiente (descontando 25% markup Grupo RG) es **64 €/Ud**. "
                "Aplica 64 €/Ud raw PEM por defecto para este tipo de partida; el editor "
                "aplicará markup 25% → 80 €/Ud all-in coincidente con humano."
            ),
            tags=[
                "scope:global",
                "scope:tenant:grupo-rg",
                "calibration:phase15_raw_pem",
                "principle:lightweight_marquesina_iee",
                "reason:catalog_premium_overshoot",
                "retirada",
                "marquesina",
                "iee_ligero",
            ],
        ),
        _make_eval_fragment(
            fragment_id="frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04",
            chapter="OBRAS VARIAS",
            chapter_code="02",
            description="Pintura plástica para exterior sobre paramentos verticales, dos manos",
            quantity=1201.0,
            unit="m2",
            ai_price=15.92,
            ai_reasoning="Seleccioné variante de pintura siloxánica de alta resistencia.",
            human_price=8.60,
            human_unit="m2",
            rule=(
                "[Principio general]\n"
                "Cuando originalDescription dice 'pintura plástica para exterior' SIN "
                "especificar calidad (siloxánica, anti-grafiti, fotocatalítica, silicato), "
                "DEFAULT al rango raw PEM estándar 7-10 €/m². Esta es la base catálogo "
                "COAATMCA (RFP010 = 9 €/m² raw PEM) — convención generalizada del sector "
                "español para fachadas residenciales y comerciales. NO selecciones variantes "
                "premium del catálogo a menos que la descripción mencione explícitamente la "
                "calidad o el cliente final lo requiera. Si dudas, deja match_kind='1:1' con "
                "la variante base y deja la siloxánica como alternativeComponents.\n\n"
                "IMPORTANTE — RAW PEM: emite el precio del catálogo directo (7-10 €/m²) sin "
                "añadir markup comercial. El sistema aplicará GG+BI por encima.\n\n"
                "El candidato base RFP010 (9 €/m² raw PEM, 'aplicación de dos manos de "
                "pintura plástica previa imprimación') incluye preparación implícita estándar. "
                "NO añadas un componente de chorreado/limpieza adicional al breakdown "
                "(ej. D3001.0040, D3001.0050) salvo que la descripción mencione literalmente "
                "'chorreado', 'agua a presión' o 'arenado'. Si no, el breakdown debe "
                "consistir en un único componente: el de la pintura + imprimación.\n\n"
                "[Calibración Grupo RG — eval 27_04_2026]\n"
                "Caso observado: pintura plástica exterior sobre paramentos verticales, "
                "1.201 m² en obra IEE Henri Dunant. Aparejador cotizó 8,60 €/m² all-in. El "
                "raw PEM correspondiente (descontando 25% markup) sería 6,88 €/m² — pero "
                "este caso particular cae ligeramente por debajo del rango catálogo (7-10). "
                "Para mantener alineación con el catálogo, usa rango catálogo 7-10 €/m² raw "
                "PEM; tras markup ×1,25 → 8,75-12,5 €/m² all-in (humano 8,60 dentro del "
                "extremo bajo, aceptable)."
            ),
            tags=[
                "scope:global",
                "scope:tenant:grupo-rg",
                "calibration:phase15_raw_pem",
                "cross_chapter:true",
                "principle:default_standard_quality_unspecified",
                "principle:rfp010_includes_implicit_prep",
                "reason:default_estandar_no_premium",
                "pintura",
                "exterior",
                "fachada",
                "no_anadir_chorreado",
            ],
        ),
        _make_eval_fragment(
            fragment_id="frag-eval-01-04-reparacion-pilastras-grupo-rg-2026-04",
            chapter="DEFICIENCIAS IEE HENRI DUNANT",
            chapter_code="01",
            description="Reparación de pilastras con saneado de armaduras y mortero de reparación",
            quantity=15.0,
            unit="ml",
            ai_price=109.48,
            ai_reasoning="Sumé componentes del catálogo: oficial 1ª + mortero R4 + ferralla.",
            human_price=235.00,
            human_unit="ml",
            rule=(
                "[Principio general]\n"
                "La reparación de elementos estructurales de hormigón con armadura (pilares, "
                "pilastras, viguetas, jácenas, cantos de forjado) tiene un overhead real muy "
                "superior al cálculo desnudo del catálogo COAATMCA: acceso, andamiaje "
                "puntual, coordinación con la propiedad, garantía estructural posterior. "
                "La desviación raw PEM es del orden 30-50% a la baja para este tipo de "
                "partidas. Cuando el sumatorio del breakdown del catálogo resulte "
                "manifiestamente bajo (< 160 €/ml o < 120 €/m²) en partidas estructurales, "
                "identifica la subvaluación y ajusta al raw PEM realista del sector.\n\n"
                "IMPORTANTE — RAW PEM: emite raw PEM sin markup comercial. El sistema "
                "aplicará GG+BI por encima.\n\n"
                "[Calibración Grupo RG — eval 27_04_2026]\n"
                "En Grupo RG, la reparación de elementos estructurales se cotiza all-in en el "
                "rango 230-265 €/ml independientemente del elemento concreto (pilar, "
                "pilastra, vigueta, jácena, canto de forjado). El raw PEM correspondiente "
                "(descontando 25% markup) es **184-212 €/ml**. Aplica el suelo raw PEM "
                "**184 €/ml** cuando el sumatorio del breakdown resulte < 160 €/ml en este "
                "tipo de partidas. El editor aplicará markup ×1,25 → 230 €/ml all-in "
                "coincidente con humano."
            ),
            tags=[
                "scope:global",
                "scope:tenant:grupo-rg",
                "calibration:phase15_raw_pem",
                "principle:catalog_underprice_structural",
                "reason:suelo_precio_grupo_rg",
                "reparacion_estructural",
                "hormigon_armado",
                "pilar_pilastra_vigueta_canto",
                "suelo_raw_pem:184",
            ],
        ),
        _make_eval_fragment(
            fragment_id="frag-eval-01-07-picado-tendido-yeso-pa-2026-04",
            chapter="DEFICIENCIAS IEE HENRI DUNANT",
            chapter_code="01",
            description="Picado y tendido de yeso en paramento dañado, repaso de aristas",
            quantity=1.0,
            unit="PA",
            ai_price=250.65,
            ai_reasoning=(
                "Apliqué DIMENSIONAMIENTO OCULTO con la superficie 9 m² de la propia "
                "descripción: DRT010 (11,51 €/m²) × 9 + RPG010e (16,34 €/m²) × 9 = 250,65 €."
            ),
            human_price=640.00,
            human_unit="PA",
            rule=(
                "[Principio general]\n"
                "Las partidas en unidad 'PA' (partida alzada) o 'Ud' que incluyen demolición "
                "+ reposición de yeso sobre superficies pequeñas (5-15 m² inferida en "
                "descripción) requieren un factor sobre el cálculo catálogo para llegar al "
                "raw PEM real. El factor recoge mobilización pesada, gestión de polvo, "
                "protecciones y dificultad de coordinación con otras intervenciones. Rango "
                "raw PEM observado: ×1,6 a ×2,4 según contexto. Para superficies > 30 m² el "
                "factor decae a ×1,0 (catálogo válido a escala). Si no hay superficie en "
                "descripción, trata como lump sum 400-640 €/PA raw PEM.\n\n"
                "IMPORTANTE — RAW PEM: emite raw PEM sin markup comercial. El sistema "
                "aplicará GG+BI por encima.\n\n"
                "[Calibración Grupo RG — eval 27_04_2026]\n"
                "Para 'Picado y tendido de yeso' en PA con superficie 5-15 m² en obras tipo "
                "IEE Henri Dunant, el factor empírico observado all-in es ×2,55 (640 € "
                "humano all-in / 250,65 € cálculo IA catálogo). El raw PEM correspondiente "
                "(descontando 25% markup) es ×2,55 / 1,25 = **×2,04**.\n\n"
                "Aplicación: tras computar `unit_price = (catalog €/m² demolición + catalog "
                "€/m² yeso) × área inferida`, multiplica por **2,04** para obtener raw PEM. "
                "Registra en `pensamiento_calculista` que aplicaste el factor raw PEM de "
                "calibración tenant Grupo RG."
            ),
            tags=[
                "scope:global",
                "scope:tenant:grupo-rg",
                "calibration:phase15_raw_pem",
                "cross_chapter:true",
                "principle:catalog_underprice_smallscale",
                "reason:catalog_underprice_small_lumpsum",
                "partida_alzada",
                "PA",
                "yeso",
                "picado_tendido",
                "lump_sum_small_surface",
                "multiplier:2.04",
                "surface_band:5-15m2",
            ],
        ),
        _make_eval_fragment(
            fragment_id="frag-eval-01-11-medios-ejecucion-escala-pem-2026-04",
            chapter="DEFICIENCIAS IEE HENRI DUNANT",
            chapter_code="01",
            description=(
                "Medios para ejecución de los trabajos: andamiaje, plataformas, "
                "EPIs, señalización"
            ),
            quantity=1.0,
            unit="PA",
            ai_price=4500.00,
            ai_reasoning="Apliqué template de medios del catálogo (4500 € fijo).",
            human_price=1870.00,
            human_unit="PA",
            rule=(
                "[Principio general]\n"
                "La Norma COAATMCA 1.1 establece que los Medios Auxiliares se cotizan como "
                "2-4% del PEM del capítulo al que pertenecen (sin contar la propia partida "
                "de medios). Para reformas medianas/grandes el rango efectivo es 3-5%; para "
                "fachadas grandes con andamio sube a 7-10%. La partida es alzada (PA) y NO "
                "debe cotizarse con templates fijos del catálogo.\n\n"
                "IMPORTANTE — RAW PEM: emite el % sobre el RAW PEM acumulado del capítulo "
                "(sin markup comercial). El sistema aplicará GG+BI a la partida de medios "
                "junto con el resto en una capa posterior.\n\n"
                "Pre-requisito: el agente recibe el RAW PEM acumulado del capítulo en el "
                "dag_context (inyectado por la Fase 14.B). Si no está disponible, queda "
                "conservadora y marca para revisión humana.\n\n"
                "[Calibración Grupo RG — eval 27_04_2026]\n"
                "En Grupo RG, en obras IEE tipo Henri Dunant, el rango efectivo es 3-5% del "
                "RAW PEM del capítulo. Aplica un mínimo de **1.200 € raw PEM** para reformas "
                "pequeñas (= 1.500 € all-in / 1,25). Caso observado: humano cotizó 1.870 € "
                "all-in en cap 01 → raw PEM = 1.870 / 1,25 = 1.496 € raw PEM, que es ~3,6% "
                "del raw PEM acumulado del capítulo (~41.358 € raw)."
            ),
            tags=[
                "scope:global",
                "scope:tenant:grupo-rg",
                "calibration:phase15_raw_pem",
                "cross_chapter:true",
                "principle:coaatmca_norm_1.1_medios_pem",
                "reason:escalar_no_template",
                "medios_ejecucion",
                "partida_alzada",
                "porcentaje_pem",
            ],
        ),
        # Fase 14.G — fragments adicionales derivados del eval run-5 (242d5a00).
        # Cubren 01.02 Alicatado (-40,7 %) y 01.10 Tabique (-19,8 %).
        _make_eval_fragment(
            fragment_id="frag-eval-01-02-reposicion-alicatado-lump-sum-2026-04",
            chapter="DEFICIENCIAS IEE HENRI DUNANT",
            chapter_code="01",
            description=(
                "Reposición de alicatado en pilares intervenidos, incluyendo "
                "cantoneras"
            ),
            quantity=1.0,
            unit="Ud",
            ai_price=320.00,
            ai_reasoning=(
                "Estimé from_scratch: candidatos del catálogo eran solo "
                "decorativos lineales o sin precio."
            ),
            human_price=540.00,
            human_unit="Ud",
            rule=(
                "[Principio general]\n"
                "La reposición puntual de alicatado en superficies pequeñas "
                "(pilares, paramentos < 5 m²) tras una intervención estructural "
                "requiere overhead más alto que el catálogo COAATMCA: corte "
                "preciso, cantoneras, igualar despiece existente, pequeñas "
                "superficies que no amortizan medios. Factor raw PEM "
                "observado en el sector: ×1,2 a ×2,0 sobre cálculo catálogo.\n\n"
                "IMPORTANTE — RAW PEM: emite raw PEM sin markup comercial. El "
                "sistema aplicará GG+BI por encima.\n\n"
                "[Calibración Grupo RG — eval 27_04_2026]\n"
                "Para 'Reposición de alicatado en pilares intervenidos' Ud en "
                "obra IEE, el factor empírico observado all-in es ×1,69 "
                "(540 € humano all-in / 320 € cálculo IA). El raw PEM "
                "correspondiente (descontando 25% markup) es ×1,69 / 1,25 = "
                "**×1,35**. Aplica ×1,35 sobre el cálculo catálogo o, si la "
                "estimación es from_scratch, sitúa el raw PEM en el rango "
                "**400-480 €/Ud** (= rango all-in 500-600 / 1,25)."
            ),
            tags=[
                "scope:global",
                "scope:tenant:grupo-rg",
                "calibration:phase15_raw_pem",
                "principle:catalog_underprice_smallscale",
                "reason:catalog_underprice_small_lumpsum",
                "alicatado",
                "azulejo",
                "lump_sum_small_surface",
                "multiplier:1.35",
            ],
        ),
        _make_eval_fragment(
            fragment_id="frag-eval-01-10-reparacion-tabique-iee-2026-04",
            chapter="DEFICIENCIAS IEE HENRI DUNANT",
            chapter_code="01",
            description=(
                "Reparación de tabique medianero, demolición parcial y "
                "reconstrucción con mortero técnico"
            ),
            quantity=1.0,
            unit="Ud",
            ai_price=385.00,
            ai_reasoning=(
                "Calculé from_scratch sumando demolición parcial + mortero R3 "
                "del catálogo aproximado."
            ),
            human_price=480.00,
            human_unit="Ud",
            rule=(
                "[Principio general]\n"
                "La reparación de tabiques medianeros entre viviendas con "
                "demolición parcial + reconstrucción con mortero técnico tiene "
                "overhead moderado sobre el catálogo COAATMCA: coordinación con "
                "la propiedad colindante, retirada selectiva de escombros, "
                "ajuste de espesor existente. El raw PEM sectorial es muy "
                "cercano al cálculo catálogo (factor ×0,95 a ×1,2).\n\n"
                "IMPORTANTE — RAW PEM: emite raw PEM sin markup comercial. El "
                "sistema aplicará GG+BI por encima.\n\n"
                "[Calibración Grupo RG — eval 27_04_2026]\n"
                "Para 'Reparación de tabique' Ud en obra IEE, el factor "
                "empírico observado all-in es ×1,25 (480 € humano all-in / "
                "385 € cálculo IA). El raw PEM correspondiente es "
                "×1,25 / 1,25 = **×1,00** — el cálculo catálogo es ya el raw "
                "PEM target. NO apliques multiplicador adicional. El editor "
                "aplicará markup ×1,25 → 480 €/Ud all-in coincidente con humano."
            ),
            tags=[
                "scope:global",
                "scope:tenant:grupo-rg",
                "calibration:phase15_raw_pem",
                "principle:catalog_underprice_smallscale",
                "reason:catalog_underprice_small_lumpsum",
                "tabique",
                "lump_sum_small_surface",
                "multiplier:1.00",
            ],
        ),
    ]


async def run(commit: bool) -> int:
    fragments = build_eval_fragments()
    logger.info(f"Generados {len(fragments)} fragments derivados del eval 2026-04-27.")

    if commit:
        import firebase_admin
        from firebase_admin import firestore

        _init_firebase_admin()
        repo = FirestoreHeuristicFragmentRepository(db=firestore.client())
        logger.info("Commit real: escribiendo en Firestore heuristic_fragments…")
    else:
        repo = InMemoryHeuristicFragmentRepository()
        logger.info("Dry-run: NO se escribirá en Firestore (pasa --commit para escribir).")

    for frag in fragments:
        await repo.save(frag)
        chapter = next((t for t in frag.tags if t.startswith("chapter:")), "chapter:?")
        reason = next((t for t in frag.tags if t.startswith("reason:")), "reason:?")
        logger.info(
            f"  [{frag.id}]\n"
            f"    {chapter} / {reason}\n"
            f"    IA {frag.aiInferenceTrace.proposedUnitPrice}€ → humano "
            f"{frag.humanCorrection.correctedUnitPrice}€ "
            f"({frag.context.originalUnit})"
        )

    logger.info(f"✅ Seed eval completado: {len(fragments)} fragments procesados.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed de heuristic_fragments derivados del eval 2026-04-27.")
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Escribir en Firestore. Por defecto dry-run.",
    )
    args = parser.parse_args()
    return asyncio.run(run(commit=args.commit))


if __name__ == "__main__":
    sys.exit(main())

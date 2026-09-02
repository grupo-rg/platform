"""FromScratchCompositor — compone una partida desde recursos ATÓMICOS.

Cuando el Juez marca ``from_scratch`` (ningún candidato del catálogo cubre la
partida), en vez de dejar que el LLM ADIVINE un precio, componemos un
descompuesto auditable con precios REALES:

  - Mano de obra → ``labor_rates_2025`` (``CatalogLookupService.get_labor_rate``).
  - Material     → ``material_catalog`` (``IMaterialSearch``, ~29k OBRAMAT).
  - Maquinaria   → ``material_catalog`` (fallback: no encontrado → 0, review).
  - % medios aux → sobre el subtotal de costes directos.

El LLM SOLO descompone (qué oficios/horas, qué materiales/cantidades) — **NO
inventa precios**. Cada € viene de una tabla real. Respeta la regla del libro.

Convención de precio: devolvemos el **PEM** (coste de ejecución material). Los
markups GG+BI+IVA los aplica el editor (config del presupuesto), así que NO se
hornean aquí para no doble-contar. El +15% utillaje/BI y +3% indirectos del
libro quedan como decisión de negocio futura (no se aplican en esta versión;
se documentan para no olvidarlos).
"""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from pydantic import BaseModel, Field

from src.budget.catalog.application.ports.material_search import IMaterialSearch
from src.budget.catalog.application.services.catalog_lookup_service import (
    CatalogLookupService,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# Schema de descomposición (salida del LLM — SOLO recursos, sin precios)
# --------------------------------------------------------------------------
class LaborNeed(BaseModel):
    role: str = Field(description="Categoría de mano de obra: 'Oficial 1ª', 'Peón', 'Ayudante', 'Capataz'…")
    hours: float = Field(gt=0, description="Horas de esa categoría por unidad de partida")


class MachineryNeed(BaseModel):
    query: str = Field(description="Máquina necesaria (ej. 'retroexcavadora', 'pisón compactador')")
    hours: float = Field(gt=0, description="Horas de máquina por unidad de partida")


class MaterialNeed(BaseModel):
    query: str = Field(description="Material a buscar en catálogo (ej. 'grava caliza 40-60mm')")
    quantity: float = Field(gt=0, description="Cantidad por unidad de partida")
    unit: Optional[str] = Field(default=None, description="Unidad del material (kg, m3, ud…)")


class CompositionPlan(BaseModel):
    main_task: str = Field(description="Tarea principal en una frase")
    labor: List[LaborNeed] = Field(default_factory=list)
    machinery: List[MachineryNeed] = Field(default_factory=list)
    materials: List[MaterialNeed] = Field(default_factory=list)
    aux_pct: float = Field(default=2.0, ge=0, description="% de medios auxiliares sobre el subtotal directo")


# --------------------------------------------------------------------------
# Resultado de la composición
# --------------------------------------------------------------------------
class ComposedResult(BaseModel):
    unit_price: float
    breakdown: List[Dict[str, Any]]
    plan: CompositionPlan
    needs_human_review: bool = False
    notes: List[str] = Field(default_factory=list)


# Tipo del embebedor inyectado: str -> vector.
EmbedFn = Callable[[str], Awaitable[List[float]]]


class FromScratchCompositor:
    _SYS = (
        "Eres un aparejador experto. Te dan una partida de obra SIN precio del "
        "catálogo. Tu trabajo es DESCOMPONERLA en sus recursos atómicos para "
        "poder valorarla después: qué oficios y cuántas horas, qué maquinaria y "
        "horas, qué materiales y cantidades (por UNA unidad de la partida), y el "
        "% de medios auxiliares. PROHIBIDO estimar precios — solo recursos y "
        "cantidades realistas según buena práctica de construcción.\n"
        "Para la MANO DE OBRA usa SOLO estas categorías base del convenio (no "
        "uses oficios especializados como 'fontanero' o 'electricista' — "
        "exprésalos con su categoría base): 'Oficial 1ª', 'Oficial 2ª', "
        "'Oficial 3ª (Ayudante)', 'Peón especializado', 'Peón', 'Capataz', "
        "'Encargado de Obra'.\n"
        "CANTIDADES: son SIEMPRE por UNA sola unidad de la partida y deben ser "
        "REALISTAS. Piensa cuánto material hace falta para 1 unidad y sé "
        "conservador — un punto de luz NO lleva cientos de metros de cable; una "
        "instalación puntual lleva metros, no cientos. Revisa cada cantidad "
        "antes de emitirla: si te sale un número enorme, casi seguro está mal."
    )

    def __init__(
        self,
        llm: Any,
        embed_fn: EmbedFn,
        catalog_lookup: CatalogLookupService,
        material_search: IMaterialSearch,
        *,
        model: str = "gemini-2.5-flash",
        min_material_score: float = 0.6,
        dominance_threshold: float = 0.85,
    ) -> None:
        self.llm = llm
        self.embed_fn = embed_fn
        self.catalog = catalog_lookup
        self.materials = material_search
        self.model = model
        # #2 — gate de calidad: por debajo de este coseno el material se
        # considera "no encontrado con confianza" (evita usar un material
        # equivocado como pasó con nado contracorriente → KIT OSMOSIS).
        self.min_material_score = min_material_score
        # #1 — safety net: si un componente NO-labor domina el precio directo
        # por encima de este umbral, marcamos review (suele indicar una
        # cantidad alucinada por el LLM, ej. 350× cable en "5 luces").
        self.dominance_threshold = dominance_threshold

    async def compose(self, *, description: str, unit: str, quantity: float = 1.0) -> ComposedResult:
        plan = await self._decompose(description, unit)
        return await self._value(plan)

    # ---- 1. Descomposición (LLM, solo recursos) --------------------------
    async def _decompose(self, description: str, unit: str) -> CompositionPlan:
        res, _usage = await self.llm.generate_structured(
            system_prompt=self._SYS,
            user_prompt=f"Partida: {description} (unidad: {unit})",
            response_schema=CompositionPlan,
            temperature=0.0,
            model=self.model,
        )
        return res or CompositionPlan(main_task=description)

    # ---- 2. Valoración (determinista, contra tablas reales) --------------
    async def _value(self, plan: CompositionPlan) -> ComposedResult:
        breakdown: List[Dict[str, Any]] = []
        notes: List[str] = []
        needs_review = False

        # Mano de obra → labor_rates
        for l in plan.labor:
            rate = await self.catalog.get_labor_rate(query=l.role)
            if rate is None:
                needs_review = True
                notes.append(f"Sin tarifa para mano de obra '{l.role}' (marcado review)")
                price = 0.0
            else:
                price = rate.rate_eur_hour
            breakdown.append(self._row(
                concept=rate.label_es if rate else l.role, type_="LABOR",
                price=price, yield_=l.hours, unit="h",
                code=(rate.id if rate else None),
            ))

        # Maquinaria → material_catalog (fallback simple; mq* dedicado en iteración futura)
        for m in plan.machinery:
            cand, cos = await self._top_material(m.query)
            if cand is None:
                needs_review = True
                notes.append(self._miss_note("Maquinaria", m.query, cos))
                price = 0.0
            else:
                price = float(cand.get("price") or 0.0)
            breakdown.append(self._row(
                concept=(cand.get("name") if cand else m.query), type_="MACHINERY",
                price=price, yield_=m.hours, unit="h",
                code=(cand.get("sku") if cand else None),
            ))

        # Materiales → material_catalog
        for mat in plan.materials:
            cand, cos = await self._top_material(mat.query)
            if cand is None:
                needs_review = True
                notes.append(self._miss_note("Material", mat.query, cos))
                price = 0.0
            else:
                price = float(cand.get("price") or 0.0)
            breakdown.append(self._row(
                concept=(cand.get("name") if cand else mat.query), type_="MATERIAL",
                price=price, yield_=mat.quantity, unit=(mat.unit or (cand.get("unit") if cand else None)),
                code=(cand.get("sku") if cand else None),
            ))

        direct_total = sum(r["total"] for r in breakdown)

        # #1 safety net — cantidad alucinada: si un componente NO-labor lleva una
        # cantidad enorme o domina el precio directo, casi seguro el LLM se
        # equivocó en la cantidad (ej. 350× cable en "5 luces"). Marcamos review
        # (no corregimos: en from_scratch no hay referencia fiable de cantidad).
        non_labor = [r for r in breakdown if r["type"] in ("MATERIAL", "MACHINERY") and r["total"] > 0]
        for r in non_labor:
            share = (r["total"] / direct_total) if direct_total > 0 else 0.0
            if r["quantity"] >= 40 or share >= self.dominance_threshold:
                needs_review = True
                notes.append(
                    f"Revisar cantidad de '{r['concept'][:36]}' (cant={r['quantity']}, "
                    f"{share * 100:.0f}% del directo) — posible sobre-estimación"
                )

        # % medios auxiliares sobre el subtotal directo (convención unit='%')
        if plan.aux_pct and plan.aux_pct > 0 and direct_total > 0:
            aux_total = direct_total * plan.aux_pct / 100.0
            breakdown.append({
                "code": "%", "concept": "Medios auxiliares", "type": "OTHER",
                "unit": "%", "price": round(direct_total, 2), "quantity": plan.aux_pct,
                "yield": plan.aux_pct, "waste": 0.0, "total": round(aux_total, 2),
                "is_variable": False,
            })

        unit_price = round(sum(r["total"] for r in breakdown), 2)
        return ComposedResult(
            unit_price=unit_price, breakdown=breakdown, plan=plan,
            needs_human_review=needs_review, notes=notes,
        )

    async def _top_material(self, query: str):
        """Devuelve ``(candidato | None, coseno)``. #2 — gate de calidad: si el
        coseno del mejor material está por debajo de ``min_material_score``,
        devolvemos ``(None, coseno)`` para que el caller lo trate como 'no
        encontrado con confianza' y marque review, en vez de usar un material
        equivocado (como nado contracorriente → 'KIT OSMOSIS')."""
        try:
            vec = await self.embed_fn(query)
            cands = self.materials.search_materials(query_vector=vec, query_text=query, limit=1)
            if not cands:
                return None, 0.0
            top = cands[0]
            cos = float(top.get("_cosine") or top.get("matchScore") or 0.0)
            return (top if cos >= self.min_material_score else None), cos
        except Exception as e:  # nunca rompe la composición
            logger.warning(f"[compositor] material lookup failed for {query!r}: {e}")
            return None, 0.0

    @staticmethod
    def _miss_note(kind: str, query: str, cosine: float) -> str:
        if cosine > 0:
            return f"{kind} '{query}' sin match fiable (mejor coseno {cosine:.2f}) — review"
        return f"{kind} '{query}' no encontrado en catálogo — review"

    @staticmethod
    def _row(*, concept: str, type_: str, price: float, yield_: float,
             unit: Optional[str], code: Optional[str]) -> Dict[str, Any]:
        total = round(price * yield_, 2)
        return {
            "code": code, "concept": concept, "type": type_,
            "price": round(price, 4), "unit": unit,
            "quantity": yield_, "yield": yield_, "waste": 0.0,
            "total": total, "is_variable": False,
        }

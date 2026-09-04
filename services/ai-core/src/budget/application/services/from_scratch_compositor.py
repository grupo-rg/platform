"""FromScratchCompositor — compone una partida desde recursos ATÓMICOS.

Cuando el Juez marca ``from_scratch`` (ningún candidato del catálogo cubre la
partida), en vez de dejar que el LLM ADIVINE un precio, componemos un
descompuesto auditable con precios REALES:

  - Mano de obra → ``labor_rates_2025`` (``CatalogLookupService.get_labor_rate``).
  - Material     → ``material_catalog`` (``IMaterialSearch``, ~29k OBRAMAT).
  - Maquinaria   → ``machinery_rates_2025`` (tarifa de ALQUILER €/h ×
    horas, vía ``CatalogLookupService.get_machinery_rate``). NUNCA el precio de
    COMPRA del catálogo de materiales — eso inflaba la partida. Si no hay
    tarifa (o es placeholder pendiente), se marca ``needs_human_review`` con
    nota explicativa; jamás se cae al precio de compra.
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
import unicodedata
from typing import Any, Awaitable, Callable, Dict, List, Optional

from pydantic import BaseModel, Field

from src.budget.catalog.application.ports.material_search import IMaterialSearch
from src.budget.catalog.application.services.catalog_lookup_service import (
    CatalogLookupService,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# WS-5 — Herramienta de mano ≠ maquinaria de ALQUILER
# --------------------------------------------------------------------------
# El planificador LLM (``_decompose``) puede listar en ``plan.machinery`` una
# HERRAMIENTA DE MANO (taladro percutor, radial, atornillador…). Eso NO es
# maquinaria de ALQUILER €/h de ``machinery_rates_2025`` (los ~69 códigos mq*):
# es utillaje amortizado en MEDIOS AUXILIARES. Como no tiene tarifa mq*, el
# bucle la emitía como componente MACHINERY a 0,00 € y disparaba
# ``needs_human_review`` — un FALSO POSITIVO que contaminaba la partida.
#
# Filtro DETERMINISTA: cuando un ítem SIN tarifa utilizable parece herramienta
# de mano, NO se emite como componente MACHINERY y NO marca review; queda
# implícitamente cubierto por el % de medios auxiliares (utillaje) que ya se
# calcula sobre el subtotal directo. La maquinaria de ALQUILER real (con tarifa
# mq*) se cotiza EXACTAMENTE igual que antes; un ítem que parece maquinaria de
# verdad pero sin tarifa sigue marcando review (caso legítimo intacto).
#
# Las palabras clave se eligen para NO solapar con ninguno de los 69 labels
# reales (que SÍ llevan tarifa: "Martillo neumático/eléctrico", "Lijadora…",
# "Bandeja … de guiado manual", "Compresor portátil"…). Por eso NO usamos
# términos ambiguos como "martillo", "manual", "lijadora" o "portátil".
_HAND_TOOL_KEYWORDS: frozenset[str] = frozenset({
    "taladro", "taladradora", "percutor", "atornillador", "destornillador",
    "radial", "amoladora", "esmeriladora", "rozadora", "rotaflex",
    "caladora", "ingletadora", "grapadora", "clavadora", "remachadora",
    "pistola", "nivel laser", "flexometro", "escuadra", "alicate",
    "herramienta manual", "herramientas manuales", "herramienta de mano",
    "herramientas de mano", "herramienta menor", "utillaje",
    "utiles manuales", "martillo de mano", "martillo manual",
})

# Raíces de maquinaria PESADA de alquiler: si el término las contiene NO lo
# tratamos como herramienta de mano aunque casara alguna keyword (defensa en
# profundidad; el caso legítimo "maquinaria real sin tarifa" sigue en review).
_RENTAL_MACHINE_HINTS: frozenset[str] = frozenset({
    "retro", "excavad", "camion", "dumper", "grua", "pala cargadora",
    "rodillo", "compactador", "hormigonera", "cisterna", "motonivel",
    "carretilla", "bandeja", "pison", "extendedora", "fratasadora",
    "gunitadora", "central", "martinete", "tractor", "motocultor",
    "desbrozadora", "motosierra",
})


def _strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


# Familias de material donde la especie/tipo concreto importa y el buscador
# semántico suele devolver un "parecido equivocado" (misma familia, tipo distinto)
# cuando el material exacto no está en el catálogo — ej. "haya" → "blindada
# sapelly", "pizarra" → sin piedra. Cada familia: {genérico, especies concretas}.
# Se restringe a MADERA y PIEDRA (donde ocurren los fallos y la distinción es
# nítida); cerámica/metal/vidrio se omiten para no generar falsos positivos.
_MATERIAL_FAMILIES: Dict[str, set] = {
    "madera": {"roble", "haya", "pino", "nogal", "sapelly", "cerezo", "fresno",
               "castano", "iroko", "wenge", "teca", "abeto", "cedro", "okume"},
    "piedra": {"granito", "marmol", "cuarzo", "pizarra", "terrazo", "caliza",
               "arenisca", "basalto", "travertino", "onice"},
}


def _material_fidelity_conflict(query: Optional[str], candidate_name: Optional[str]) -> bool:
    """True si el candidato NO refleja el material CONCRETO pedido en `query`.

    Solo opina cuando `query` pide una ESPECIE concreta de una familia conocida
    (madera/piedra). Acepta (False) si el candidato contiene esa especie o el
    término GENÉRICO de la familia (p.ej. "granito" → candidato con "piedra" es
    OK). Marca conflicto (True) si el candidato trae OTRA especie de la familia
    (haya vs sapelly) o NINGÚN término de esa familia (pizarra sin piedra). Para
    queries sin especie concreta conocida devuelve False (no interviene).
    """
    q = _strip_accents(query or "").lower()
    c = _strip_accents(candidate_name or "").lower()
    for generic, species in _MATERIAL_FAMILIES.items():
        requested = {s for s in species if s in q}
        if not requested:
            continue  # el query no pide una especie concreta de esta familia
        if any(s in c for s in requested):
            return False  # el candidato refleja la especie pedida
        if generic in c:
            return False  # el candidato trae el genérico de la familia (aceptable)
        return True  # otra especie de la familia, o material de la familia ausente
    return False


def _looks_like_hand_tool(query: str) -> bool:
    """True si el término parece HERRAMIENTA DE MANO (utillaje), no maquinaria
    de ALQUILER. Determinista e insensible a acentos. Se excluye si contiene
    pistas de maquinaria pesada de alquiler (defensa en profundidad)."""
    norm = _strip_accents((query or "").lower())
    if any(hint in norm for hint in _RENTAL_MACHINE_HINTS):
        return False
    return any(kw in norm for kw in _HAND_TOOL_KEYWORDS)


# --------------------------------------------------------------------------
# P1 — Guard de plausibilidad de PRECIO UNITARIO (FLAG + auditoría, NO cap)
# --------------------------------------------------------------------------
# ``from_scratch`` YA va a ``needs_human_review``, pero un €/unidad DISPARATADO
# se colaba sin señal explícita (caso real: impermeabilización de suelo de baño
# a 481,35 €/m² cuando lo normal ronda 30-40 €/m²). Este guard NO altera el
# precio: solo adjunta un aviso EXPLÍCITO en ``notes`` y emite telemetría (log
# estructurado ``from_scratch_price_warning``) cuando el precio es un OUTLIER
# CLARO. El objetivo es FLAG + auditabilidad, nunca censura ni cap silencioso.
#
# El criterio es DELIBERADAMENTE CONSERVADOR para NO marcar partidas normales:
#
#   (A) Techo ABSOLUTO por DIMENSIÓN de unidad, fijado MUY por encima del PEM
#       razonable de una partida cotizada en esa unidad (headroom amplio):
#         - area   (m²):    400 €/m²  — la obra premium por m² (fachada
#             ventilada, impermeab. especial, pavimento técnico) rara vez pasa
#             de ~250-300 €/m² en PEM; 400 deja margen holgado y el caso real
#             (481 €/m²) lo supera con claridad.
#         - linear (ml):    600 €/ml  — vigas/elementos lineales caros caben.
#         - volume (m³):   1500 €/m³  — hormigones/resinas especiales caben.
#         - mass   (kg):    100 €/kg  — acero/materiales por kg son € de una
#             cifra; 100 es un techo enorme.
#         - count  (ud):  25000 €/ud  — una "ud" puede ser un equipo entero,
#             así que el techo es ENORME: solo caza absurdos flagrantes.
#       Si la unidad NO se reconoce, NO se aplica techo absoluto (conservador).
#
#   (B) Dominancia + techo genérico: un ÚNICO componente material/maquinaria
#       aporta >70% del ``unit_price`` Y el ``unit_price`` supera un techo
#       GENÉRICO amplio (1000 €/unidad). Caza el caso de unidad no reconocida
#       en el que un componente alucinado (>700 €/unidad él solo) infla el
#       precio, sin depender de conocer la dimensión.
#
# Los SUMINISTROS DE EQUIPO (``plan.is_equipment_supply``) van EXENTOS: ahí un
# único material caro (la máquina que se compra entera) domina POR DISEÑO y el
# precio alto es CORRECTO — marcarlos sería un falso positivo garantizado.
_UNIT_PRICE_CEILING: dict[str, float] = {
    "area": 400.0,
    "linear": 600.0,
    "volume": 1500.0,
    "mass": 100.0,
    "count": 25000.0,
}
_BROAD_UNIT_PRICE_CEILING: float = 1000.0   # techo genérico para el criterio (B)
_DOMINANCE_PRICE_SHARE: float = 0.70        # un componente > 70% del unit_price

# Unidad normalizada (sin acentos ni superíndices; NFKD convierte 'm²'→'m2',
# 'm³'→'m3') → dimensión conocida. Solo estas dimensiones reciben techo (A).
_UNIT_DIMENSION: dict[str, str] = {
    "m2": "area", "mp": "area",
    "ml": "linear", "m": "linear", "mlineal": "linear", "mlin": "linear",
    "m3": "volume",
    "kg": "mass", "kgr": "mass",
    "ud": "count", "u": "count", "un": "count", "uds": "count",
    "unidad": "count", "unidades": "count",
}


def _unit_dimension(unit: Optional[str]) -> Optional[str]:
    """Normaliza la unidad a una DIMENSIÓN conocida (area/linear/volume/mass/
    count) o ``None`` si no la reconocemos. ``_strip_accents`` usa NFKD, que
    además descompone los superíndices: 'm²'→'m2', 'm³'→'m3'."""
    if not unit:
        return None
    u = _strip_accents(unit.strip().lower()).replace(" ", "").replace(".", "")
    return _UNIT_DIMENSION.get(u)


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
    basis: Optional[str] = Field(
        default=None,
        description=(
            "CÓMO se derivó la cantidad: de una DIMENSIÓN del enunciado "
            "(ej. 'espesor 0.15m × 1m² = 0.15 m³') o de un rendimiento estándar "
            "(ej. '12 bloques/m²'). Si no puedes justificarla, es que la estás "
            "inventando — revísala."
        ),
    )


class CompositionPlan(BaseModel):
    main_task: str = Field(description="Tarea principal en una frase")
    dimensions: Optional[str] = Field(
        default=None,
        description="Dimensiones extraídas LITERALMENTE del enunciado (espesor, ancho, alto, largo, área…). Vacío si no hay.",
    )
    is_equipment_supply: bool = Field(
        default=False,
        description=(
            "true si la partida es SUMINISTRO de un EQUIPO/máquina concreta "
            "(bomba, equipo de nado contracorriente, electrolisis, descalcificador…) "
            "que se compra entero — NO se compone de piezas sueltas."
        ),
    )
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
        "valorarla después. PROHIBIDO estimar precios — solo recursos y "
        "cantidades.\n\n"
        "PASO 1 — DIMENSIONES: extrae PRIMERO las dimensiones LITERALES del "
        "enunciado (espesor, ancho, alto, largo, área, diámetro). Ponlas en "
        "'dimensions'. Si no hay, déjalo vacío.\n\n"
        "PASO 2 — CANTIDADES ATERRIZADAS (lo más importante): cada cantidad es "
        "por UNA unidad de la partida y DEBE DERIVARSE de una dimensión del "
        "enunciado o de un rendimiento estándar de construcción — NUNCA "
        "inventada. Justifica CADA cantidad en 'basis' (ej. 'espesor 0.15m × "
        "1 m² = 0.15 m³ de hormigón', '2 caras × 0.5m alto = 1 m²/ml de fábrica', "
        "'12 bloques/m²'). Regla de oro: si NO puedes justificar una cantidad con "
        "una dimensión o un rendimiento, está MAL — no la pongas a ojo. Sé "
        "conservador: un punto de luz no lleva cientos de metros de cable.\n\n"
        "PASO 3 — EQUIPOS: si la partida es SUMINISTRO de un EQUIPO/máquina "
        "concreta (bomba, equipo de nado contracorriente, electrolisis, "
        "descalcificador, grupo de presión…) que se COMPRA ENTERO, marca "
        "is_equipment_supply=true y pon el EQUIPO COMPLETO como UN solo material "
        "(query = nombre del equipo, quantity=1) + algo de mano de obra de "
        "montaje. NO lo desarmes en tubos/válvulas/piezas sueltas.\n\n"
        "PASO 4 — FIDELIDAD DE MATERIAL EXPLÍCITO: si el enunciado indica un material "
        "concreto (marca '[MATERIAL EXPLÍCITO: X]' o mención inequívoca del material), "
        "el MATERIAL PRINCIPAL de la partida DEBE ser ESE material X, con query = ese "
        "material (ej. 'plato de ducha de resina', 'revestimiento de piedra de pizarra', "
        "'puerta de paso de madera de haya', 'encimera de granito'). Es el ingrediente "
        "CENTRAL de la partida, no un extra. PROHIBIDO sustituirlo por otro material "
        "distinto (no ofrezcas acrílico si piden resina, ni una puerta blindada si piden "
        "haya). Si el material pedido no aparece tal cual en el catálogo de materiales, "
        "usa el término del cliente como query igualmente — pero NUNCA cambies de material.\n\n"
        "COHERENCIA DE OFICIO (crítico): incluye SOLO recursos propios del OFICIO y del "
        "ALCANCE de ESTA partida. PROHIBIDO añadir componentes de otro oficio o fase: "
        "nada de maquinaria pesada (excavadora, miniretro, dúmper, grúa, cortadora de "
        "pavimento) en trabajos de acabado, revestimiento, alicatado, carpintería, "
        "vidriería o sanitarios; nada de espuma de tejado, tapajuntas de ventana, "
        "premarcos ni piezas que pertenezcan a OTRA partida. Si la tarea no necesita "
        "maquinaria de alquiler, deja 'machinery' VACÍO (las herramientas de mano van "
        "implícitas en medios auxiliares, no se listan). Regla: si dudas de si un recurso "
        "pertenece a ESTA tarea concreta, NO lo incluyas.\n\n"
        "MANO DE OBRA: usa SOLO categorías base del convenio (no 'fontanero' ni "
        "'electricista' — su categoría base): 'Oficial 1ª', 'Oficial 2ª', "
        "'Oficial 3ª (Ayudante)', 'Peón especializado', 'Peón', 'Capataz', "
        "'Encargado de Obra'."
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
        return await self._value(plan, unit=unit)

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
    async def _value(self, plan: CompositionPlan, unit: str = "") -> ComposedResult:
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

        # Maquinaria → machinery_rates (tarifa de ALQUILER €/h × horas).
        # DETERMINISTA, igual que la mano de obra. NUNCA usamos el precio de
        # COMPRA del material_catalog (eso inflaba la partida). Si no hay tarifa
        # real (o es placeholder pendiente), marcamos review y dejamos precio 0
        # — jamás caemos al precio de compra.
        for m in plan.machinery:
            rate = await self.catalog.get_machinery_rate(query=m.query)
            usable = rate is not None and rate.has_rate

            # WS-5 — herramienta de mano ≠ alquiler: si NO hay tarifa mq*
            # utilizable y el término parece utillaje de mano, NO lo emitimos
            # como MACHINERY ni marcamos review. Es utillaje amortizado, ya
            # cubierto por el % de medios auxiliares sobre el subtotal directo.
            # (La maquinaria real CON tarifa —incl. 'Martillo neumático'— entra
            # por 'usable' y se cotiza normal; la maquinaria real SIN tarifa no
            # casa como herramienta y sigue marcando review más abajo.)
            if not usable and _looks_like_hand_tool(m.query):
                notes.append(
                    f"Herramienta de mano '{m.query}' — no es maquinaria de "
                    f"alquiler (sin tarifa mq* en machinery_rates_2025); tratada "
                    f"como utillaje amortizado en medios auxiliares (no facturada "
                    f"como maquinaria, sin review)"
                )
                continue

            if rate is None:
                needs_review = True
                notes.append(
                    f"Sin tarifa de alquiler (€/h) para maquinaria '{m.query}' en "
                    f"machinery_rates_2025 — marcado review (NO se usa precio de compra)"
                )
                price = 0.0
                concept = m.query
                code = None
            elif not rate.has_rate:
                needs_review = True
                notes.append(
                    f"Tarifa de alquiler PENDIENTE (placeholder) para maquinaria "
                    f"'{rate.label_es}' (id={rate.id}) — rellenar €/h real en "
                    f"machinery_rates_2025; marcado review"
                )
                price = 0.0
                concept = rate.label_es
                code = rate.id
            else:
                price = float(rate.rate_eur_hour or 0.0)
                concept = rate.label_es
                code = rate.id
            breakdown.append(self._row(
                concept=concept, type_="MACHINERY",
                price=price, yield_=m.hours, unit="h",
                code=code,
            ))

        # Materiales → material_catalog
        for mat in plan.materials:
            cand, cos = await self._top_material(mat.query)
            if cand is None:
                needs_review = True
                notes.append(self._miss_note("Material", mat.query, cos))
                concept = mat.query
                price = 0.0
                code = None
                m_unit = mat.unit
            elif _material_fidelity_conflict(mat.query, str(cand.get("name") or "")):
                # El buscador devolvió un "parecido equivocado" (misma familia,
                # especie distinta / material ausente): NO lo usamos como si fuera
                # el material pedido. Conservamos el precio como ORIENTATIVO pero
                # etiquetamos con el material del cliente y marcamos review — así
                # el material equivocado no se cuela silenciosamente.
                needs_review = True
                notes.append(
                    f"Material '{mat.query}' no hallado en catálogo (mejor "
                    f"coincidencia: '{str(cand.get('name'))[:40]}'); precio "
                    f"ORIENTATIVO — revisar material y precio"
                )
                concept = f"{mat.query} (orientativo)"
                price = float(cand.get("price") or 0.0)
                code = None
                m_unit = mat.unit or cand.get("unit")
            else:
                concept = cand.get("name")
                price = float(cand.get("price") or 0.0)
                code = cand.get("sku")
                m_unit = mat.unit or cand.get("unit")
            breakdown.append(self._row(
                concept=concept, type_="MATERIAL",
                price=price, yield_=mat.quantity, unit=m_unit, code=code,
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

        # P1 — guard de plausibilidad del PRECIO UNITARIO (FLAG, NO cap). Si el
        # €/unidad es un outlier claro para la unidad, adjunta aviso explícito
        # en `notes` + telemetría y fuerza review. NO modifica `unit_price`. Ver
        # el bloque de constantes arriba para el criterio y su justificación.
        if self._flag_price_outlier(unit_price=unit_price, unit=unit,
                                    breakdown=breakdown, plan=plan, notes=notes):
            needs_review = True

        return ComposedResult(
            unit_price=unit_price, breakdown=breakdown, plan=plan,
            needs_human_review=needs_review, notes=notes,
        )

    # ---- 2b. Guard de plausibilidad de precio unitario (P1) --------------
    def _flag_price_outlier(
        self, *, unit_price: float, unit: str,
        breakdown: List[Dict[str, Any]], plan: CompositionPlan,
        notes: List[str],
    ) -> bool:
        """Marca (NO corrige) un ``unit_price`` atípico para la unidad de la
        partida. Devuelve ``True`` si disparó (para que el caller fuerce review).

        Conservador por diseño (ver constantes ``_UNIT_PRICE_CEILING`` /
        ``_BROAD_UNIT_PRICE_CEILING``): dispara por (A) techo absoluto generoso
        por dimensión, o (B) un único componente >70% del precio con el precio
        por encima de un techo genérico amplio. Los suministros de equipo van
        EXENTOS (un material caro domina por diseño → falso positivo). Nunca
        altera el precio: solo `notes` + telemetría auditable."""
        if unit_price <= 0 or plan.is_equipment_supply:
            return False

        dim = _unit_dimension(unit)
        reason: Optional[str] = None

        # (A) Techo absoluto por dimensión (solo si la unidad es reconocida).
        ceiling = _UNIT_PRICE_CEILING.get(dim) if dim else None
        if ceiling is not None and unit_price > ceiling:
            reason = (f"{unit_price:.2f} > techo {ceiling:.0f} €/{unit} "
                      f"para unidad tipo '{dim}'")

        # (B) Dominancia de un componente + techo genérico amplio (funciona
        #     aunque la dimensión no se reconozca).
        dominant: Optional[Dict[str, Any]] = None
        if reason is None and unit_price >= _BROAD_UNIT_PRICE_CEILING:
            non_labor = [r for r in breakdown
                         if r["type"] in ("MATERIAL", "MACHINERY") and r["total"] > 0]
            if non_labor:
                dominant = max(non_labor, key=lambda r: r["total"])
                share = dominant["total"] / unit_price
                if share >= _DOMINANCE_PRICE_SHARE:
                    reason = (f"un componente ('{dominant['concept'][:36]}') aporta "
                              f"{share * 100:.0f}% de {unit_price:.2f} €/"
                              f"{unit or 'ud'}")

        if reason is None:
            return False

        notes.append(
            f"⚠️ Precio compuesto atípico: {unit_price:.2f} €/{unit or 'ud'} — "
            f"revisar rendimientos/cantidades ({reason})"
        )
        # Telemetría auditable: log estructurado. El compositor no tiene emitter
        # inyectado (no cambiamos firmas públicas), pero el caller re-emite estas
        # `notes` en el evento `from_scratch_composed` JUNTO con el `code` de la
        # partida, así que la traza queda ligada al código. Este log adicional
        # deja el evento tipado y grep-able en Cloud Logging.
        logger.warning(
            "from_scratch_price_warning %s",
            {
                "event": "from_scratch_price_warning",
                "unit_price": unit_price,
                "unit": unit or None,
                "unit_dim": dim,
                "reason": reason,
                "main_task": (plan.main_task or "")[:80],
                "dominant_component": dominant["concept"] if dominant else None,
            },
        )
        return True

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

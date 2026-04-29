"""
Architect Service — port del `ArchitectAgent` de Node/Genkit.

Toma una petición en lenguaje natural (p.ej. "Reforma integral baño 5m2")
y la desglosa en tareas atómicas de ejecución material (PEM) usando el catálogo
COAATMCA como referencia jerárquica. Si la petición es demasiado ambigua,
devuelve `status='ASKING'` con una pregunta proactiva.

Mantiene las mismas reglas del prompt original (anti-alucinaciones, ecosistemas
obligatorios, reglas paramétricas) para que el output sea equivalente al de Node.
"""

from __future__ import annotations

import json
import logging
import os
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field

from src.budget.application.ports.ports import ILLMProvider

logger = logging.getLogger(__name__)


# Lista idéntica a MAIN_CHAPTERS del agent Node para mantener compatibilidad
# con la validación del catálogo. Usamos str en lugar de Enum en el schema para
# tolerar mayúsculas/minúsculas del LLM.
MAIN_CHAPTERS: List[str] = [
    "DEMOLICIONES", "MOVIMIENTO DE TIERRAS", "HORMIGONES", "FORJADOS",
    "ESTRUCTURAS METALICAS", "CUBIERTAS", "FABRICAS Y TABIQUES", "RED DE SANEAMIENTO",
    "RED DE VENTILACIÓN", "REVOCOS Y ENLUCIDOS", "SOLADOS Y ALICATADOS",
    "CANTERIA Y PIEDRA  ARTIFICIAL", "AISLAMIENTOS", "FIRMES Y PAVIMENTOS",
    "OBRAS VARIAS Y ALBAÑILERIA", "CARPINTERIA DE MADERA", "CERRAJERIA",
    "FONTANERIA Y GAS", "CALEFACCION", "ELECTRICIDAD Y TELECOMUNICACIONES",
    "ENERGIA SOLAR", "AIRE ACONDICIONADO", "APARATOS ELEVADORES", "CONTRAINCENDIOS",
    "PISCINAS", "ACRISTALAMIENTOS", "PINTURA Y REVESTIMIENTOS", "URBANIZACION INTERIOR PARCELA",
    "JARDINERIA", "PAVIMENTOS DE MADERA", "REHABILITACIÓN, REPARACIÓN Y MANTENIMIENTO",
    "BIOCONSTRUCCIÓN", "SEGURIDAD Y SALUD", "ENSAYOS Y CONTROL TECNICO", "UNCLASSIFIED",
]


class ArchitectStatus(str, Enum):
    ASKING = "ASKING"
    COMPLETE = "COMPLETE"


class DecomposedTask(BaseModel):
    taskId: int = Field(description="Identificador entero único secuencial")
    dependsOn: List[int] = Field(default_factory=list, description="Array de taskId de los que depende")
    chapter: str = Field(description="Capítulo principal del catálogo o UNCLASSIFIED")
    subchapter: Optional[str] = Field(default=None, description="Subcapítulo del catálogo")
    reasoning: str = Field(description="Motivo por el cual es necesaria la tarea")
    task: str = Field(description="Descripción genérica de la tarea física")
    userSpecificMaterial: Optional[str] = Field(default=None, description="Material explícito pedido por el usuario")
    isExplicitlyRequested: bool = Field(default=False)
    estimatedParametricUnit: str = Field(description="Unidad lógica (m2, ud, ml, m, m3)")
    estimatedParametricQuantity: float = Field(description="Cantidad estimada")


class ArchitectResponse(BaseModel):
    status: ArchitectStatus
    question: Optional[str] = Field(default=None)
    tasks: List[DecomposedTask] = Field(default_factory=list)


class ArchitectService:
    """Descompone un brief de cliente en tareas atómicas COAATMCA."""

    def __init__(self, llm_provider: ILLMProvider, data_dir: Optional[str] = None):
        self.llm = llm_provider
        # Ruta por defecto: services/ai-core/data/
        self.data_dir = data_dir or os.path.join(
            os.path.dirname(__file__), "..", "..", "..", "..", "data"
        )

    def _load_catalog(self) -> List[dict]:
        path = os.path.join(self.data_dir, "pdf_index_2025.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except FileNotFoundError:
            logger.warning(f"[Architect] catálogo no encontrado en {path}; usando lista vacía")
            return []
        # Aplanamos a {chapter, subchapters[]} como hace el agent Node
        return [
            {
                "chapter": chap.get("name"),
                "subchapters": [s.get("name") for s in (chap.get("subchapters") or [])],
            }
            for chap in raw
        ]

    def _load_dag(self) -> str:
        path = os.path.join(self.data_dir, "construction_dag.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def _build_prompt(self, user_request: str) -> str:
        catalog_json = json.dumps(self._load_catalog(), ensure_ascii=False)
        dag = self._load_dag()
        dag_block = f"\nCONSTRUCTION DAG (FASES LOGICAS DE OBRA):\n{dag}\n" if dag else ""

        return f"""
Eres un Arquitecto Técnico (Aparejador) Experto en España.
Tu trabajo es analizar peticiones de clientes para obras/reformas y desglosarlas en tareas de ejecución atómicas (Presupuesto de Ejecución Material - PEM).{dag_block}

REGLAS CRÍTICAS - PREVENCIÓN DE ASUNCIONES LÓGICAS ERRÓNEAS:
1. DISTINGUE CLARAMENTE entre "CONTEXTO DEL INMUEBLE" y "NUEVO ALCANCE DE OBRA".
2. BAJO NINGUNA CIRCUNSTANCIA interpretes contexto preexistente como orden para instalar algo.
3. ÚNICAMENTE genera tareas para acciones que el cliente EXPLÍCITAMENTE pida ejecutar o reformar.
4. NO INVENTES PRECIOS NI MARCAS. Define genéricamente la tarea física.
5. REGLA DE ESCOMBROS: Si generas demoliciones, añade obligatoriamente una tarea de "Carga, retirada y gestión de escombros".
6. PRINCIPIO DE RESPONSABILIDAD ÚNICA: no agrupes oficios distintos en una sola tarea.
7. REGLA DE OBRA MAYOR: Para reformas integrales, obra nueva o >80m², especifica medios mecánicos en destrucciones. No añadas SEGURIDAD Y SALUD, Gestión de Residuos ni Proyectos (no existen en el catálogo PEM).
8. RESTRICCIONES ESPACIALES: Si el cliente dice "acceso complicado" o "sin maquinaria pesada", especifica "medios manuales o miniexcavadoras" en las tareas correspondientes.
9. FIDELIDAD DE MATERIAL: Si el cliente exige un material concreto (ej. "pared de piedra", "encimera de granito"), OBLIGATORIO rellenar `userSpecificMaterial` con ese valor.
10. REGLA DE DEMOLICIÓN PREVIA: Si pide reformar/alicatar/cambiar pavimentos sobre superficie existente, añade primero una tarea de demolición del acabado antiguo.

CATÁLOGO JERÁRQUICO DE CAPÍTULOS:
{catalog_json}

REGLAS DE CLASIFICACIÓN:
- Clasifica cada tarea con `chapter` EXACTO del catálogo (mayúsculas como en la lista).
- Si no encaja claramente, usa "UNCLASSIFIED".
- Respeta el orden cronológico de obra (Demoliciones → Albañilería → Instalaciones → Revestimientos).

REGLAS DE BUCLE CONVERSACIONAL:
1. TOLERANCIA A LA AMBIGÜEDAD: si pide reforma parcial explícita ("baño 6m2", "cocina 12m2"), asume que solo quiere esa estancia. NO preguntes "¿qué áreas?".
2. SOLO status "ASKING" si la ambigüedad rompe la posibilidad de presupuestar (ej. "reforma la casa" sin m² ni habitaciones). En ese caso: UNA pregunta en `question`, `tasks` vacío.
3. Si la información es clara o asumible, usa "COMPLETE" y deja `question` en null.

REGLAS DE ESTIMACIÓN PARAMÉTRICA:
- Estructura/Cimentación: ~0.35 m³ hormigón por cada m² de planta; NO uses "ud" para estructura.
- Electricidad: ~40 puntos eléctricos por 100m²; unidad "ud" o "puntos".
- Fontanería: ~4-6 puntos de agua por baño/cocina; unidad "ud" o "puntos".
- Superficies: no multipliques por número de tareas en una sola planta.
- Revestimientos de paredes en baño/cocina: multiplica la huella en planta x 2.5 para estimar m² de pared.
- Sanitarios/mobiliario: desglose atómico (inodoro, lavabo, ducha cada uno en su propia tarea).

ECOSISTEMAS OBLIGATORIOS:
- Baño: demolición alicatado + saneamiento + fontanería + aparatos atómicos + grifería + alicatados paredes (huella x 2.5).
- Cocina: fontanería + electricidad + alicatados paredes (huella x 2.5) + mobiliario (ml) + encimera (ml).
- Electricidad: 3 tareas separadas — cuadro general (1 ud), puntos eléctricos (~40/100m²), red de tierra (1 ud).
- Climatización: si piden suelo radiante añade generador (aerotermia/caldera, 1 ud).
- Obra Mayor Envolvente: acondicionamiento terreno → cimentación → estructura → fachada → aislamiento → revestimiento interior.

Petición del cliente:
"{user_request}"

INSTRUCCIONES DE SALIDA:
Devuelve EXCLUSIVAMENTE un objeto JSON con este nivel superior:
{{
  "status": "ASKING" | "COMPLETE",
  "question": "<pregunta proactiva si ASKING, si no null>",
  "tasks": [ <array de tareas si COMPLETE, o vacío> ]
}}

Cada tarea debe tener: `taskId` (int), `dependsOn` (int[]), `chapter` (string del catálogo o UNCLASSIFIED), `subchapter` (string | null), `reasoning` (string), `task` (string descripción física), `userSpecificMaterial` (string | null), `isExplicitlyRequested` (bool), `estimatedParametricUnit` (string), `estimatedParametricQuantity` (number).

`isExplicitlyRequested` = true SOLO si el cliente mencionó la tarea directamente; false para inferencias (escombros, limpieza).
""".strip()

    async def decompose_request(self, user_request: str) -> tuple[ArchitectResponse, dict]:
        """Devuelve (ArchitectResponse, usage_metadata)."""
        prompt = self._build_prompt(user_request)
        logger.info("[Architect] Decomposing request (%d chars)", len(user_request))

        response, usage = await self.llm.generate_structured(
            system_prompt="",
            user_prompt=prompt,
            response_schema=ArchitectResponse,
            temperature=0.1,
            model="gemini-2.5-flash",
            max_output_tokens=8192,
        )
        return response, usage

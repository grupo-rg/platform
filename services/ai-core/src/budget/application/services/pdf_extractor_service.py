from typing import List, Dict, Any, Optional
import logging
import asyncio
import json
import os
import re
import unicodedata
from pydantic import BaseModel, Field

from src.budget.application.ports.ports import ILLMProvider, IGenerationEmitter
from src.budget.catalog.domain.unit import Unit

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# S2-A-03 — Determinismo en extracción de PDF.
#
# Política:
#   1. `temperature=0.0` en ambos extractors (era 0.15 en INLINE).
#   2. Tras extracción, ordenar `RestructuredItem[]` por (page_number,
#      position_y, position_x) si los hay; si no, por orden de aparición.
#   3. Generar `code` fallback determinista si el LLM devuelve uno
#      vacío/inválido: f"AUTO-{page:03d}-{idx:03d}-{slug(description)[:20]}".
#
# Beneficios:
#   - Misma entrada → mismo `code[]` array tras 3 re-corridas (smoke test).
#   - Diff entre runs sólo refleja cambios reales del PDF, no jitter LLM.
#   - El editor del frontend puede confiar en `code` como clave estable.
# ---------------------------------------------------------------------------


def _slug_for_code(description: str, max_chars: int = 20) -> str:
    """Slug determinístico para el fallback de `code`.

    Reglas:
      - Normaliza Unicode (NFD) y quita diacríticos.
      - Mayúsculas, espacios → '-', non-alphanumeric eliminado.
      - Trunca a `max_chars` (default 20).
    """
    if not description:
        return "ITEM"
    # Normaliza acentos: "ñ" → "n", "á" → "a", etc.
    nfd = unicodedata.normalize("NFD", description)
    ascii_only = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    ascii_only = ascii_only.upper()
    # Mantiene letras/dígitos; el resto → '-'.
    slug = re.sub(r"[^A-Z0-9]+", "-", ascii_only).strip("-")
    return (slug[:max_chars] or "ITEM").strip("-") or "ITEM"


def _build_deterministic_code(
    *,
    page_number: int,
    item_index: int,
    description: str,
) -> str:
    """Construye un `code` fallback determinístico.

    Formato: ``AUTO-{page:03d}-{idx:03d}-{slug(description)[:20]}``.
    Misma entrada produce siempre el mismo output.

    Args:
      page_number: número de página (1-indexed o 0-indexed, da igual mientras
        sea consistente entre runs del mismo PDF).
      item_index: índice del item en la página (0-indexed).
      description: descripción de la partida (fuente del slug).
    """
    slug = _slug_for_code(description)
    return f"AUTO-{page_number:03d}-{item_index:03d}-{slug}"


def _is_valid_code(code: Optional[str]) -> bool:
    """Heurística: True si el `code` parece válido (no vacío, no placeholder).

    Códigos válidos típicos: "2.1", "C03.04", "01.02.03", "P-001". Inválidos:
    "", "[REDACTED]", "N/A", "—", etc.
    """
    if not code:
        return False
    s = str(code).strip()
    if not s:
        return False
    # Placeholders / errores del LLM.
    INVALID_TOKENS = {
        "N/A", "NA", "NONE", "NULL", "TBD", "TODO",
        "—", "-", "[REDACTED]", "?", "X", "XX",
    }
    if s.upper() in INVALID_TOKENS:
        return False
    # Debe contener al menos un dígito o letra (no solo símbolos).
    if not re.search(r"[A-Za-z0-9]", s):
        return False
    return True


def _stable_sort_items(items: List["RestructuredItem"]) -> List["RestructuredItem"]:
    """Sort determinístico de items para garantizar reproducibilidad.

    Orden:
      1. `page_number` ascendente (si la propiedad existe).
      2. `position_y_normalized` ascendente (si existe).
      3. `position_x_normalized` ascendente (si existe).
      4. Orden de aparición original (estable; Python sort es estable).

    Si los items no tienen page/position (típico hoy: el extractor no los
    propaga al RestructuredItem), el sort es no-op porque todos los keys
    son None y la estabilidad preserva el orden de entrada.
    """
    # Usamos getattr porque RestructuredItem hoy no tiene estos campos.
    # Cuando los añadamos, el sort empezará a usarlos sin cambios aquí.
    return sorted(
        items,
        key=lambda it: (
            getattr(it, "page_number", None) or 0,
            getattr(it, "position_y_normalized", None) or 0.0,
            getattr(it, "position_x_normalized", None) or 0.0,
        ),
    )


# Sprint 4 Fase A — parser TABULAR coord-based feature flag.
# `USE_TABULAR_PARSER=false` por defecto. Solo se activa en prod tras validar.
def _is_tabular_parser_enabled() -> bool:
    """Kill-switch para el parser TABULAR (Sprint 4 Fase A).

    Lee `USE_TABULAR_PARSER` (default false). Reconoce `true|1|yes|on`
    case-insensitive como "encendido".
    """
    raw = os.environ.get("USE_TABULAR_PARSER", "false").strip().lower()
    return raw in ("true", "1", "yes", "on")


# Sprint 4 Fase A9 — Anomaly detection contra silencio mortal del 14-may.
# Si el extractor llega al fallback LLM Vision para un PDF de más de
# MAX_LLM_VISION_PAGES páginas, abortamos con error explícito hacia la UI
# en vez de procesar silenciosamente durante 60+ minutos.
DEFAULT_MAX_LLM_VISION_PAGES = 50


class LayoutUnsupportedError(Exception):
    """Excepción explícita para layouts que el extractor no puede manejar
    sin caer a un LLM Vision masivo (>50 pp por defecto).

    Llevarla up al use case que la propaga al endpoint, que emite SSE
    `pipeline_error` con `errorType=EXTRACTOR_LAYOUT_UNSUPPORTED`. La UI
    muestra un error claro al usuario en vez del silencio mortal.
    """
    error_code = "EXTRACTOR_LAYOUT_UNSUPPORTED"


def _get_max_llm_vision_pages() -> int:
    """Threshold para abortar antes de invocar LLM Vision masivamente."""
    raw = os.environ.get("MAX_LLM_VISION_PAGES", str(DEFAULT_MAX_LLM_VISION_PAGES)).strip()
    try:
        return max(1, int(raw))
    except (ValueError, TypeError):
        return DEFAULT_MAX_LLM_VISION_PAGES


def _enforce_llm_vision_budget(
    num_pages: int,
    *,
    budget_id: str,
    emit_fn,
    extractor_name: str,
) -> None:
    """Aborta si num_pages supera el threshold (default 50).

    Emite evento SSE `pipeline_error` con código `EXTRACTOR_LAYOUT_UNSUPPORTED`
    + log ERROR antes de levantar la excepción. La UI consumidor del SSE
    muestra un mensaje claro al usuario en vez del silencio mortal del 14-may.
    """
    max_pages = _get_max_llm_vision_pages()
    if num_pages <= max_pages:
        return
    msg = (
        f"Layout no soportado: {extractor_name} caería a LLM Vision para "
        f"{num_pages} páginas (max permitido: {max_pages}). Abortando "
        f"para evitar timeout silencioso."
    )
    logger.error(
        "EXTRACTOR_LAYOUT_UNSUPPORTED budget=%s extractor=%s pages=%d max=%d",
        budget_id, extractor_name, num_pages, max_pages,
    )
    try:
        emit_fn(budget_id, 'pipeline_error', {
            "errorType": LayoutUnsupportedError.error_code,
            "extractor": extractor_name,
            "pagesAttempted": num_pages,
            "maxPagesAllowed": max_pages,
            "message": msg,
            "suggestion": (
                "El PDF parece tener un layout que requiere LLM Vision page-by-page. "
                "Activá USE_TABULAR_PARSER si no lo está, o contactá soporte para "
                "habilitar el flujo PRESTO ANNEXED."
            ),
        })
    except Exception as emit_err:
        logger.warning("emit_fn falló durante enforcement: %s", emit_err)
    raise LayoutUnsupportedError(msg)

# --- Chapter Stabilization Logic (Anti-Hallucination) ---
def extract_chapter_prefix(chapter_str: str) -> str:
    s = str(chapter_str).strip().upper()
    m = re.match(r'^([A-ZÁÉÍÓÚÑ]+[\s\-\.]?\d[\d\.]*)', s)
    if m:
        return re.sub(r'[\s\.\-]', '', m.group(1))
    m = re.match(r'^(\d[\d\.]*)', s)
    if m:
        return re.sub(r'\.', '', m.group(1))
    m = re.match(r'^([IVXLCDM]+)[\.\s]?', s)
    if m:
        return m.group(1)
    return s.split(' ')[0] if s else ''

def consolidate_chapters(items: "List[RestructuredItem]") -> None:
    """Bloquea por CÓDIGO de capítulo el nombre canonical, across todos los items.

    Root cause que arregla: `stabilize_chapter_name` es sin estado — si en el
    orden de extracción aparece C02.01 ("C02 ALBAÑILERIA"), luego C01.01
    ("C01 TRABAJOS PREVIOS"), luego C02.02 ("C02 TABIQUES Y PARTICIONES"), el
    último transiciona `C01 → C02 TABIQUES` y pierde la memoria de "ALBAÑILERIA".
    Resultado: dos chapters C02 coexistiendo.

    Política:
    - Primer nombre COMPLETO visto para un prefijo gana (FIFO).
    - Un "C03" solo-código se reemplaza cuando aparece "C03 AISLAMIENTOS".
    - Items sin prefijo detectable se dejan intactos.

    Mutación in-place (consistente con el resto del pipeline).
    """
    canonical: dict[str, str] = {}

    # Primera pasada: registrar el mejor candidato por prefijo.
    for item in items:
        raw = (item.chapter or "").strip()
        if not raw:
            continue
        prefix = extract_chapter_prefix(raw.upper())
        if not prefix:
            continue
        # Considera "mejor" al nombre con letras tras el prefijo; si el actual
        # canonical es solo el código y ahora vemos uno con nombre, upgradea.
        has_name = len(raw) > len(prefix) + 2  # tolera espacios/tabuladores
        if prefix not in canonical:
            canonical[prefix] = raw
        else:
            existing = canonical[prefix]
            existing_has_name = len(existing) > len(prefix) + 2
            if not existing_has_name and has_name:
                canonical[prefix] = raw

    # Segunda pasada: aplicar el canonical.
    for item in items:
        raw = (item.chapter or "").strip()
        if not raw:
            continue
        prefix = extract_chapter_prefix(raw.upper())
        if prefix and prefix in canonical:
            item.chapter = canonical[prefix]


def stabilize_chapter_name(new_ch: str, curr_ch: str) -> str:
    new_up = str(new_ch if new_ch else "").strip().upper()
    curr_up = str(curr_ch if curr_ch else "").strip().upper()
    
    if not new_up or new_up in ['CONTINUACIÓN_ANTERIOR', 'CONTINUACION_ANTERIOR', 'SIN CAPÍTULO', 'SIN CAPITULO', '']:
        return curr_ch
        
    hallucinations = ['[', 'NOT FOUND', 'NO ESPECIFICADO', 'NO IDENTIFICADO', 'NO ENCONTRADO', 'UNKNOWN', 'UNDEFINED', 'SIN NOMBRE']
    if any(p in new_up for p in hallucinations):
        return curr_ch
        
    if not curr_up or curr_up in ['SIN CAPÍTULO', 'SIN CAPITULO', '']:
        return new_ch.strip()
        
    new_prefix = extract_chapter_prefix(new_up)
    curr_prefix = extract_chapter_prefix(curr_up)
    
    if new_prefix and curr_prefix and new_prefix == curr_prefix:
        if len(new_ch.strip()) > len(curr_ch.strip()) + 3:
            return new_ch.strip()
        return curr_ch.strip()
        
    return new_ch.strip()

# --- Schemas Mapped during Extraction ---
class RestructuredItem(BaseModel):
    code: Optional[str] = Field(default="", description='El código original de la partida (ej. 2.2). Si no tiene, usa "".')
    description: str = Field(description='La descripción de la partida. Resume y unifica si está cortada en varias líneas.')
    quantity: float = Field(default=1.0, description='La cantidad total acumulada para esta partida.')
    unit: Optional[str] = Field(default="ud", description='La unidad de medida de la partida (ej. m2, m3, ud, ml).')
    chapter: Optional[str] = Field(default="Sin Capítulo", description='Nombre del capítulo al que pertenece.')
    # Sprint 4 — sub-capítulo opcional (PRESTO/CIFRE jerarquía 4 niveles).
    # Si el PDF tiene SUBCAPÍTULO XX.YY <name>, se llena aquí. El matcher
    # downstream lo puede usar para mejor contexto sin contaminar description.
    sub_chapter: Optional[str] = Field(
        default=None,
        description='Sub-capítulo opcional (ej. "04.02 Tabiquería de entramado autoportante").',
    )
    # v005: campos de normalización + hints de conversión, opcionales hacia atrás.
    # Los rellena el extractor aguas arriba; el Swarm los lee para habilitar
    # matching 1:N con conversiones físicas.
    unit_normalized: Optional[str] = Field(
        default=None,
        description='Unidad canonical ("ud", "m2", "m3", ...) tras Unit.normalize().',
    )
    unit_dimension: Optional[str] = Field(
        default=None,
        description='Dimensión física ("superficie", "volumen", "tiempo", ...).',
    )
    unit_conversion_hints: Optional[Dict[str, float]] = Field(
        default=None,
        description='Puentes de conversión detectados en la descripción (ej. {"thickness_m": 0.10}).',
    )
    # BC3 — campos que solo rellena el parser FIEBDC-3 (el extractor PDF los deja None).
    bc3_unit_price: Optional[float] = Field(
        default=None,
        description='Precio unitario declarado en el propio BC3. None si es un BC3 ciego (sin precios).',
    )
    measurements: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description='Estado de mediciones estructurado: líneas {comment, units, length, width, height, subtotal, is_section}.',
    )

class RestructureChunkResult(BaseModel):
    items: List[RestructuredItem]
    has_more_items: bool = Field(default=False)
    last_extracted_code: str = Field(default="")
    # --- Cross-page continuity fields (contingencia para partidas divididas entre páginas) ---
    # Rellenados por el LLM cuando detecta fragmentos que atraviesan límites físicos de página.
    # El extractor los usa en una pasada post-fan-out para reconstruir descripciones literales.
    orphan_tail_text: str = Field(
        default="",
        description="Texto sin código al INICIO de esta página que parece ser continuación de la "
                    "descripción de la última partida de la página anterior. Se fusiona con ella "
                    "si la anterior marcó `last_item_truncated: true`."
    )
    last_item_truncated: bool = Field(
        default=False,
        description="True si la última partida de esta página tiene una descripción que claramente "
                    "continúa en la siguiente (línea cortada, viñeta abierta, 'Incluye:' sin valor)."
    )


class MinimalItem(BaseModel):
    """Esquema de fallback cuando Gemini trunca respuestas del esquema completo.
    Mantiene solo lo imprescindible para no perder la página entera."""
    code: Optional[str] = Field(default="")
    description: str
    quantity: float = Field(default=1.0)


class RestructureChunkResultMinimal(BaseModel):
    items: List[MinimalItem]


# ---------------------------------------------------------------------------
# Sprint 3 — S3-06: pdfplumber-first layout parser
# ---------------------------------------------------------------------------
#
# Para PDFs nativos (no escaneados) con tablas claras, priorizamos `pdfplumber`
# como extractor primario para obtener code/description/unit/quantity/chapter
# SIN llamar al LLM Vision. El LLM queda como fallback cuando:
#   - el PDF parece escaneado (texto extraíble < 100 chars en la primera página);
#   - no reconocemos las columnas mínimas (`code`, `description`, `quantity`);
#   - la cobertura heurística cae por debajo del 80% de las partidas esperadas.
#
# Kill-switch: `ENABLE_PDFPLUMBER_FIRST=false` desactiva el fast path.
#
# Beneficios concretos respecto al LLM Vision:
#   - Latencia: <5s para 14 páginas vs ~2-3 min con LLM Vision por página.
#   - Cantidades correctas: la tabla nativa devuelve "5000" donde el LLM Vision
#     se confundía con "1" en cantidades como "5,000\nSótano local…".
#   - Capítulos correctos: leer headers en el flujo lineal del texto (no
#     intentar reconocer un layout visual que cambia entre PDFs).
# ---------------------------------------------------------------------------

# Sinónimos por columna — toleramos variaciones del mismo concepto que aparecen
# en presupuestos reales (COAATMCA, MUSAAT, Presto, CIFRE, exports propios).
_COLUMN_SYNONYMS: Dict[str, List[str]] = {
    "code": ["codigo", "código", "code", "cod", "cod.", "nº", "no", "num", "número"],
    "description": [
        "descripcion", "descripción", "description", "resumen",
        "concepto", "denominacion", "denominación", "definicion",
        "definición", "ud_resumen",
    ],
    "unit": [
        "ud", "u/d", "u/m", "unidad", "unidades", "uni",
        "udmedida", "ud.medida", "um", "u.med", "unit",
    ],
    "quantity": [
        "cantidad", "qty", "medicion", "medición", "cant",
        "cant.", "n", "med", "uds", "número de uds",
    ],
    "price": [
        "precio", "pvp", "imp", "import", "importe", "pu",
        "p.u.", "preciounit", "precio_unit", "price",
        "precio unit", "precio unitario",
    ],
    "total": [
        "total", "importe total", "importe_total", "subtotal",
        "totalpart", "total partida",
    ],
}

# Líneas/filas que NO son partidas reales y deben ser ignoradas.
_SKIP_CELL_KEYWORDS = (
    "TOTAL", "SUMA", "IMPORTE", "SUBTOTAL", "ASCIENDE",
    "PRESUPUESTO", "TOTAL CAPITULO", "TOTAL CAPÍTULO",
    "TOTAL PARTIDA", "TOTAL CAP", "SUMA CAP",
)


def _normalize_cell(s: Optional[Any]) -> str:
    if s is None:
        return ""
    return str(s).strip().lower()


def _infer_column_mapping(header_row: List[Any]) -> Optional[Dict[str, int]]:
    """Mapea conceptos lógicos (`code`, `description`, `unit`, `quantity`, …)
    a índices de columna a partir de la fila cabecera de una tabla.

    Devuelve `None` si faltan los core (`code`, `description`, `quantity`) —
    sin ellos no podemos construir un `RestructuredItem` útil y el caller
    debe caer al LLM Vision.
    """
    if not header_row:
        return None

    mapping: Dict[str, int] = {}
    for idx, cell in enumerate(header_row):
        norm = _normalize_cell(cell)
        if not norm:
            continue
        for concept, synonyms in _COLUMN_SYNONYMS.items():
            if concept in mapping:
                continue  # primer match gana
            for syn in synonyms:
                if syn == norm or syn in norm.split() or norm.startswith(syn):
                    mapping[concept] = idx
                    break

    # Exigimos al menos code + description + quantity para que merezca la pena.
    if not all(k in mapping for k in ("code", "description", "quantity")):
        return None
    return mapping


# Heurísticas de detección de chapter header dentro del texto plano de la página.
# Cubrimos los patrones más frecuentes observados en los smokes Sprint 1+2:
#   - "1 ACTUACIONES PREVIAS" — número solitario + nombre en mayúsculas
#   - "PAT. 2 - FISURAS Y/O GRIETAS EN FORJADOS" — convención MUSAAT/Patologías
#   - "C01 TRABAJOS PREVIOS" / "C01 Capítulo TRABAJOS PREVIOS"
#   - "CAPÍTULO 02 ALBAÑILERÍA"
_CHAPTER_PATTERNS: List[re.Pattern] = [
    re.compile(
        r"^(?P<code>PAT\.?\s*\d+)\s*[-–—]\s*(?P<name>[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,Y/\.\-0-9]+)$",
        re.MULTILINE,
    ),
    re.compile(
        r"^(?P<code>C\d+)\s+(?:Cap[ií]tulo\s+)?(?P<name>[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,Y]+)$",
        re.MULTILINE,
    ),
    re.compile(
        r"^Cap[ií]tulo\s+(?P<code>\d+)\s+(?P<name>[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,Y]+)$",
        re.MULTILINE | re.IGNORECASE,
    ),
    re.compile(
        r"^(?P<code>\d+)\s+(?P<name>[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,Y]{4,})$",
        re.MULTILINE,
    ),
]


def _detect_chapter_header(page: Any) -> Optional[str]:
    """Busca en el texto de la página un encabezado de capítulo.

    Devuelve el header completo (`"1 ACTUACIONES PREVIAS"`, `"PAT. 2 - FISURAS Y/O GRIETAS EN FORJADOS"`)
    o `None` si no encuentra ninguno reconocible.

    Acepta cualquier objeto que tenga `extract_text()` — facilita testeo con
    mocks sin acoplarse a `pdfplumber.Page`.
    """
    try:
        text = page.extract_text() or ""
    except Exception:
        return None
    if not text:
        return None

    for pattern in _CHAPTER_PATTERNS:
        for match in pattern.finditer(text):
            code = match.group("code").strip()
            name = match.group("name").strip()
            # Filtra falsos positivos: líneas que son solo dígitos+texto en
            # mayúsculas suelen ser headers, pero descartamos sumatorios.
            if any(skip in name.upper() for skip in _SKIP_CELL_KEYWORDS):
                continue
            return f"{code} {name}".strip()
    return None


# Regex para extraer la PRIMERA cantidad numérica de una celda, tolerando:
#   - formato español: "5.000,00" → 5000.00
#   - notas pegadas: "5,000\nSótano local. Punto..."
#   - decimales con punto o coma
# Acepta cualquier número de dígitos en el grupo entero. La separación
# español-vs-anglosajón se decide después en `_parse_spanish_number`.
_QUANTITY_RE = re.compile(r"[-+]?\d[\d\.\s]*(?:[,\.]\d+)?")


def _parse_quantity(raw: Any) -> Optional[float]:
    """Parsea una celda de cantidad. Tolera:
      - "5,5" / "5.5" → 5.5
      - "1.000,5" → 1000.5 (formato español con punto miles)
      - "5,000\nSótano local..." → 5000 (toma el primer número)
      - "5000,000" → 5000.0
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None

    # Tomamos el primer token numérico encontrado.
    match = _QUANTITY_RE.search(text)
    if not match:
        return None
    token = match.group(0)
    return _parse_spanish_number(token)


def _parse_spanish_number(s: str) -> Optional[float]:
    """Convierte un literal número con convención española a float.

    Reglas:
      - Si tiene COMA Y PUNTO: la coma es decimal, los puntos son miles
        ("1.000,5" → 1000.5).
      - Si solo tiene COMA: es decimal ("5,5" → 5.5; "5,000" → 5.0,
        salvo que tenga 3+ decimales lo que sugiere miles → 5000).
      - Si solo tiene PUNTOS: depende. "1.000" → 1000 si son exactamente 3
        dígitos tras el punto y el número es entero. "1.5" → 1.5.
      - Sin signos: int(s).
    """
    s = s.strip().replace(" ", "")
    if not s:
        return None
    try:
        has_comma = "," in s
        has_dot = "." in s

        if has_comma and has_dot:
            # Formato español: punto miles, coma decimal.
            normalized = s.replace(".", "").replace(",", ".")
            return float(normalized)
        if has_comma:
            # Coma decimal, sin miles. Excepción: "5,000" con exactamente 3
            # dígitos tras la coma — ambiguo. Lo tratamos como 5000 (la
            # convención de mediciones en presupuestos españoles trata "5,000"
            # como cinco mil para superficies grandes).
            parts = s.split(",")
            if len(parts) == 2 and len(parts[1]) == 3 and parts[1].isdigit():
                # Heurística conservadora: si el número entero tiene 1-2
                # dígitos, "5,000" es 5000 (miles); si tiene 3+, es decimal.
                try:
                    int_part = int(parts[0])
                    if int_part < 100:
                        # Asumimos "5,000" = 5000 (mediciones grandes).
                        return float(parts[0] + parts[1])
                except ValueError:
                    pass
            return float(s.replace(",", "."))
        if has_dot:
            # Solo puntos. "1.000" probablemente son miles si no hay otros
            # signos y tiene exactamente 3 dígitos tras el punto.
            parts = s.split(".")
            if len(parts) == 2 and len(parts[1]) == 3 and parts[1].isdigit():
                return float(parts[0] + parts[1])
            return float(s)
        return float(s)
    except (ValueError, AttributeError):
        return None


def _row_to_restructured_item(
    row: List[Any],
    col_map: Dict[str, int],
    chapter: Optional[str],
    page_number: int,
) -> Optional[RestructuredItem]:
    """Convierte una fila de tabla en `RestructuredItem` o devuelve `None`
    si la fila no es una partida válida (vacía, totales/sumas, código ausente)."""
    if not row:
        return None

    def _cell(key: str) -> str:
        idx = col_map.get(key)
        if idx is None or idx >= len(row):
            return ""
        val = row[idx]
        return str(val).strip() if val is not None else ""

    code = _cell("code")
    description = _cell("description")
    if not code or not description:
        return None

    # Filtros anti-fantasmas: filas que son totales/sumas/etc. NO son partidas.
    description_upper = description.upper()
    if any(kw in description_upper for kw in _SKIP_CELL_KEYWORDS):
        return None
    code_upper = code.upper()
    if any(kw in code_upper for kw in _SKIP_CELL_KEYWORDS):
        return None

    quantity = _parse_quantity(_cell("quantity"))
    if quantity is None:
        quantity = 1.0  # paridad con el LLM (no abortamos: el Swarm puede inferirla)

    unit_raw = _cell("unit") or "ud"
    unit_norm = Unit.normalize(unit_raw)
    unit_dim = Unit.dimension_of(unit_raw)

    # Description puede traer múltiples líneas — las preservamos en una sola
    # (el normalizador downstream maneja whitespace).
    description_clean = " ".join(description.split())

    return RestructuredItem(
        code=code,
        description=description_clean,
        quantity=quantity,
        unit=unit_raw,
        chapter=chapter or "Sin Capítulo",
        unit_normalized=unit_norm,
        unit_dimension=unit_dim,
    )


def _is_pdfplumber_first_enabled() -> bool:
    """Kill-switch. `ENABLE_PDFPLUMBER_FIRST=false` desactiva el fast path."""
    raw = os.environ.get("ENABLE_PDFPLUMBER_FIRST", "true").strip().lower()
    return raw not in ("false", "0", "no", "off")


def extract_with_pdfplumber_first(
    pdf_bytes: bytes,
    raw_items: List[Any],
    *,
    min_coverage: float = 0.80,
) -> Optional[List[RestructuredItem]]:
    """Intento de extracción puramente estructural con pdfplumber.

    Args:
        pdf_bytes: bytes del PDF original.
        raw_items: lista de items "esperados" del flujo actual (para calcular
            cobertura). Si el caller no la tiene, puede pasar una lista vacía
            o `[None] * N` con N estimado.
        min_coverage: ratio mínimo `len(extracted) / len(raw_items)` para
            considerar la heurística viable. Default 0.80.

    Returns:
        list[RestructuredItem] si la extracción heurística produce ≥80%
        de las partidas esperadas con código y unidad reconocidos.
        None si no es viable y hay que caer al LLM Vision.
    """
    if not _is_pdfplumber_first_enabled():
        logger.info("pdfplumber-first deshabilitado via ENABLE_PDFPLUMBER_FIRST=false.")
        return None

    try:
        import pdfplumber
        from io import BytesIO
    except ImportError:
        logger.warning("pdfplumber no disponible — fallback al LLM Vision.")
        return None

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            pages = list(pdf.pages)
            if not pages:
                logger.info("pdfplumber-first: PDF sin páginas.")
                return None

            # 1. Test rápido: ¿el PDF tiene texto extraíble?
            first_page_text = ""
            try:
                first_page_text = pages[0].extract_text() or ""
            except Exception:
                first_page_text = ""

            if len(first_page_text) < 100:
                logger.info(
                    "pdfplumber-first: primera página tiene %d chars — probablemente escaneado.",
                    len(first_page_text),
                )
                return None

            # 2. Iterar páginas extrayendo capítulos y tablas.
            all_items: List[RestructuredItem] = []
            current_chapter: Optional[str] = None

            for page in pages:
                try:
                    page_number = getattr(page, "page_number", 0) or 0
                except Exception:
                    page_number = 0

                # 2a. Detectar header de capítulo. Si existe, actualiza
                # el chapter "actual" para todas las partidas que sigan
                # hasta que aparezca otro header.
                chapter_candidate = _detect_chapter_header(page)
                if chapter_candidate:
                    current_chapter = chapter_candidate

                # 2b. Extraer tablas y mapear a partidas.
                try:
                    tables = page.extract_tables() or []
                except Exception as e:
                    logger.warning(
                        "pdfplumber-first: extract_tables falló en página %s: %s",
                        page_number, e,
                    )
                    continue

                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    header_row = table[0]
                    col_map = _infer_column_mapping(header_row)
                    if not col_map:
                        continue
                    for row in table[1:]:
                        item = _row_to_restructured_item(
                            row, col_map, current_chapter, page_number,
                        )
                        if item:
                            all_items.append(item)

            # 3. Cobertura: ¿extraímos suficientes partidas respecto a lo esperado?
            #    Si el caller no tiene info ("raw_items" vacío), el ratio es ∞
            #    y consideramos viable cuando hay >=1 item.
            expected_count = max(1, len(raw_items)) if raw_items else 0
            if expected_count == 0:
                if not all_items:
                    return None
                coverage = 1.0
            else:
                coverage = len(all_items) / expected_count

            if coverage < min_coverage:
                logger.info(
                    "pdfplumber-first: cobertura %d/%d = %.0f%% < %.0f%% — caer al LLM Vision.",
                    len(all_items), expected_count, coverage * 100, min_coverage * 100,
                )
                return None

            # 4. Stabilize chapter names (consistencia con el resto del pipeline).
            consolidate_chapters(all_items)

            logger.info(
                "pdfplumber-first: %d partidas extraídas en %d páginas (cobertura %.0f%%).",
                len(all_items), len(pages), coverage * 100,
            )
            return all_items
    except Exception as e:
        # Cualquier error inesperado (PDF corrupto, etc.) → fallback limpio.
        logger.warning(
            "pdfplumber-first falló (%s: %s) — fallback al LLM Vision.",
            type(e).__name__, e,
        )
        return None


# --- Map-Reduce Annexed Specific Schemas ---
class DescriptionItem(BaseModel):
    code: str
    description: str
    unit: str
    chapter: str
    # Fase 5.D — mismos hints que `RestructuredItem.unit_conversion_hints`, emitidos
    # directamente por el LLM anexado cuando detecta un puente físico (espesor,
    # densidad, tamaño unitario) en el texto de la descripción.
    unit_conversion_hints: Optional[Dict[str, float]] = Field(
        default=None,
        description='Puentes de conversión detectados en la descripción (ej. {"thickness_m": 0.10}).',
    )

class Phase1Result(BaseModel):
    items: List[DescriptionItem]
    # Fase 7.A — campos para cross-page merge (mismo patrón que INLINE).
    # Cuando una partida queda físicamente truncada al final de la página N,
    # `last_item_truncated=True` avisa al orquestador; el `orphan_tail_text` de la
    # página N+1 (texto huérfano sin código al inicio) se concatena a la descripción
    # de la última partida de N.
    orphan_tail_text: str = Field(default="")
    last_item_truncated: bool = Field(default=False)
    # Deprecated (pre-7.A): `has_more_items` y `cut_item_carryover` se conservan
    # solo por retrocompatibilidad de deserialización. El reduce nunca los leyó,
    # eran dead code. No usar en código nuevo — usar `last_item_truncated` y
    # `orphan_tail_text` respectivamente.
    has_more_items: bool = Field(default=False)
    cut_item_carryover: str = Field(default="")

class SummatoryItem(BaseModel):
    code: str
    total_quantity: float

class Phase2Result(BaseModel):
    items: List[SummatoryItem]

# --- Base Port ---
class IPdfExtractorService:
    def __init__(self, llm_provider: ILLMProvider, emitter: Optional[IGenerationEmitter] = None):
        self.llm = llm_provider
        self.emitter = emitter

    async def extract(self, raw_items: List[Dict[str, Any]], lead_id: str, metrics: Dict) -> List[RestructuredItem]:
        raise NotImplementedError

    def _track_telemetry(self, metrics_dict: Dict, usage: Dict[str, int]):
        metrics_dict["prompt"] += usage.get("promptTokenCount", 0)
        metrics_dict["completion"] += usage.get("candidatesTokenCount", 0)
        metrics_dict["total"] += usage.get("totalTokenCount", 0)
        
        cost_prompt = (usage.get("promptTokenCount", 0) / 1_000_000) * 0.071
        cost_comp = (usage.get("candidatesTokenCount", 0) / 1_000_000) * 0.28
        metrics_dict["cost"] += (cost_prompt + cost_comp)

    def _load_prompt(self, filename: str, **kwargs) -> tuple[str, str]:
        import os, re
        filepath = os.path.join(os.path.dirname(__file__), "../../../../prompts", filename)
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            
        content = re.sub(r"^---.*?---\n", "", content, flags=re.DOTALL)
        parts = re.split(r'\{\{role "(system|user)"\}\}\n', content)
        
        sys_p, usr_p = "", ""
        curr_role = None
        for p in parts:
            if p in ('system', 'user'):
                curr_role = p
            elif curr_role == 'system':
                sys_p = p.strip()
            elif curr_role == 'user':
                usr_p = p.strip()
                
        for k, v in kwargs.items():
            usr_p = usr_p.replace(f"{{{{{k}}}}}", str(v))
            
        return sys_p, usr_p

    def _emit(self, budget_id: str, event_type: str, data: Dict[str, Any]):
        if self.emitter:
            self.emitter.emit_event(budget_id, event_type, data)

# --- Concrete: Inline (Standard) Extractor ---
class InlinePdfExtractorService(IPdfExtractorService):
    async def extract(
        self,
        raw_items: List[Dict[str, Any]],
        budget_id: str,
        metrics: Dict,
        pdf_bytes: Optional[bytes] = None,
    ) -> List[RestructuredItem]:
        logger.info(f"Starting INLINE Restructure Phase for {len(raw_items)} raw items...")
        self._emit(budget_id, 'extraction_started', {"query": f"Lanzando Analista de Estructuras sobre la página..."})

        # Sprint 4 Fase A — parser TABULAR coord-based. Controlado por feature flag
        # `USE_TABULAR_PARSER=false` por defecto. Si activo y el PDF es PRESTO
        # tabular (cabecera CÓDIGO RESUMEN CANTIDAD IMPORTE detectada), procesa
        # con extract_words coord-based — mucho más fiable que LLM Vision para
        # cantidades. Si parser no es viable (<80% qty o <80% chapter), cae a
        # los siguientes fast-paths.
        if pdf_bytes and _is_tabular_parser_enabled():
            try:
                from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser
                _tabular_parser = TabularParser()
                _tabular_result = _tabular_parser.parse(pdf_bytes)
                self._emit(budget_id, 'tabular_parser_started', {
                    "totalPages": _tabular_result.pages_total,
                })
                if _tabular_result.is_viable():
                    _items = _tabular_result.to_restructured_items()
                    logger.info(
                        f"TABULAR parser: {len(_items)} partidas "
                        f"(qty_rate={_tabular_result.qty_rate:.0%}, "
                        f"chapter_rate={_tabular_result.chapter_rate:.0%}, "
                        f"duration={_tabular_result.duration_seconds:.2f}s)."
                    )
                    # Sprint 4 Fase F → Fase H — propagar metadata del documento
                    # (title + address extraídos de las primeras líneas del PDF)
                    # via `metrics` para que el use case downstream pueda usar
                    # `document_title` como fallback del Budget.title cuando el
                    # wizard no provea uno explícito.
                    if _tabular_result.document_title:
                        metrics["document_title"] = _tabular_result.document_title
                    if _tabular_result.document_address:
                        metrics["document_address"] = _tabular_result.document_address
                    self._emit(budget_id, 'inline_fast_path_used', {
                        "partidas_count": len(_items),
                        "method": "tabular_parser_coord_based",
                        "qty_rate": _tabular_result.qty_rate,
                        "chapter_rate": _tabular_result.chapter_rate,
                    })
                    self._emit(budget_id, 'tabular_parser_completed', {
                        "partidasCount": len(_items),
                        "qtyRate": _tabular_result.qty_rate,
                        "chapterRate": _tabular_result.chapter_rate,
                        "durationSeconds": _tabular_result.duration_seconds,
                        "documentTitle": _tabular_result.document_title,
                        "documentAddress": _tabular_result.document_address,
                    })
                    self._emit(budget_id, 'subtasks_extracted', {
                        "count": len(_items),
                        "totalTasks": len(_items),
                    })
                    return _items
                logger.info(
                    f"TABULAR parser viable=False (reason={_tabular_result.reason}); "
                    f"fallback a heurística legacy."
                )
                self._emit(budget_id, 'tabular_parser_aborted', {
                    "reason": _tabular_result.reason,
                    "partidasExtracted": _tabular_result.partidas_count,
                })
            except Exception as e:
                logger.warning(
                    f"TABULAR parser falló silenciosamente "
                    f"({type(e).__name__}: {e}); fallback a heurística legacy."
                )

        # Sprint 3 — S3-06: pdfplumber-first layout parser legacy. Kill-switch
        # `ENABLE_PDFPLUMBER_FIRST=false` por defecto en prod (genera falsos
        # positivos). Se conserva como capa de fallback secundaria; el parser
        # TABULAR de Sprint 4 es el primary path cuando `USE_TABULAR_PARSER=true`.
        if pdf_bytes:
            try:
                tabular_items = extract_with_pdfplumber_first(pdf_bytes, raw_items)
                if tabular_items is not None:
                    logger.info(
                        f"INLINE S3-06 path: {len(tabular_items)} partidas "
                        f"extraídas via pdfplumber tabular sin LLM."
                    )
                    self._emit(budget_id, 'inline_fast_path_used', {
                        "partidas_count": len(tabular_items),
                        "method": "pdfplumber_first_tabular",
                    })
                    self._emit(budget_id, 'subtasks_extracted', {
                        "count": len(tabular_items),
                        "totalTasks": len(tabular_items),
                    })
                    return tabular_items
                logger.info("INLINE S3-06 path NO aplicable; probando layout-analyzer 9.2.")
            except Exception as e:
                logger.warning(
                    f"INLINE S3-06 path falló silenciosamente ({type(e).__name__}: {e}); "
                    f"probando layout-analyzer 9.2."
                )

        # Fase 9.2 — Fast path heurístico. Si recibimos los bytes del PDF,
        # extraemos texto por página y delegamos al LayoutAnalyzer. Si los
        # umbrales se cumplen, devolvemos `RestructuredItem` directamente sin
        # tocar el LLM. Es ~50× más rápido para PDFs con texto extraíble.
        if pdf_bytes:
            try:
                import pdfplumber  # local import para no penalizar arranque
                from io import BytesIO
                from src.budget.layout_analyzer.analyzer import try_heuristic_extraction
                with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
                    text_per_page = [p.extract_text() or "" for p in pdf.pages]
                heuristic_items = try_heuristic_extraction(text_per_page)
                if heuristic_items is not None:
                    logger.info(
                        f"INLINE fast path: {len(heuristic_items)} partidas "
                        f"extraídas via heurística sin LLM."
                    )
                    self._emit(budget_id, 'inline_fast_path_used', {
                        "partidas_count": len(heuristic_items),
                        "method": "layout_analyzer_heuristic",
                    })
                    self._emit(budget_id, 'subtasks_extracted', {
                        "count": len(heuristic_items),
                        "totalTasks": len(heuristic_items),
                    })
                    return heuristic_items
                logger.info("INLINE fast path NO aplicable; cayendo al flujo LLM.")
            except Exception as e:
                logger.warning(
                    f"INLINE fast path falló silenciosamente ({type(e).__name__}: {e}); "
                    f"fallback al flujo LLM."
                )

        CHUNK_SIZE = 1
        chunks = [raw_items[i:i + CHUNK_SIZE] for i in range(0, len(raw_items), CHUNK_SIZE)]

        # Sprint 4 Fase A9 — bloqueo antes de LLM Vision masivo (silencio
        # mortal 14-may). Si el PDF tiene >50 pp y caímos hasta aquí (los
        # fast paths heurísticos no aplicaron), abortar con error claro.
        _enforce_llm_vision_budget(
            len(chunks),
            budget_id=budget_id,
            emit_fn=self._emit,
            extractor_name="InlinePdfExtractorService",
        )

        self._emit(budget_id, 'batch_restructure_submitted', {"query": f"Lote visual dividido en {len(chunks)} páginas atómicas concurrenciales."})

        # 8 páginas paralelas (antes 15): reduce saturación del quota Gemini cuando
        # varias páginas densas fallan simultáneamente; en PDFs limpios el cuello de
        # botella sigue siendo el LLM por página, no la concurrencia.
        semaphore = asyncio.Semaphore(8)
        
        async def process_restructure_chunk(chunk_idx: int, raw_chunk: List[Dict]):
            async with semaphore:
                page_data = raw_chunk[0]
                b64_img = page_data.get("image_base64")

                all_items_for_page = []
                last_code = ""
                iteration = 1
                max_iterations = 4

                accumulated_usage = {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0}

                # Flags de continuidad cross-page. `orphan_tail_text` se toma de la PRIMERA
                # iteración (cuando estamos leyendo el inicio físico de la página). `last_item_truncated`
                # se toma de la ÚLTIMA iteración (la que llegó al final de la página).
                page_orphan_tail = ""
                page_last_item_truncated = False
                
                while iteration <= max_iterations:
                    start_instruction = ""
                    if last_code:
                        start_instruction = f"INSTRUCCIÓN CRÍTICA: Ya extrajiste correctamente hasta la partida {last_code}. IGNORA todo lo anterior a ella. INICIA tu extracción estrictamente desde la partida SIGUIENTE a {last_code} hasta el final físico de la página."
                        
                    sys_prompt, user_prompt = self._load_prompt(
                        "restructure_image_vision.prompt", 
                        image_base64_data="[IMAGEN RAW ENVIADA EN INLINEDATA]",
                        start_instruction=start_instruction
                    )
                    
                    self._emit(budget_id, 'restructuring', {"query": f"Extracción Multimodal Página {chunk_idx + 1}/{len(chunks)} (Iteración {iteration}/{max_iterations})..."})

                    # Intento principal con schema completo.
                    # - S2-A-03: temperature=0.0 para determinismo entre runs
                    #   del mismo PDF. Antes era 0.15 ("para romper el
                    #   truncamiento en retries") pero el coste fue pérdida
                    #   de reproducibilidad. Con `max_output_tokens=16384` el
                    #   truncamiento es marginal; cuando ocurre el adapter
                    #   hace salvage o cae al schema minimal.
                    # - max_output_tokens=16384: doble del default, reduce probabilidad de cortar.
                    # Si el adapter detecta JSON truncado, hace salvage internamente y devuelve
                    # `usage['_salvaged'] = True` + `_items_recovered`.
                    partial_res = None
                    usage = None
                    try:
                        partial_res, usage = await self.llm.generate_structured(
                            system_prompt=sys_prompt,
                            user_prompt=user_prompt,
                            response_schema=RestructureChunkResult,
                            temperature=0.0,
                            image_base64=b64_img,
                            max_output_tokens=16384,
                        )
                        # Si el adapter rescató un JSON truncado, lo señalamos en la telemetría
                        # para que el panel admin y el UI muestren el parcial como "rescatado".
                        if usage and usage.get("_salvaged"):
                            self._emit(budget_id, 'extraction_partial_success', {
                                "page": chunk_idx + 1,
                                "items_recovered": usage.get("_items_recovered", len(partial_res.items) if partial_res else 0),
                            })
                    except Exception as primary_err:
                        # Schema completo agotó reintentos (típicamente JSON truncado en páginas
                        # densas). Caemos a un schema minimal para rescatar al menos code/desc/qty.
                        logger.warning(f"[extractor] Página {chunk_idx + 1}: schema completo falló ({primary_err}); reintento con schema minimal.")
                        self._emit(budget_id, 'extraction_retry_minimal', {
                            "page": chunk_idx + 1,
                            "attempt": iteration,
                            "reason": str(primary_err)[:200],
                        })
                        try:
                            minimal_res, usage = await self.llm.generate_structured(
                                system_prompt=sys_prompt,
                                user_prompt=user_prompt,
                                response_schema=RestructureChunkResultMinimal,
                                temperature=0.0,
                                image_base64=b64_img,
                                max_output_tokens=4096,  # respuestas más cortas para reducir truncamiento
                            )
                            if minimal_res and minimal_res.items:
                                # Promocionamos los MinimalItem a RestructuredItem con defaults
                                promoted = [
                                    RestructuredItem(
                                        code=it.code or "",
                                        description=it.description,
                                        quantity=it.quantity,
                                        unit="ud",
                                        chapter="Sin Capítulo",
                                    ) for it in minimal_res.items
                                ]
                                partial_res = RestructureChunkResult(
                                    items=promoted,
                                    has_more_items=False,
                                    last_extracted_code="",
                                )
                        except Exception as minimal_err:
                            logger.error(f"[extractor] Página {chunk_idx + 1}: también falló minimal ({minimal_err}). Página omitida.")
                            self._emit(budget_id, 'extraction_failed_chunk', {
                                "page": chunk_idx + 1,
                                "error": str(minimal_err)[:200],
                            })
                            break  # saltamos esta página pero NO abortamos el job

                    if usage:
                        for k in accumulated_usage:
                            accumulated_usage[k] += usage.get(k, 0)

                    if partial_res and partial_res.items:
                        all_items_for_page.extend(partial_res.items)

                        # Sólo capturamos orphan_tail en la PRIMERA iteración (inicio físico de la página).
                        if iteration == 1 and getattr(partial_res, "orphan_tail_text", ""):
                            page_orphan_tail = partial_res.orphan_tail_text

                        if partial_res.has_more_items and partial_res.last_extracted_code:
                            last_code = partial_res.last_extracted_code
                            iteration += 1
                        else:
                            # Última iteración (final físico de la página) — capturamos si la última
                            # partida quedó truncada por corte de página.
                            page_last_item_truncated = bool(getattr(partial_res, "last_item_truncated", False))
                            break
                    else:
                        break

                merged_res = RestructureChunkResult(
                    items=all_items_for_page,
                    has_more_items=False,
                    last_extracted_code="",
                    orphan_tail_text=page_orphan_tail,
                    last_item_truncated=page_last_item_truncated,
                )
                self._emit(budget_id, 'restructuring', {"query": f"Página {chunk_idx + 1}/{len(chunks)} consolidada (Total partidas: {len(all_items_for_page)})."})
                return chunk_idx, merged_res, accumulated_usage
                
        tasks = [process_restructure_chunk(idx, chunk) for idx, chunk in enumerate(chunks)]
        results_group = await asyncio.gather(*tasks, return_exceptions=True)

        # Ordenamos por chunk_idx (el paralelismo rompe el orden de llegada) y hacemos una
        # pasada de merge cross-page antes de consolidar: si la página N terminó con una partida
        # truncada físicamente y la N+1 empezó con texto huérfano sin código, concatenamos
        # el texto huérfano a la descripción de la última partida de N. Preserva literalidad.
        ordered_pages: List[tuple] = sorted(
            [r for r in results_group if isinstance(r, tuple)],
            key=lambda r: r[0],
        )
        for i in range(len(ordered_pages) - 1):
            current_idx, current_parsed, _ = ordered_pages[i]
            next_idx, next_parsed, _ = ordered_pages[i + 1]
            if current_parsed.last_item_truncated and next_parsed.orphan_tail_text and current_parsed.items:
                tail = next_parsed.orphan_tail_text.strip()
                if tail:
                    current_parsed.items[-1].description = (
                        current_parsed.items[-1].description.rstrip() + " " + tail
                    )
                    self._emit(budget_id, 'cross_page_merge', {
                        "from_page": current_idx + 1,
                        "to_page": next_idx + 1,
                        "tail_chars": len(tail),
                    })
                    # Marcamos como consumido para evitar que otro reuse lo fusione.
                    next_parsed.orphan_tail_text = ""

        # Los items ya vienen mutados en ordered_pages; el bucle de consolidación
        # mantenemos su lógica original (logging por fallo, métricas por página).
        # S2-A-03: iteramos ordered_pages (no results_group) para garantizar
        # orden estable por page_number. results_group viene del gather y su
        # orden es no-determinístico aunque el sort de ordered_pages SÍ lo es.
        consolidated = []
        consolidated_with_page: List[tuple[int, RestructuredItem]] = []
        for i, res in enumerate(results_group):
            if isinstance(res, Exception):
                logger.error(f"Error procesando página visual {i}: {res}")
        for chunk_idx, parsed, usage in ordered_pages:
            self._track_telemetry(metrics, usage)
            for item_idx, item in enumerate(parsed.items):
                # S2-A-03: code fallback determinístico. Si el LLM emite un
                # code vacío/placeholder, generamos AUTO-{page:03d}-{idx:03d}-{slug}.
                # Misma entrada → mismo output entre runs.
                if not _is_valid_code(item.code):
                    item.code = _build_deterministic_code(
                        page_number=chunk_idx + 1,
                        item_index=item_idx,
                        description=item.description or "",
                    )
                consolidated.append(item)
                consolidated_with_page.append((chunk_idx, item))

        final_items = []
        current_chapter = "Sin Capítulo"
        for item in consolidated:
            current_chapter = stabilize_chapter_name(item.chapter, current_chapter)
            item.chapter = current_chapter
            # Fase 5.B — normalización determinista server-side. Guarda `is None`
            # respeta valores que el LLM ya hubiera emitido (idempotente).
            if item.unit_normalized is None:
                item.unit_normalized = Unit.normalize(item.unit)
            if item.unit_dimension is None:
                item.unit_dimension = Unit.dimension_of(item.unit)
            final_items.append(item)

        # Fase 8.C — lock por código canonical: elimina capítulos duplicados
        # ("C02 ALBAÑILERIA" y "C02 TABIQUES Y PARTICIONES" coexistiendo).
        consolidate_chapters(final_items)

        # S2-A-03: sort estable por page/position. Hoy no propagamos position
        # del LLM, así que el sort cae al orden de aparición — pero el orden
        # de aparición ya está garantizado por iterar ordered_pages arriba.
        final_items = _stable_sort_items(final_items)

        # Filtro Anti-Fantasmas — ya no debería eliminar nada porque el code
        # fallback rellena los vacíos, pero mantenemos por seguridad (un
        # `code` insanitizado por edge cases todavía podría llegar).
        valid_items = [item for item in final_items if item.code and str(item.code).strip() != ""]
        total_valid = len(valid_items)

        self._emit(budget_id, 'subtasks_extracted', {"count": total_valid, "totalTasks": total_valid})
        self._emit(budget_id, 'batch_restructure_submitted', {"query": f"Extracción Finalizada. Consolidando {total_valid} partidas..."})
        return valid_items

# --- Concrete: Annexed (MapReduce) Extractor ---
class AnnexedPdfExtractorService(IPdfExtractorService):
    # Fase 5.D — paridad de parámetros con INLINE. Expuestos como constantes de
    # clase para que una regresión futura (alguien restaura temp=0.0 o concurrencia 15)
    # salte en el diff de la clase, no enterrada dentro del método extract().
    CONCURRENCY: int = 8
    # S2-A-03: 0.0 para determinismo. Era 0.15 para romper truncamientos en
    # retries; con max_output_tokens=16384 y salvage el truncamiento es raro.
    TEMPERATURE: float = 0.0
    MAX_OUTPUT_TOKENS: int = 16384
    # Fase 7.C: umbral por debajo del cual una descripción se considera
    # sospechosamente corta (el LLM probablemente solo capturó el título y el
    # cross-page merge de 7.B no tuvo señal para disparar). No filtra el item
    # — solo emite señal (log + evento SSE) para intervención humana.
    MIN_DESCRIPTION_CHARS: int = 50

    async def extract(self, pages_chunks: List[Dict[str, Any]], budget_id: str, metrics: Dict) -> List[RestructuredItem]:
        logger.info(f"Starting ANNEXED (MapReduce) Batch Restructure Phase for {len(pages_chunks)} pages...")
        self._emit(budget_id, 'extraction_started', {"query": f"Desplegando Analista Documental sobre documento multipágina ({len(pages_chunks)} páginas)..."})

        # Sprint 4 Fase A9 — bloqueo antes de LLM Vision masivo (silencio
        # mortal 14-may). El extractor ANNEXED es el camino caliente del PDF
        # RdLL 258pp; sin este enforcement repite el incidente.
        _enforce_llm_vision_budget(
            len(pages_chunks),
            budget_id=budget_id,
            emit_fn=self._emit,
            extractor_name="AnnexedPdfExtractorService",
        )

        # En producción "real", el Endpoint separa los `raw_items` en descriptivos y contables.
        # Asumimos que los primeros N-1 son literatura y la página `raw_items[-1]` es mediciones.
        # Aquí puedes iterar o usar una heurística. Como POC robusto:

        if len(pages_chunks) < 2:
            # Fallback a inline si no hay modo de hacer mapreduce
            inline_svc = InlinePdfExtractorService(self.llm, self.emitter)
            return await inline_svc.extract(pages_chunks, budget_id, metrics)
            
        desc_pages = [p for p in pages_chunks if not p.get("is_summatory", False)]
        summ_pages = [p for p in pages_chunks if p.get("is_summatory", False)]
        
        # Fallback heurístico si no vienen taggeadas: MITAD Y MITAD (Solo para safety, idealmente vienen de UI)
        if not desc_pages or not summ_pages:
            mid = len(pages_chunks) // 2
            desc_pages = pages_chunks[:mid]
            summ_pages = pages_chunks[mid:]
        
        semaphore = asyncio.Semaphore(self.CONCURRENCY)

        # --- Fase Map: Descripciones ---
        # Fase 7.B: ahora devolvemos el Phase1Result completo (no solo .items)
        # para poder ejecutar cross-page merge en el reduce.
        async def process_desc_page(chunk_idx: int, page_data: Dict):
            async with semaphore:
                b64_img = page_data.get("image_base64")
                sys_prompt, user_prompt = self._load_prompt("vision_annexed_descriptions.prompt", image_base64_data="[IMAGE_B64]")
                self._emit(budget_id, 'restructuring', {"query": f"Mapeando Literatura de Obra (Página {chunk_idx+1}/{len(desc_pages)})..."})
                res, usage = await self.llm.generate_structured(
                    system_prompt=sys_prompt, user_prompt=user_prompt,
                    response_schema=Phase1Result,
                    temperature=self.TEMPERATURE,
                    image_base64=b64_img,
                    max_output_tokens=self.MAX_OUTPUT_TOKENS,
                )
                if usage: self._track_telemetry(metrics, usage)
                return (chunk_idx, res, usage)

        desc_tasks = [process_desc_page(idx, p) for idx, p in enumerate(desc_pages)]
        desc_results = await asyncio.gather(*desc_tasks, return_exceptions=True)

        # Fase 7.B: merge cross-page antes de consolidar. Mismo patrón que
        # INLINE (líneas ~331-346): si página N marca `last_item_truncated` y
        # página N+1 trae `orphan_tail_text` no vacío, fusionamos la cola a la
        # descripción de la última partida de N. Los eventos SSE emitidos
        # (`cross_page_merge_annexed`) dan trazabilidad en el panel de pipelines.
        ordered_pages: List[tuple] = sorted(
            [r for r in desc_results if isinstance(r, tuple) and r[1] is not None],
            key=lambda r: r[0],
        )
        for i in range(len(ordered_pages) - 1):
            cur_idx, cur_parsed, _ = ordered_pages[i]
            nxt_idx, nxt_parsed, _ = ordered_pages[i + 1]
            tail = (nxt_parsed.orphan_tail_text or "").strip()
            if cur_parsed.last_item_truncated and tail and cur_parsed.items:
                last_item = cur_parsed.items[-1]
                last_item.description = last_item.description.rstrip() + " " + tail
                self._emit(budget_id, 'cross_page_merge_annexed', {
                    "from_page": cur_idx + 1,
                    "to_page": nxt_idx + 1,
                    "tail_chars": len(tail),
                    "partida_code": last_item.code,
                })
                nxt_parsed.orphan_tail_text = ""  # marca consumido

        all_descriptions: List[DescriptionItem] = []
        for _, parsed, _ in ordered_pages:
            all_descriptions.extend(parsed.items)
            
        # --- Fase Map: Sumatorias ---
        async def process_summ_page(chunk_idx: int, page_data: Dict):
            async with semaphore:
                b64_img = page_data.get("image_base64")
                sys_prompt, user_prompt = self._load_prompt("vision_annexed_summatory.prompt", image_base64_data="[IMAGE_B64]")
                self._emit(budget_id, 'restructuring', {"query": f"Auditando Mediciones Contables en Anexos (Página {chunk_idx+1}/{len(summ_pages)})..."})
                res, usage = await self.llm.generate_structured(
                    system_prompt=sys_prompt, user_prompt=user_prompt,
                    response_schema=Phase2Result,
                    temperature=self.TEMPERATURE,
                    image_base64=b64_img,
                    max_output_tokens=self.MAX_OUTPUT_TOKENS,
                )
                if usage: self._track_telemetry(metrics, usage)
                return res.items if res else []

        summ_tasks = [process_summ_page(idx, p) for idx, p in enumerate(summ_pages)]
        summ_results = await asyncio.gather(*summ_tasks)
        
        all_summatories = []
        for r in summ_results:
            if isinstance(r, list): all_summatories.extend(r)
            
        # --- Fase Reduce (El Diccionario) ---
        self._emit(budget_id, 'restructuring', {"query": f"Cruzando {len(all_descriptions)} descripciones con {len(all_summatories)} mediciones de obra..."})
        
        def normalize_code(code_str: str) -> str:
            return re.sub(r'[^0-9]', '', str(code_str))
            
        sum_dict = {normalize_code(i.code): i.total_quantity for i in all_summatories}
        
        final_items: List[RestructuredItem] = []
        current_chapter = "Sin Capítulo"

        for desc_idx, d in enumerate(all_descriptions):
            norm_code = normalize_code(d.code)
            qty = sum_dict.get(norm_code, 0.0)

            current_chapter = stabilize_chapter_name(d.chapter, current_chapter)
            ch_final = current_chapter

            # Fase 7.C — guard rail: descripciones sospechosamente cortas suelen
            # ser síntoma de cross-page merge fallido. Logueamos + emitimos SSE;
            # NO filtramos el item (mejor item dudoso con señal que pipeline
            # roto sin señal).
            desc_clean = (d.description or "").strip()
            if len(desc_clean) < self.MIN_DESCRIPTION_CHARS:
                logger.warning(
                    "[annexed] Partida %s (cap %s) tiene descripción corta: %d chars (umbral %d). Preview: %r",
                    d.code, ch_final, len(desc_clean), self.MIN_DESCRIPTION_CHARS, desc_clean[:40],
                )
                self._emit(budget_id, 'partida_description_short', {
                    "code": d.code,
                    "chars": len(desc_clean),
                    "chapter": ch_final,
                    "preview": desc_clean[:40],
                })

            # S2-A-03: code fallback determinístico (mismo patrón que INLINE).
            final_code = d.code if _is_valid_code(d.code) else _build_deterministic_code(
                # Para ANNEXED no tenemos `page_number` per item; usamos el
                # índice global de la descripción como sustituto reproducible.
                page_number=1,
                item_index=desc_idx,
                description=d.description or "",
            )

            final_items.append(RestructuredItem(
                code=final_code,
                description=d.description,
                unit=d.unit,
                quantity=qty,
                chapter=ch_final,
                # Fase 5.D — paridad con INLINE (5.B): normalizamos la unidad y
                # propagamos el hint que el LLM anexado haya emitido en Phase1.
                unit_normalized=Unit.normalize(d.unit),
                unit_dimension=Unit.dimension_of(d.unit),
                unit_conversion_hints=d.unit_conversion_hints,
            ))

        # Fase 8.C — lock por código canonical: elimina capítulos duplicados
        # en el flujo ANNEXED (mismo fix que INLINE).
        consolidate_chapters(final_items)

        # S2-A-03: sort estable. Si el LLM no propaga position, cae al orden
        # de aparición (ya garantizado por `ordered_pages` arriba en INLINE,
        # y por `all_descriptions` aquí en ANNEXED que respeta la secuencia
        # de las páginas tras el sort por chunk_idx).
        final_items = _stable_sort_items(final_items)

        valid_items = [i for i in final_items if i.code and str(i.code).strip() != ""]
        self._emit(budget_id, 'subtasks_extracted', {"count": len(valid_items), "totalTasks": len(valid_items)})
        return valid_items

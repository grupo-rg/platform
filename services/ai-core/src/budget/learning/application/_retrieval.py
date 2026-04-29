"""Helpers puros de retrieval (fuzzy + filtros), reutilizados por los adapters.

Extraídos del in-memory impl para que el adapter Firestore pueda aplicar
exactamente la misma lógica tras hacer stream de la colección.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Iterable

from src.budget.domain.entities import HeuristicFragment


# Tokens vacíos en castellano — descartados al comparar para que no inflen el
# score por casualidad ("de la el con y o que ...").
_STOPWORDS = frozenset({
    "de", "del", "la", "el", "los", "las", "un", "una", "y", "o", "u", "en",
    "con", "sin", "por", "para", "que", "se", "su", "sus", "al", "lo", "le",
    "es", "son", "ha", "han", "como", "más", "menos", "este", "esta", "estos",
    "estas", "ese", "esa", "eso", "a",
})

_TOKEN_RE = re.compile(r"[a-záéíóúñü0-9]{3,}", re.IGNORECASE | re.UNICODE)


def _tokenize(text: str) -> set[str]:
    """Extrae tokens significativos (≥3 chars, sin stopwords, lowercase)."""
    raw = _TOKEN_RE.findall((text or "").lower())
    return {t for t in raw if t not in _STOPWORDS}


def _token_coverage(short_text: str, long_text: str) -> float:
    """Fracción de tokens significativos del texto MÁS CORTO que aparecen
    en el MÁS LARGO. Robusto a desigualdad de longitud (descripción larga
    de partida vs descripción corta de fragment).

    Devuelve 0 si el texto corto no tiene tokens significativos.
    """
    short_tokens = _tokenize(short_text)
    long_tokens = _tokenize(long_text)
    if not short_tokens:
        return 0.0
    overlap = short_tokens & long_tokens
    # Floor de 4 para que fragments con muy pocos tokens no obtengan
    # coverage perfecta con apenas 1-2 palabras compartidas.
    return len(overlap) / max(len(short_tokens), 4)


def _similarity(a: str, b: str) -> float:
    """Score robusto a desigualdad de longitud.

    Fase 13.E — combina dos métricas:
      1. SequenceMatcher.ratio() — penaliza desigualdad de longitud pero
         da buen score cuando ambos textos son similares en tamaño.
      2. token_coverage — qué fracción de tokens significativos del texto
         MÁS CORTO aparece en el MÁS LARGO. Robusto a asimetría
         partida(300) vs fragment(60).

    Estrategia: `max(ratio, coverage)` cuando hay overlap de tokens; si
    coverage=0 penalizamos el ratio (SequenceMatcher infla por chars
    compartidos sin contenido).
    """
    base_ratio = SequenceMatcher(None, a.lower(), b.lower()).ratio()
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    coverage = _token_coverage(short, long_)
    if coverage == 0.0:
        # Sin contenido común → ratio sólo refleja patrones de letras (de/de/en)
        # y no debe activar el retrieval. Penalizamos a la mitad.
        return base_ratio * 0.5
    return max(base_ratio, coverage)


def _extract_chapter_code(partida_code: str | None) -> str | None:
    """Extrae el código de capítulo desde el código de partida.

    Convención COAATMCA: las partidas vienen como `NN.MM` (ej. '01.06', '02.03')
    donde `NN` es el código de capítulo. Es invariante run-a-run, lo extrae el
    layout analyzer del propio PDF, no depende del LLM.

    Returns:
        '01' / '02' / etc. con padding a 2 chars, o None si el code no encaja
        el patrón.
    """
    if not partida_code:
        return None
    code = partida_code.strip()
    if "." not in code:
        return None
    head = code.split(".", 1)[0].strip().lstrip("0")
    if not head:
        return "00"  # caso degenerado: '0.X' o '00.X'
    return head.zfill(2)


def _has_chapter_tag(
    fragment: HeuristicFragment,
    chapter: str,
    partida_code: str | None = None,
) -> bool:
    """Decide si el fragment aplica al chapter de la partida.

    Pipeline (en orden, primer match gana):
    1. `cross_chapter:true` en tags → bypass total (Fase 14.D).
    2. `chapter_code:NN` (estable, leído del PDF) — match autoritativo si
       `partida_code` está disponible. NN se extrae con `_extract_chapter_code`.
    3. `chapter:NAME` — fallback substring match case-insensitive (legacy
       Fase 13.E). Útil cuando partida_code no esté presente o cuando el
       fragment no tenga `chapter_code` (datos antiguos).

    El `chapter_code` es el ÚNICO identificador estable: el nombre del capítulo
    cambia entre runs según interpretación del extractor LLM (ej. run-5
    'DEFICIENCIAS IEE HENRI DUNANT' vs run-6 'Subsanación de deficiencias IEE').
    """
    if _has_cross_chapter_tag(fragment):
        return True

    # 2 — chapter_code (estable, autoritativo).
    if partida_code:
        partida_chapter_code = _extract_chapter_code(partida_code)
        if partida_chapter_code:
            for tag in fragment.tags:
                tlow = tag.lower()
                if tlow.startswith("chapter_code:"):
                    tag_code = tlow.split(":", 1)[1].strip()
                    # Normalizar mismo padding
                    tag_code = tag_code.lstrip("0").zfill(2) if tag_code else ""
                    if tag_code and tag_code == partida_chapter_code:
                        return True

    # 3 — fallback chapter:NAME substring (legacy).
    chapter_lower = (chapter or "").lower()
    for tag in fragment.tags:
        if not tag.lower().startswith("chapter:"):
            continue
        # Excluir 'chapter_code:' de este branch (chapter:X != chapter_code:X)
        if tag.lower().startswith("chapter_code:"):
            continue
        tag_value = tag.split(":", 1)[1].strip().lower()
        if not tag_value:
            continue
        if tag_value in chapter_lower:
            return True
    return False


def _has_cross_chapter_tag(fragment: HeuristicFragment) -> bool:
    """True si el fragment lleva `cross_chapter:true` — aplicable a cualquier
    capítulo (ej. fragments de medios auxiliares, partida alzada genéricos)."""
    for tag in fragment.tags:
        if tag.lower() == "cross_chapter:true":
            return True
    return False


# Fase 14.C — tag-based filtering por tipo de elemento.
# Reduce el ruido cross-partida: frag-01-04-pilastras dejaba de "filtrarse"
# en 01.09 barandilla, 01.10 tabique, 01.12 contenedor (Judge los ignoraba
# correctamente, pero pollutaban el prompt).
_META_TAG_PREFIXES = (
    "scope:",
    "chapter:",
    "principle:",
    "multiplier:",
    "surface_band:",
    "reason:",
    "cross_chapter:",
)

# Mapping keyword(en descripción) → topic tags emitidos.
# Los topic tags del fragment deben intersectar este set para pasar el filtro.
_TOPIC_KEYWORDS: dict[str, set[str]] = {
    # Estructurales hormigón armado
    "pilar": {"pilar_pilastra_vigueta_canto", "reparacion_estructural", "hormigon_armado"},
    "pilastra": {"pilar_pilastra_vigueta_canto", "reparacion_estructural", "hormigon_armado"},
    "vigueta": {"pilar_pilastra_vigueta_canto", "reparacion_estructural", "hormigon_armado"},
    "jácena": {"pilar_pilastra_vigueta_canto", "reparacion_estructural", "hormigon_armado"},
    "jacena": {"pilar_pilastra_vigueta_canto", "reparacion_estructural", "hormigon_armado"},
    "canto": {"pilar_pilastra_vigueta_canto", "reparacion_estructural"},
    "forjado": {"pilar_pilastra_vigueta_canto", "reparacion_estructural"},
    "zuncho": {"pilar_pilastra_vigueta_canto", "reparacion_estructural"},
    # Marquesina
    "marquesina": {"marquesina", "retirada", "iee_ligero"},
    # Demoliciones
    "falso techo": {"falso_techo", "demoliciones"},
    "cielo raso": {"falso_techo", "demoliciones"},
    # Yeso
    "yeso": {"yeso", "picado_tendido"},
    "guarnecido": {"yeso"},
    "enlucido": {"yeso"},
    # Pintura
    "pintura": {"pintura", "exterior", "fachada"},
    "pintar": {"pintura"},
    # Medios auxiliares
    "medios auxiliares": {"medios_ejecucion", "partida_alzada"},
    "medios para ejecución": {"medios_ejecucion", "partida_alzada"},
    "medios para ejecucion": {"medios_ejecucion", "partida_alzada"},
    # Otros (sin fragments hoy, pero documentados para futuro)
    "barandilla": {"barandilla"},
    "tabique": {"tabique"},
    "contenedor": {"contenedor"},
    "alicatado": {"alicatado", "azulejo"},
    "azulejo": {"alicatado", "azulejo"},
}


def _infer_partida_topics(description: str) -> set[str]:
    """Infiere topic tags desde la descripción de la partida.

    Match por keyword case-insensitive. Multi-palabra (ej. 'falso techo')
    se evalúa antes que single-word para precisión.
    """
    desc = (description or "").lower()
    topics: set[str] = set()
    # Multi-palabra primero (más específico).
    for kw, tags in _TOPIC_KEYWORDS.items():
        if " " in kw and kw in desc:
            topics |= tags
    # Single-palabra después.
    for kw, tags in _TOPIC_KEYWORDS.items():
        if " " not in kw and kw in desc:
            topics |= tags
    return topics


def _fragment_topic_tags(fragment: HeuristicFragment) -> set[str]:
    """Devuelve los tags 'topic' del fragment (excluye scope/chapter/principle/etc).

    Estos son los tags que describen el tipo de elemento del fragment.
    Si el fragment no tiene topic tags, no se aplica el filtro.
    """
    return {
        t.lower()
        for t in fragment.tags
        if not any(t.lower().startswith(p) for p in _META_TAG_PREFIXES)
    }


def _topics_match(partida_topics: set[str], fragment_topics: set[str]) -> bool:
    """True si:
      - fragment no tiene topics (no podemos discriminar) → permitir.
      - partida no tiene topics inferidos (descripción ambigua) → permitir.
      - intersección no vacía → permitir.
    """
    if not fragment_topics:
        return True
    if not partida_topics:
        return True
    return bool(partida_topics & fragment_topics)


def _fragment_timestamp_utc(fragment: HeuristicFragment) -> datetime:
    ts = fragment.timestamp
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def filter_and_rank_fragments(
    fragments: Iterable[HeuristicFragment],
    chapter: str,
    description: str,
    similarity_threshold: float,
    min_count: int,
    max_age_months: int,
    *,
    partida_code: str | None = None,
    now: datetime | None = None,
) -> list[HeuristicFragment]:
    """Aplica el pipeline de retrieval: status → chapter → age → topic →
    similarity → min_count → orden descendente.

    `partida_code` (opcional): si está presente, el filtro de chapter prefiere
    `chapter_code:NN` (estable) sobre `chapter:NAME` (variable según extractor
    LLM). Backward-compat: si no se pasa, se usa solo el fallback de nombre.

    `now` es opcional para permitir tests deterministas.
    """
    now_utc = now or datetime.now(timezone.utc)
    cutoff = now_utc - timedelta(days=30 * max_age_months)

    # Fase 14.C — pre-cómputo de topic tags inferidos desde la descripción
    # de la partida en curso (caché para todo el loop).
    partida_topics = _infer_partida_topics(description)

    scored: list[tuple[float, HeuristicFragment]] = []
    for frag in fragments:
        if frag.status != "golden":
            continue
        if not _has_chapter_tag(frag, chapter, partida_code=partida_code):
            continue
        if _fragment_timestamp_utc(frag) < cutoff:
            continue
        # Fase 14.C — descartar fragments cuyos topic tags no intersectan los
        # inferidos de la partida. Reduce ruido cross-partida.
        if not _topics_match(partida_topics, _fragment_topic_tags(frag)):
            continue
        frag_desc = (frag.context.originalDescription or "").strip()
        if not frag_desc:
            continue
        sim = _similarity(description, frag_desc)
        if sim < similarity_threshold:
            continue
        scored.append((sim, frag))

    # Fase 13.E — relajamos `min_count` cuando hay fragments de
    # `sourceType='baseline_migration'` matched. Estos son golden firmados
    # contra un presupuesto humano real, no necesitan corroboración estadística.
    # Para fragments del editor (`sourceType='internal_admin'`) preservamos
    # la regla `min_count` original (evidencia repetida).
    has_baseline = any(f.sourceType == "baseline_migration" for _, f in scored)
    effective_min = 1 if has_baseline else min_count
    if len(scored) < effective_min:
        return []

    scored.sort(key=lambda x: x[0], reverse=True)
    return [frag for _, frag in scored]

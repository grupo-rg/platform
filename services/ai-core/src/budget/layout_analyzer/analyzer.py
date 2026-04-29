"""LayoutAnalyzer — punto de entrada del módulo.

Dado un PDF, extrae texto por página con `pdfplumber`, lo clasifica por layout
y produce un `LayoutFingerprint` con partidas, capítulos y anomalías.

También expone `try_heuristic_extraction(text_per_page)` para integración con
el pipeline de producción: si el layout cumple los umbrales de calidad, devuelve
los `RestructuredItem` listos para el Swarm sin pasar por el LLM (Fase 9.2).
"""
from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
from typing import List, Optional

import pdfplumber

from src.budget.application.services.pdf_extractor_service import (
    RestructuredItem,
    consolidate_chapters,
    extract_chapter_prefix,
    stabilize_chapter_name,
)
from src.budget.catalog.domain.unit import Unit
from src.budget.layout_analyzer.classifier import classify
from src.budget.layout_analyzer.domain import (
    ChapterEntry,
    CrossPageCandidate,
    LayoutFingerprint,
    PartidaCandidate,
)
from src.budget.layout_analyzer.patterns import (
    PARTIDA_MU02,
    PARTIDA_SANITAS,
    QUANTITY_ROW,
    find_chapters_in_text,
    find_partidas_in_text,
    looks_like_work_description,
)

# Umbral para considerar una descripción "incompleta" tras la extracción.
_MIN_DESCRIPTION_CHARS = 50


def _to_float(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", "."))
    except (ValueError, AttributeError):
        return None


def extract_descriptions_and_quantities(
    candidates: List[PartidaCandidate],
    text_per_page: List[str],
) -> List[PartidaCandidate]:
    """Para cada `PartidaCandidate`, busca en `text_per_page` su bloque
    descriptivo (texto entre el título y la siguiente partida) y agrega
    descripción + cantidad sumada. Devuelve nuevos candidates con esos
    campos poblados (los originales quedan intactos).

    Heurística por partida:
    - Localiza el código de la partida en el texto de su página.
    - Toma el texto entre el final de la fila tabular (después del título)
      y el siguiente match de partida (o EOL).
    - De ese bloque: las líneas que coinciden con `QUANTITY_ROW` se
      agregan al `quantity` (se suman); el resto forma la `description`.

    Maneja correctamente partidas al final de página (description corta
    cuando lo que sigue es otra partida en la página siguiente — caso
    cross-page).
    """
    if not candidates:
        return []

    # Index page text by partida code → next code start position.
    # Para cada partida, buscamos donde está y donde termina.
    enriched: List[PartidaCandidate] = []

    # Pre-compilamos las posiciones de TODOS los matches por página, ordenados.
    page_match_positions: dict[int, List[int]] = {}
    for idx, page_text in enumerate(text_per_page, start=1):
        positions: List[int] = []
        for m in PARTIDA_SANITAS.finditer(page_text):
            positions.append(m.start())
        for m in PARTIDA_MU02.finditer(page_text):
            positions.append(m.start())
        page_match_positions[idx] = sorted(positions)

    # Fase 13.A — tracking del subtotal acumulado de la partida anterior para
    # detectar carry-over cross-page (convención Presto/CIFRE: el subtotal se
    # repite al inicio de la siguiente página antes de la partida siguiente,
    # y a veces queda DENTRO del bloque de la partida nueva).
    prev_total: Optional[float] = None

    for cand in candidates:
        page_idx = cand.page
        if page_idx < 1 or page_idx > len(text_per_page):
            enriched.append(cand)
            continue

        page_text = text_per_page[page_idx - 1]
        # Localizar el código + título exacto. Si no se encuentra, dejar la
        # partida como vino (sin description ni quantity).
        # Buscamos la posición del código al inicio de línea (más robusto que
        # localizar el título que puede tener tildes/caracteres especiales).
        anchor = page_text.find(cand.code)
        if anchor == -1:
            enriched.append(cand)
            continue

        # Encontrar la siguiente partida en la misma página después de `anchor`.
        positions = page_match_positions.get(page_idx, [])
        next_partida_pos = None
        for p in positions:
            if p > anchor:
                next_partida_pos = p
                break

        # Bloque entre el final de la línea de cabecera y la siguiente partida.
        # Encontramos el fin de la línea de cabecera = primer \n después de anchor.
        header_end = page_text.find("\n", anchor)
        if header_end == -1:
            header_end = anchor + len(cand.code) + len(cand.title or "") + 20  # fallback heurístico

        block_end = next_partida_pos if next_partida_pos is not None else len(page_text)
        raw_block = page_text[header_end + 1:block_end]

        # Fase 13.A — descartar carry-over de subtotal de la partida previa.
        # Si la PRIMERA línea de quantity dentro del bloque coincide con el
        # subtotal acumulado de la partida previa (±0.01), es la repetición
        # cross-page de Presto/CIFRE — la saltamos. La descripción no se ve
        # afectada.
        block_lines = raw_block.splitlines()
        skip_first_qty_line: int = -1
        if prev_total is not None and prev_total > 0:
            for i, line in enumerate(block_lines):
                qmatch = QUANTITY_ROW.match(line.strip())
                if qmatch:
                    candidate_qty = _to_float(qmatch.group("qty"))
                    if candidate_qty is not None and abs(candidate_qty - prev_total) < 0.01:
                        skip_first_qty_line = i
                    break  # Solo evaluamos la PRIMERA línea numérica del bloque.

        # Separar quantity rows del resto.
        description_lines: List[str] = []
        total_qty = 0.0
        had_qty = False
        for i, line in enumerate(block_lines):
            stripped = line.strip()
            if not stripped:
                continue
            qmatch = QUANTITY_ROW.match(stripped)
            if qmatch:
                if i == skip_first_qty_line:
                    continue  # carry-over descartado
                qty_value = _to_float(qmatch.group("qty"))
                if qty_value is not None:
                    total_qty += qty_value
                    had_qty = True
                continue
            description_lines.append(stripped)

        description = " ".join(description_lines).strip()

        # Actualizar el tracker para la siguiente iteración. Sólo guardamos un
        # subtotal positivo y si lo hubo: si la partida no acumuló cantidad,
        # mantenemos el tracker anterior (las partidas alzadas en PA suelen
        # no tener quantity_rows aisladas).
        if had_qty and total_qty > 0:
            prev_total = total_qty

        enriched.append(PartidaCandidate(
            code=cand.code,
            title=cand.title,
            unit=cand.unit,
            quantity=total_qty if had_qty else cand.quantity,
            description=description if description else None,
            page=cand.page,
            method=cand.method,
        ))

    return enriched


def analyze_pdf(pdf_path: Path) -> LayoutFingerprint:
    """Analiza un PDF y devuelve el fingerprint estructural.

    No requiere LLM. Solo `pdfplumber` + regex puras + heurísticas.
    """
    text_per_page: List[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            text_per_page.append(t)

    n_pages = len(text_per_page)
    full_text = "\n".join(text_per_page)
    text_extractable = sum(len(t) for t in text_per_page) > 200

    # Clasificación de layout.
    layout = classify(text_per_page)

    # Partidas detectadas, con metadata de página.
    partidas: List[PartidaCandidate] = []
    for page_idx, page_text in enumerate(text_per_page, start=1):
        for match, method in find_partidas_in_text(page_text):
            unit = match.group("unit") if "unit" in match.groupdict() else None
            title = (match.group("title") or "").strip()
            partidas.append(PartidaCandidate(
                code=match.group("code"),
                title=title,
                unit=unit,
                quantity=None,  # se podría inferir mirando el texto siguiente al match
                page=page_idx,
                method=method,
            ))

    # Capítulos detectados, agrupados con la lógica canonical existente.
    raw_chapters: "OrderedDict[str, ChapterEntry]" = OrderedDict()
    for page_idx, page_text in enumerate(text_per_page, start=1):
        for match in find_chapters_in_text(page_text):
            prefix = match.group("code")
            name = match.group("name").strip()
            full_chapter = f"{prefix} {name}"
            if prefix not in raw_chapters:
                raw_chapters[prefix] = ChapterEntry(
                    prefix=prefix,
                    name=name,
                    partidas_count=0,
                    page_first_seen=page_idx,
                )
    # Conteo de partidas por prefijo. La regla simple: el prefijo de capítulo
    # es todo lo que precede al primer punto del código (`C04.02 → C04`,
    # `1.1 → 1`). NO usamos `extract_chapter_prefix` porque normaliza puntos
    # de manera que pierde la correspondencia con el código del capítulo.
    for p in partidas:
        prefix = p.code.split(".")[0].upper()
        if prefix and prefix in raw_chapters:
            raw_chapters[prefix].partidas_count += 1

    chapters = list(raw_chapters.values())

    # Anomalías ----------------------------------------------------------------
    anomalies: List[str] = []

    # Detectar capítulos duplicados (caso del bug que ya arreglamos en 8.C).
    chapter_names_by_prefix: dict[str, set[str]] = {}
    for page_idx, page_text in enumerate(text_per_page, start=1):
        for match in find_chapters_in_text(page_text):
            prefix = match.group("code")
            chapter_names_by_prefix.setdefault(prefix, set()).add(match.group("name").strip())
    for prefix, names in chapter_names_by_prefix.items():
        if len(names) > 1:
            anomalies.append(
                f"Capítulo {prefix} tiene {len(names)} nombres distintos en el PDF "
                f"({sorted(names)}). consolidate_chapters lo unifica con el primero visto."
            )

    # Cross-page candidates: partidas con descripción muy corta donde la
    # siguiente página empieza con un párrafo descriptivo huérfano.
    cross_page: List[CrossPageCandidate] = []
    for p in partidas:
        page_idx = p.page  # 1-indexed
        if page_idx > n_pages:
            continue
        # Heurística simple: ¿el texto después del título cabe en la misma página
        # con una descripción ≥ 50 chars antes del próximo código de partida?
        page_text = text_per_page[page_idx - 1]
        # Busca el match exacto en el texto de la página.
        idx = page_text.find(p.title)
        if idx == -1:
            continue
        after = page_text[idx + len(p.title):]
        # Cuánto texto descriptivo queda antes del fin de la página.
        description_text = after[:1500]
        # Quitar quantity rows aisladas y líneas en blanco.
        cleaned = "\n".join(
            line for line in description_text.splitlines()
            if line.strip() and not _is_quantity_only(line)
        ).strip()
        # Si lo que queda es muy corto Y la siguiente página empieza con verb-of-work → cross-page.
        if len(cleaned) < _MIN_DESCRIPTION_CHARS and page_idx < n_pages:
            next_text = text_per_page[page_idx]  # page_idx is 1-indexed → next is index page_idx
            first_lines = [l for l in next_text.splitlines() if l.strip()][:3]
            if first_lines and looks_like_work_description(first_lines[0]):
                cross_page.append(CrossPageCandidate(
                    partida_code=p.code,
                    header_page=page_idx,
                    description_page_estimated=page_idx + 1,
                    reason=(
                        f"descripción inline tiene {len(cleaned)} chars (<{_MIN_DESCRIPTION_CHARS}); "
                        f"página siguiente empieza con verbo de obra: "
                        f"{first_lines[0][:60]!r}"
                    ),
                ))

    # Partidas con descripción corta sin candidato cross-page → flagged como anomalía.
    short_descriptions = sum(
        1 for p in partidas
        if p.description and len(p.description.strip()) < _MIN_DESCRIPTION_CHARS
    )
    if short_descriptions > 0:
        anomalies.append(f"{short_descriptions} partidas con descripción < {_MIN_DESCRIPTION_CHARS} chars (potencial pérdida de contexto)")

    # Sample para inspección humana (primeras 10).
    sample = partidas[:10]

    # Estimación de qué requeriría LLM: las que están en cross-page candidates +
    # las que tienen descripción incompleta. El resto (extraídas vía heurística
    # con descripción suficiente) NO necesitarían LLM en una arquitectura híbrida.
    needs_llm = len(cross_page) + short_descriptions
    extracted_via_heuristics = max(0, len(partidas) - needs_llm)

    return LayoutFingerprint(
        file=str(pdf_path.name),
        pages=n_pages,
        text_extractable=text_extractable,
        layout=layout,
        detected_partidas_count=len(partidas),
        extracted_via_heuristics_count=extracted_via_heuristics,
        needs_llm_count=needs_llm,
        partidas_sample=sample,
        chapters=chapters,
        cross_page_candidates=cross_page,
        anomalies=anomalies,
    )


def try_heuristic_extraction(
    text_per_page: List[str],
    *,
    min_layout_confidence: float = 0.85,
    min_partidas_detected: int = 5,
    max_short_description_ratio: float = 0.30,
) -> Optional[List[RestructuredItem]]:
    """Devuelve `List[RestructuredItem]` si la heurística cubre el documento
    suficientemente. Si no, devuelve `None` y el pipeline cae al flujo LLM.

    Umbrales (calibrados sobre los goldens reales — SANITAS tiene 19% de
    descripciones cortas por cross-page, MU02 tiene 0%):
    - `min_layout_confidence` (default 0.85): clasificación clara.
    - `min_partidas_detected` (default 5): suficientes para confiar en que el
      regex sí pegó al formato.
    - `max_short_description_ratio` (default 0.30): si más del 30% de las
      partidas tienen descripción muy corta (< 50 chars), la heurística no
      cubre el documento — abortamos al LLM. Los goldens caen bajo este
      umbral cómodamente (SANITAS ~19%, MU02 0%).

    Esta función es PURA — no toca PDFs ni LLMs. Recibe texto por página y
    decide si hay tracción heurística suficiente. Es el punto de integración
    entre el `LayoutAnalyzer` (offline) y el extractor del pipeline.

    Las partidas con descripción corta entran igual al output (con su título)
    — el Swarm Pro las trata aguas abajo. El fast path no degrada calidad
    respecto al flujo actual: lo que hoy se descarta por truncamiento, ahora
    al menos tiene su `code + unit + title` correctos.
    """
    # Reusamos el clasificador puro.
    from src.budget.layout_analyzer.classifier import classify
    from src.budget.layout_analyzer.patterns import find_partidas_in_text

    layout = classify(text_per_page)
    if layout.type != "INLINE_WITH_TITLES":
        return None
    if layout.confidence < min_layout_confidence:
        return None

    # Construir candidates con page-tracking (mismo loop que `analyze_pdf`).
    candidates: List[PartidaCandidate] = []
    for page_idx, page_text in enumerate(text_per_page, start=1):
        for match, method in find_partidas_in_text(page_text):
            unit_str = match.group("unit") if "unit" in match.groupdict() else None
            title = (match.group("title") or "").strip()
            candidates.append(PartidaCandidate(
                code=match.group("code"),
                title=title,
                unit=unit_str,
                page=page_idx,
                method=method,
            ))

    if len(candidates) < min_partidas_detected:
        return None

    # Enriquecer con descripción + cantidad.
    enriched = extract_descriptions_and_quantities(candidates, text_per_page)

    # Guard: si demasiadas partidas tienen descripción corta, mejor LLM.
    short = sum(
        1 for c in enriched
        if not c.description or len(c.description) < 50
    )
    if short / len(enriched) > max_short_description_ratio:
        return None

    # Construir RestructuredItem por cada candidate. Capítulo se determina
    # por proximidad al último heading visto en la misma o anterior página.
    # Para mantenerlo simple: derivamos chapter del prefix del código.
    chapter_names = _build_chapter_names(text_per_page)

    items: List[RestructuredItem] = []
    for c in enriched:
        prefix = c.code.split(".")[0].upper()
        chapter = chapter_names.get(prefix, "Sin Capítulo")
        unit_norm = Unit.normalize(c.unit) if c.unit else None
        unit_dim = Unit.dimension_of(unit_norm) if unit_norm else None
        items.append(RestructuredItem(
            code=c.code,
            description=c.description or c.title,
            quantity=c.quantity if c.quantity is not None else 1.0,
            unit=c.unit or "ud",
            chapter=chapter,
            unit_normalized=unit_norm,
            unit_dimension=unit_dim,
        ))

    # Aplica el lock por capítulo canonical (mismo fix que 8.C).
    consolidate_chapters(items)
    return items


def _build_chapter_names(text_per_page: List[str]) -> dict[str, str]:
    """Mapeo `prefijo → nombre canonical de capítulo` recolectado del texto."""
    from src.budget.layout_analyzer.patterns import find_chapters_in_text

    canonical: dict[str, str] = {}
    for page_text in text_per_page:
        for match in find_chapters_in_text(page_text):
            prefix = match.group("code")
            name = match.group("name").strip()
            full = f"{prefix} {name}"
            # Primer nombre completo gana (FIFO), igual que consolidate_chapters.
            if prefix not in canonical:
                canonical[prefix] = full
    return canonical


def _is_quantity_only(line: str) -> bool:
    """¿Esta línea es solo una cantidad aislada (ej. '1,0' o '108,46')?"""
    stripped = line.strip()
    if not stripped:
        return True
    # Acepta "1,0" / "108,46" / "1,00 Ud".
    parts = stripped.split()
    if len(parts) <= 2:
        try:
            float(parts[0].replace(",", "."))
            return True
        except ValueError:
            return False
    return False

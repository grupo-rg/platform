"""TabularParser — orquestador principal del parser TABULAR coord-based.

Flujo por página:
1. extract_words + width/height vía pdfplumber.
2. detect_header_in_page — busca la cabecera; si se encuentra, actualiza
   el ColumnMapper memorizado.
3. Si hay mapping vigente, agrupa palabras en TabularRows.
4. Para cada row: intenta detectar declaración de capítulo/subcap/apartado.
5. Si no es declaración: intenta detectar cabecera de partida; si lo es,
   abre nueva partida y la registra con la jerarquía actual.
6. Si la row siguiente es summary `<CANT> <PRECIO> <IMPORTE>`, fija qty.

El parser NO emite eventos SSE por sí mismo — la emisión ocurre en el
caller (`pdf_extractor_service.py`) para mantener este módulo libre de
acoplamientos al pipeline.

Si después de procesar todo, qty_rate < 0.80 o chapter_rate < 0.80:
`result.is_viable() == False` y el caller debe caer a LLM Vision.
"""
from __future__ import annotations

import logging
import time
from typing import Callable, Dict, List, Optional

from src.budget.pdf_tabular_parser.application.annexed_detector import (
    detect_annexed_transition_page,
    extract_totals_from_annexed_pages,
)
from src.budget.pdf_tabular_parser.application.column_mapper import ColumnMapper
from src.budget.pdf_tabular_parser.application.header_detector import detect_header_in_page
from src.budget.pdf_tabular_parser.application.hierarchy_tracker import (
    apply_detection_to_hierarchy,
    detect_hierarchy_in_line,
)
from src.budget.pdf_tabular_parser.application.partida_extractor import (
    detect_partida_header_from_text,
    detect_summary_row,
    extract_quantity_from_row,
)
from src.budget.pdf_tabular_parser.application.partida_header_annexed import (
    detect_partida_header_annexed,
)
from src.budget.pdf_tabular_parser.application.row_grouper import group_words_into_rows
from src.budget.pdf_tabular_parser.domain.column import ColumnConcept
from src.budget.pdf_tabular_parser.domain.hierarchy import ChapterHierarchy
from src.budget.pdf_tabular_parser.domain.result import (
    PageMetrics,
    TabularExtractionResult,
    TabularPartida,
)
from src.budget.pdf_tabular_parser.domain.row import TabularRow
from src.budget.pdf_tabular_parser.infrastructure.pdfplumber_adapter import iter_pages

logger = logging.getLogger(__name__)

# Si extraemos más de este threshold % páginas sin cabecera ANTES de la
# primera detección → no es un PDF PRESTO, fallback inmediato.
MAX_PAGES_WITHOUT_HEADER_BEFORE_ABORT = 3


class TabularParser:
    """Orquestador del parser TABULAR.

    Idempotente — instanciar una vez y reusar es seguro. No mantiene estado
    entre llamadas a `parse()`.

    El parser soporta DOS modos:

    1. **INLINE / TABULAR** (Fase A): cabecera CIFRE/PRESTO con columnas
       (CÓDIGO, RESUMEN, ..., CANTIDAD), descripciones y mediciones inline
       en cada partida. Activado cuando se detecta la cabecera en una página.

    2. **PRESTO ANNEXED** (Fase D): cabeceras de partida en primer tercio del
       PDF + totales `Total <code> <qty>` en último tercio. Activado cuando
       no hay cabecera CIFRE pero `detect_annexed_transition_page` retorna un
       page number válido (>= 50% del PDF).

    Si ninguno aplica, retorna `result.reason="no_layout_recognized"`.
    """

    def parse(
        self,
        pdf_bytes: bytes,
        event_callback: Optional[Callable[[str, dict], None]] = None,
    ) -> TabularExtractionResult:
        """Parsea un PDF completo. Retorna el resultado con métricas.

        Args:
            pdf_bytes: bytes del PDF.
            event_callback: opcional, función ``(event_name, payload)`` que
                emite eventos de telemetría (e.g. SSE). Si es None, no se
                emiten eventos.
        """
        start = time.time()

        result = TabularExtractionResult()
        hierarchy = ChapterHierarchy()
        mapper = ColumnMapper()

        partidas: List[TabularPartida] = []
        last_partida: Optional[TabularPartida] = None
        pending_qty_for_last: bool = False

        pages_seen = 0
        pages_without_header_streak = 0
        pages_with_header = 0

        # Pre-extract todo el texto + words por página para poder hacer
        # detección ANNEXED ANTES de descartar via "no header detected".
        text_per_page: List[str] = []
        pages_buffer: List = []
        try:
            for page_data in iter_pages(pdf_bytes):
                pages_buffer.append(page_data)
                text_per_page.append(page_data.raw_text or "")
        except Exception as e:  # noqa: BLE001
            logger.exception("TabularParser: error iterando PDF: %s", e)
            result.duration_seconds = time.time() - start
            result.pages_total = len(pages_buffer)
            result.reason = f"exception:{type(e).__name__}"
            return result

        if not pages_buffer:
            result.duration_seconds = time.time() - start
            result.reason = "empty_pdf"
            return result

        # --- DETECCIÓN DE MODO ANNEXED ---
        transition_page = detect_annexed_transition_page(text_per_page)
        if transition_page is not None:
            logger.info(
                "TabularParser: modo ANNEXED detectado, transition_page=%d/%d",
                transition_page,
                len(text_per_page),
            )
            _emit(event_callback, "annexed_transition_detected", {
                "transitionPage": transition_page,
                "totalPages": len(text_per_page),
            })
            self._parse_annexed(
                text_per_page=text_per_page,
                transition_page=transition_page,
                result=result,
                event_callback=event_callback,
            )
            result.duration_seconds = time.time() - start
            result.pages_total = len(text_per_page)
            result.is_viable()
            return result

        # --- MODO INLINE/TABULAR (Fase A — sin cambios) ---
        try:
            for page_data in pages_buffer:
                pages_seen += 1
                page_number = page_data.page_number
                words = page_data.words

                # 1. Detectar cabecera en esta página.
                header_detection = detect_header_in_page(words, page_number)
                if header_detection.found:
                    mapper.update_from_detection(header_detection)
                    pages_with_header += 1
                    pages_without_header_streak = 0
                else:
                    pages_without_header_streak += 1

                # Si nunca hemos visto cabecera y ya pasamos varias páginas → abort.
                if (
                    not mapper.has_mapping()
                    and pages_without_header_streak >= MAX_PAGES_WITHOUT_HEADER_BEFORE_ABORT
                ):
                    logger.info(
                        "TabularParser: no header in first %d pages, aborting",
                        pages_without_header_streak,
                    )
                    result.partidas = partidas
                    result.duration_seconds = time.time() - start
                    result.pages_total = pages_seen
                    result.pages_with_header = pages_with_header
                    result.reason = "no_header_detected"
                    return result

                # Si no hay mapping aún, no podemos procesar la página.
                if not mapper.has_mapping():
                    result.page_metrics.append(
                        PageMetrics(
                            page_number=page_number,
                            has_header=False,
                            rows_found=0,
                            partidas_extracted=0,
                            qty_found=0,
                        )
                    )
                    continue

                # 2. Agrupar palabras en filas tabulares.
                columns = mapper.get_columns()
                # header_y: si esta página tiene cabecera, usamos su y_center;
                # si no, asumimos que el body empieza después del top de la
                # primera línea (heurístico).
                header_y = (
                    header_detection.y_center
                    if header_detection.found
                    else _estimate_body_start_y(words)
                )

                rows = group_words_into_rows(
                    words=words,
                    columns=columns,
                    header_y=header_y if header_y is not None else 0.0,
                    page_number=page_number,
                )

                # 3. Procesar filas.
                partidas_in_page = 0
                for row in rows:
                    consumed = self._process_row(
                        row=row,
                        hierarchy=hierarchy,
                        partidas=partidas,
                        last_partida_ref=last_partida,
                        pending_qty_ref=pending_qty_for_last,
                    )
                    # Devolver estado mutado (pattern manual; no usamos Optional in/out).
                    last_partida = consumed["last_partida"]
                    pending_qty_for_last = consumed["pending_qty"]
                    if consumed["created_partida"]:
                        partidas_in_page += 1

                qty_found_in_page = sum(
                    1 for p in partidas[-partidas_in_page:] if p.quantity is not None
                ) if partidas_in_page else 0

                result.page_metrics.append(
                    PageMetrics(
                        page_number=page_number,
                        has_header=header_detection.found,
                        rows_found=len(rows),
                        partidas_extracted=partidas_in_page,
                        qty_found=qty_found_in_page,
                    )
                )

        except Exception as e:  # noqa: BLE001 - dejamos al caller decidir
            logger.exception("TabularParser fallo procesando PDF: %s", e)
            result.partidas = partidas
            result.duration_seconds = time.time() - start
            result.pages_total = pages_seen
            result.pages_with_header = pages_with_header
            result.reason = f"exception:{type(e).__name__}"
            return result

        result.partidas = partidas
        result.duration_seconds = time.time() - start
        result.pages_total = pages_seen
        result.pages_with_header = pages_with_header
        # Llamamos a is_viable() para que pueble `result.reason` si aplica.
        result.is_viable()
        return result

    def _process_row(
        self,
        row: TabularRow,
        hierarchy: ChapterHierarchy,
        partidas: List[TabularPartida],
        last_partida_ref: Optional[TabularPartida],
        pending_qty_ref: bool,
    ) -> dict:
        """Procesa una fila. Retorna diccionario con estado actualizado."""
        last_partida = last_partida_ref
        pending_qty = pending_qty_ref
        created_partida = False

        if row.is_empty():
            return {
                "last_partida": last_partida,
                "pending_qty": pending_qty,
                "created_partida": False,
            }

        text = row.get_full_text()

        # Paso A: ¿Es una declaración jerárquica?
        h_detection = detect_hierarchy_in_line(text)
        if h_detection.level is not None:
            apply_detection_to_hierarchy(hierarchy, h_detection)
            return {
                "last_partida": last_partida,
                "pending_qty": pending_qty,
                "created_partida": False,
            }

        # Paso B: ¿Es una fila summary `CANT PRECIO IMPORTE`?
        if pending_qty and last_partida is not None:
            summary = detect_summary_row(text)
            if summary.is_summary and summary.quantity is not None:
                last_partida.quantity = summary.quantity
                pending_qty = False
                return {
                    "last_partida": last_partida,
                    "pending_qty": pending_qty,
                    "created_partida": False,
                }

        # Paso C: ¿Es una cabecera de partida?
        header = detect_partida_header_from_text(text)
        if header.is_partida:
            # Si la partida ANTERIOR no tenía qty extraída, ya no la conseguiremos.
            # Marca explícita: pending_qty se cierra.
            new_partida = TabularPartida(
                code=header.code,
                description=header.title,
                unit=header.unit,
                quantity=None,
                chapter=hierarchy.get_chapter_label(),
                sub_chapter=hierarchy.get_sub_chapter_label(),
                apartado=(
                    f"{hierarchy.apartado_code} {hierarchy.apartado_name}".strip()
                    if hierarchy.apartado_code
                    else None
                ),
                page_number=row.page_number,
                hierarchy_snapshot=hierarchy.snapshot(),
            )

            # Intentar leer qty directamente de la celda CANTIDAD si la fila la tiene.
            qty_direct = extract_quantity_from_row(row)
            if qty_direct is not None and qty_direct > 0.0:
                new_partida.quantity = qty_direct
                pending_qty = False
            else:
                pending_qty = True  # buscar summary row más adelante

            partidas.append(new_partida)
            last_partida = new_partida
            created_partida = True
            return {
                "last_partida": last_partida,
                "pending_qty": pending_qty,
                "created_partida": True,
            }

        # Paso D: línea de medición zonal — añadimos cantidad si el row tiene
        # celda CANTIDAD positiva y la partida actual aún no tiene qty.
        if last_partida is not None and pending_qty:
            qty_in_measure = _extract_quantity_from_measurement_row(row)
            if qty_in_measure is not None and qty_in_measure > 0.0:
                # Acumulamos (varias filas de medición suman).
                current = last_partida.quantity or 0.0
                last_partida.quantity = current + qty_in_measure

        return {
            "last_partida": last_partida,
            "pending_qty": pending_qty,
            "created_partida": False,
        }


    # --- ANNEXED MODE METHODS (Fase D) ---

    def _parse_annexed(
        self,
        text_per_page: List[str],
        transition_page: int,
        result: TabularExtractionResult,
        event_callback: Optional[Callable[[str, dict], None]] = None,
    ) -> None:
        """Parsea un PDF en modo PRESTO ANNEXED.

        Estrategia:
        1. Recorrer las páginas 1..transition_page-1 línea-por-línea.
        2. Detectar declaraciones de capítulo (`XX Capítulo NOMBRE` y
           variantes) con hierarchy_tracker.
        3. Detectar cabeceras de partida con `detect_partida_header_annexed`
           (regex relajado).
        4. Construir totals dict desde transition_page hasta el final.
        5. Para cada cabecera detectada: lookup en totals dict y asignar
           quantity (o None si miss).
        6. Emit eventos `annexed_transition_detected` y `annexed_mapping_complete`.

        Args:
            text_per_page: texto por página (1-indexed implícito).
            transition_page: 1-indexed page donde inician los totales.
            result: TabularExtractionResult a poblar.
            event_callback: callback opcional para eventos SSE.
        """
        partidas: List[TabularPartida] = []
        hierarchy = ChapterHierarchy()
        seen_codes: set[str] = set()  # dedupe por code dentro del PDF

        # 1. Extraer totals dict primero (para luego matchear).
        totals = extract_totals_from_annexed_pages(
            text_per_page, start_page=transition_page,
        )
        result.annexed = True
        result.annexed_transition_page = transition_page
        result.annexed_totals_found = len(totals)

        # 2. Recorrer la fase de descripciones (páginas 1..transition_page-1).
        descriptions_end = max(1, transition_page - 1)
        for page_idx in range(0, descriptions_end):
            page_text = text_per_page[page_idx]
            if not page_text:
                continue
            page_number_1idx = page_idx + 1

            partidas_in_page = 0
            for line in page_text.splitlines():
                line_clean = line.strip()
                if not line_clean:
                    continue

                # Paso A: declaración jerárquica (capítulo/subcap/apartado).
                h_detection = detect_hierarchy_in_line(line_clean)
                if h_detection.level is not None:
                    apply_detection_to_hierarchy(hierarchy, h_detection)
                    continue

                # Paso B: cabecera de partida (regex relajado ANNEXED).
                header = detect_partida_header_annexed(line_clean)
                if header.is_partida:
                    if header.code in seen_codes:
                        continue  # dedupe
                    seen_codes.add(header.code)

                    new_partida = TabularPartida(
                        code=header.code,
                        description=header.title,
                        unit=header.unit,
                        quantity=None,
                        chapter=hierarchy.get_chapter_label(),
                        sub_chapter=hierarchy.get_sub_chapter_label(),
                        apartado=(
                            f"{hierarchy.apartado_code} {hierarchy.apartado_name}".strip()
                            if hierarchy.apartado_code
                            else None
                        ),
                        page_number=page_number_1idx,
                        hierarchy_snapshot=hierarchy.snapshot(),
                    )
                    partidas.append(new_partida)
                    partidas_in_page += 1

            result.page_metrics.append(
                PageMetrics(
                    page_number=page_number_1idx,
                    has_header=False,  # ANNEXED no usa cabecera tabular
                    rows_found=len(page_text.splitlines()),
                    partidas_extracted=partidas_in_page,
                    qty_found=0,  # qty se asigna en el mapping post-loop
                )
            )

        # 3. Mapeo de cada cabecera con su total.
        matched = 0
        orphans = 0
        for p in partidas:
            qty = totals.get(p.code)
            if qty is not None:
                p.quantity = qty
                matched += 1
            else:
                orphans += 1
                logger.debug(
                    "ANNEXED: cabecera %s sin total (página %s) — huérfana",
                    p.code, p.page_number,
                )

        result.annexed_matched = matched
        result.annexed_orphans = orphans
        result.partidas = partidas

        match_rate = (matched / len(partidas)) if partidas else 0.0
        _emit(event_callback, "annexed_mapping_complete", {
            "headersTotal": len(partidas),
            "matched": matched,
            "orphans": orphans,
            "matchRate": round(match_rate, 4),
            "totalsFound": len(totals),
        })

        logger.info(
            "ANNEXED: %d cabeceras, %d totales, %d matched, %d huérfanas (match_rate=%.2f%%)",
            len(partidas), len(totals), matched, orphans, 100.0 * match_rate,
        )


def _emit(
    callback: Optional[Callable[[str, dict], None]],
    event_name: str,
    payload: dict,
) -> None:
    """Helper safe-emit de eventos (no falla si callback es None o lanza).

    No afecta al flujo principal si el callback falla.
    """
    if callback is None:
        return
    try:
        callback(event_name, payload)
    except Exception:  # noqa: BLE001
        logger.exception("TabularParser: callback de evento %s falló", event_name)


def _estimate_body_start_y(words) -> Optional[float]:
    """Heurística: si la página no tiene cabecera explícita, asumimos que
    el contenido del body empieza después del top quintil de la página."""
    if not words:
        return None
    ys = sorted(w.y_center for w in words)
    if not ys:
        return None
    # Top 5% como ruido (numeración, headers de impresora) — devolvemos su limite.
    idx = max(0, int(len(ys) * 0.05))
    return ys[idx] - 1.0


def _extract_quantity_from_measurement_row(row: TabularRow) -> Optional[float]:
    """Extrae cantidad de fila de medición zonal `desc UDS LONG ANCH ALT CANT`.

    Prefiere la columna CANTIDAD si existe; si no, busca en PARCIALES.
    """
    from src.budget.pdf_tabular_parser.application.spanish_number import parse_spanish_number

    if row.has_cell(ColumnConcept.CANTIDAD):
        qty = parse_spanish_number(row.get_cell(ColumnConcept.CANTIDAD))
        if qty is not None:
            return qty

    if row.has_cell(ColumnConcept.PARCIALES):
        qty = parse_spanish_number(row.get_cell(ColumnConcept.PARCIALES))
        if qty is not None:
            return qty

    return None

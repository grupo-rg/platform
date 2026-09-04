"""Parser principal BC3 → Bc3Tree."""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Optional

from src.budget.bc3_parser.entities import (
    Bc3Concept,
    Bc3ConceptKind,
    Bc3Decomposition,
    Bc3Measurement,
    Bc3MeasurementLine,
    Bc3Tree,
)
from src.budget.bc3_parser.tokenizer import (
    decode_bc3_bytes,
    iter_records,
    split_record,
)

logger = logging.getLogger(__name__)


# --- Lever 1: detección de CABECERAS (reclasificar-no-borrar) ------------------
# En el path de promoción-de-hoja (BC3 sin `~M`), algunas hojas que colgamos como
# partida son en realidad TÍTULOS de sección o cláusulas contractuales, no unidades
# de obra (p.ej. `CIM` "CIMENTACION. CIMENTACION", `C000` "Consideraciones Previas
# [cláusula legal de 2500 chars]"). Se priciaban por error e inflaban el total. Las
# reclasificamos a CHAPTER (sección, no se pricia) — NUNCA se borran. Ultra-
# conservador: solo señales inequívocas, para no tumbar una partida real.
# Solo léxico INEQUÍVOCAMENTE contractual (no 'propiedad'/'condicion'/'prescripci'
# /'oferta', que aparecen en specs normales de partida — 'propiedades del material',
# 'prescripciones técnicas'…). Combinado con un umbral de longitud alto, evita
# tumbar una partida detallada real.
_CLAUSE_MARKERS = re.compile(
    r"contrat|clausul|licitac|pliego|adjudicac|proposicion|aval"
)


def _fold_text(s: Optional[str]) -> str:
    """minúsculas + sin tildes + trim, para comparar descripciones."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s or "")
        if unicodedata.category(c) != "Mn"
    ).lower().strip()


def _looks_like_section_header(concept: "Bc3Concept", parent_chapter_desc: str) -> bool:
    """True si una HOJA (sin `~M` ni precio, bajo un capítulo) es en realidad una
    CABECERA de sección, no una partida de obra. Solo dispara con señales
    inequívocas (una partida real no cae en ninguna):

      1. AUTO-ECO de PALABRA ÚNICA: `~C` corto == `~T` largo Y es UNA sola palabra
         (p.ej. 'CIMENTACION'/'CIMENTACION'). Doble guarda: en plantillas el `~C`
         y el `~T` suelen ser idénticos incluso en partidas reales (p.ej.
         'Instalación solado gres porcelánico'), así que exigir además que sea una
         SOLA palabra distingue la etiqueta de sección (una palabra) de la partida
         real (frase). Un prefijo tampoco vale (el corto suele prefijar al largo).
      2. ECO DEL CAPÍTULO: la descripción == nombre del capítulo padre (exacto).
      3. CLÁUSULA/BOILERPLATE: texto MUY largo (>2000) con léxico contractual
         inequívoco. Un preámbulo legal (C000, ~5000 chars) lo cumple; una partida
         detallada real (~800-1500 chars, aunque mencione 'propiedades') no.
    """
    short = _fold_text(concept.description)
    long = _fold_text(concept.long_description)
    if not short or len(short) < 4:
        return False
    # 1. auto-eco de PALABRA ÚNICA (etiqueta de sección tipo 'CIMENTACION')
    if long and long == short and " " not in short:
        return True
    # 2. eco EXACTO del capítulo padre
    pch = _fold_text(parent_chapter_desc)
    if pch and short == pch:
        return True
    # 3. cláusula / boilerplate contractual (umbral alto + léxico inequívoco)
    full = f"{short} {long}".strip()
    if len(full) > 2000 and _CLAUSE_MARKERS.search(full):
        return True
    return False


def _concept_has_price(concept: "Bc3Concept") -> bool:
    return bool(concept.price and concept.price > 0)


def _parse_spanish_float(s: str) -> Optional[float]:
    """Parsea número español. Acepta `1.234,56` o `1234.56` o `1234,56`."""
    if not s:
        return None
    cleaned = s.strip()
    if not cleaned:
        return None
    # Eliminar separadores de miles (puntos antes de la coma) y promover coma a punto.
    if "," in cleaned:
        # Asumir formato es-ES: punto como thousands, coma como decimal.
        cleaned = cleaned.replace(".", "").replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


class Bc3Parser:
    """Parser FIEBDC-3 que construye un `Bc3Tree`.

    Estrategia:
      1. Decodificar bytes → str con encoding detection.
      2. Iterar records, dispatch por tipo (~V, ~C, ~D, ~M, ~T, ~K).
      3. Construir entidades en el tree.
      4. Inferir `kind` de cada concepto en función de presencia/ausencia
         de mediciones y decomposiciones (heurística).
    """

    def parse(self, raw_bytes: bytes) -> Bc3Tree:
        text, encoding = decode_bc3_bytes(raw_bytes)
        tree = Bc3Tree(encoding=encoding)

        for line in iter_records(text):
            record_type = line[:2]
            try:
                if record_type == "~V":
                    self._parse_v(line, tree)
                elif record_type == "~K":
                    self._parse_k(line, tree)
                elif record_type == "~C":
                    self._parse_c(line, tree)
                elif record_type == "~T":
                    self._parse_t(line, tree)
                elif record_type == "~D":
                    self._parse_d(line, tree)
                elif record_type == "~M":
                    self._parse_m(line, tree)
                # Otros records (~O, ~A, ~E, ~L, ~X) se ignoran silenciosamente.
            except Exception as e:
                # Un record corrupto no debe abortar el parse entero.
                logger.warning(
                    "BC3 record %s ignorado por error de parseo: %s | line=%r",
                    record_type, e, line[:100],
                )

        # Post-process: inferir el `kind` de cada concepto.
        self._infer_kinds(tree)
        # Identificar roots (capítulos top-level que no son hijos de ninguna decomposition).
        self._identify_roots(tree)
        return tree

    # --- record parsers ----------------------------------------------------

    def _parse_v(self, line: str, tree: Bc3Tree) -> None:
        """`~V|owner|FIEBDC-3/2002|exporter|...|ANSI|...|`."""
        fields = split_record(line)
        if len(fields) >= 3:
            tree.version = fields[2].strip()

    def _parse_k(self, line: str, tree: Bc3Tree) -> None:
        """`~K|<numeric_format>|...|EUR|...|`.

        El campo de moneda suele venir en una posición variable. Buscamos
        cualquier código de 3 letras conocido.
        """
        fields = split_record(line)
        for f in fields:
            f_stripped = f.strip()
            if f_stripped in ("EUR", "USD", "GBP"):
                tree.currency = f_stripped
                return

    def _parse_c(self, line: str, tree: Bc3Tree) -> None:
        """`~C|code|unit|description|price|date|type|`."""
        fields = split_record(line)
        if len(fields) < 4:
            return
        code = fields[1].strip()
        unit = fields[2].strip()
        description = fields[3].strip()
        price = _parse_spanish_float(fields[4]) if len(fields) >= 5 else None

        # Si ya existe, mergeamos campos (algunos exporters duplican records).
        existing = tree.concepts.get(code)
        if existing:
            if not existing.description and description:
                existing.description = description
            if not existing.unit and unit:
                existing.unit = unit
            if existing.price is None and price is not None:
                existing.price = price
        else:
            tree.concepts[code] = Bc3Concept(
                code=code,
                unit=unit,
                description=description,
                price=price,
            )

    def _parse_t(self, line: str, tree: Bc3Tree) -> None:
        """`~T|code|long_description_text|`."""
        fields = split_record(line)
        if len(fields) < 3:
            return
        code = fields[1].strip()
        long_desc = fields[2].strip()
        concept = tree.concepts.get(code)
        if concept is None:
            # Texto sin concepto previo — creamos uno vacío para no perder el texto.
            concept = Bc3Concept(code=code)
            tree.concepts[code] = concept
        # Acumular si ya había texto (concatenación segura).
        if concept.long_description:
            concept.long_description += " " + long_desc
        else:
            concept.long_description = long_desc

    def _parse_d(self, line: str, tree: Bc3Tree) -> None:
        """`~D|parent_code|child_code\\factor\\qty\\...|`.

        Los hijos están en una sola cadena pipe-2, separados por `\\`.
        Patrón típico: `child1\\factor1\\qty1\\child2\\factor2\\qty2\\...`
        """
        fields = split_record(line)
        if len(fields) < 3:
            return
        parent_code = fields[1].strip()
        children_raw = fields[2]
        children = self._parse_decomposition_children(children_raw)
        if not children:
            return
        existing = tree.decompositions.get(parent_code)
        if existing:
            existing.children.extend(children)
        else:
            tree.decompositions[parent_code] = Bc3Decomposition(
                parent_code=parent_code,
                children=children,
            )

    def _parse_decomposition_children(self, raw: str) -> list[tuple[str, float]]:
        """Parsea `child1\\factor1\\qty1\\child2\\factor2\\qty2\\...`.

        Cada hijo ocupa 3 tokens (code, factor, qty). El factor es el más
        relevante (cuánto de child por unidad de parent).
        """
        parts = raw.split("\\")
        children: list[tuple[str, float]] = []
        i = 0
        while i + 2 < len(parts):
            child_code = parts[i].strip()
            factor_str = parts[i + 1].strip()
            # parts[i+2] es la qty pero la ignoramos (no es relevante para
            # nuestro pipeline; el factor ya describe la relación).
            if child_code:
                factor = _parse_spanish_float(factor_str) or 1.0
                children.append((child_code, factor))
            i += 3
        return children

    def _parse_m(self, line: str, tree: Bc3Tree) -> None:
        """`~M|parent_code\\child_code|position|total_qty|parciales_text|...|`.

        El campo `parent_code\\child_code` identifica la relación; el código
        de la partida medida es el child. El campo numérico siguiente es la
        cantidad total (autoritativa).
        """
        fields = split_record(line)
        if len(fields) < 4:
            return

        relation = fields[1]
        parts = relation.split("\\")
        if len(parts) < 2:
            return
        parent_code = parts[0].strip()
        code = parts[-1].strip()  # último elemento es el code real
        if not code:
            return

        qty_field = fields[3].strip()
        qty = _parse_spanish_float(qty_field)
        if qty is None:
            return

        parciales = fields[4] if len(fields) >= 5 else ""

        tree.measurements[code] = Bc3Measurement(
            parent_code=parent_code,
            code=code,
            total_quantity=qty,
            parciales_text=parciales,
            lines=self._parse_parciales(parciales),
        )

    def _parse_parciales(self, text: str) -> list[Bc3MeasurementLine]:
        """Parsea el string de parciales `~M` en líneas estructuradas.

        Formato FIEBDC-3: grupos de 6 campos separados por `\\`:
        `TIPO \\ COMENTARIO \\ UNIDADES \\ LONGITUD \\ LATITUD \\ ALTURA`.

          - Líneas con UNIDADES/dimensiones numéricas → subtotal calculado
            (unidades × longitud × latitud × altura, con 1 para las vacías).
          - Líneas solo con comentario (sin magnitudes) → encabezado de
            sección (p.ej. "PLANTA BAJA"), `is_section=True`.
          - Grupos incompletos al final se ignoran (defensivo).
        """
        if not text:
            return []
        parts = text.split("\\")
        lines: list[Bc3MeasurementLine] = []
        for i in range(0, len(parts) - 5, 6):
            _tipo, comment, uds, largo, ancho, alto = parts[i:i + 6]
            comment = comment.strip()
            u = _parse_spanish_float(uds)
            l = _parse_spanish_float(largo)
            w = _parse_spanish_float(ancho)
            h = _parse_spanish_float(alto)

            if u is None and l is None and w is None and h is None:
                # Sin magnitudes: encabezado de sección (o línea vacía).
                if comment:
                    lines.append(Bc3MeasurementLine(comment=comment, is_section=True))
                continue

            subtotal = (
                (u if u is not None else 1.0)
                * (l if l is not None else 1.0)
                * (w if w is not None else 1.0)
                * (h if h is not None else 1.0)
            )
            lines.append(
                Bc3MeasurementLine(
                    comment=comment,
                    units=u,
                    length=l,
                    width=w,
                    height=h,
                    subtotal=round(subtotal, 6),
                )
            )
        return lines

    # --- post-processing ---------------------------------------------------

    def _infer_kinds(self, tree: Bc3Tree) -> None:
        """Asigna `Bc3ConceptKind` heurísticamente.

        BC3 no marca el tipo de un `~C`; se deduce por estructura. Hay DOS
        familias de export muy distintas que debemos soportar ambas:

          - **Plano, medido** (p.ej. exports desde herramientas de medición):
            sin `~D`, cada partida se identifica por su `~M`. → `~M` ⇒ PARTIDA.
          - **Jerárquico, sin medir** (plantillas / "presupuesto en blanco"):
            árbol `~D` capítulo→partida, SIN `~M` ni precios. Aquí las partidas
            son las HOJAS colgando de un capítulo (no tienen `~D` propio). Si
            solo miráramos `~M`, este export produciría 0 partidas (budget vacío).

        Estrategia en dos pasadas:
          1. Detectar CAPÍTULOS (nodos de agrupación) por 3 señales robustas:
             es raíz (no lo referencia nadie) · su código acaba en `#`/`##`
             (marcador de capítulo FIEBDC) · o tiene algún hijo que a su vez
             tiene `~D` (agrupa sub-árboles). Un nodo con `~M` nunca es capítulo.
          2. Asignar el resto: `~M` ⇒ PARTIDA; hijo directo de un capítulo ⇒
             PARTIDA (aunque no tenga `~M` ni `~D` — la partida "en blanco");
             `~D` bajo capítulo ⇒ PARTIDA (descompuesta en recursos); resto de
             referenciados ⇒ COMPONENT; huérfanos ⇒ UNKNOWN.

        Lever 1 (reclasificar-no-borrar): en el path de promoción-de-hoja, una hoja
        sin precio que es una CABECERA de sección (`_looks_like_section_header`:
        auto-eco de palabra única, eco del capítulo, o cláusula boilerplate) se
        reclasifica a CHAPTER en vez de emitirse como partida — no se pricia ni
        infla el total. Ultra-conservador: el ancla `~M`/precio y las guardas
        protegen las partidas reales (nunca se borra ninguna).
        """
        # Set de códigos que aparecen como hijos en alguna decomposition.
        referenced_as_child: set[str] = set()
        for decomp in tree.decompositions.values():
            for child_code, _ in decomp.children:
                referenced_as_child.add(child_code)

        # Primer padre de cada código (para clasificar por tipo del padre).
        parent_of: dict[str, str] = {}
        for parent_code, decomp in tree.decompositions.items():
            for child_code, _ in decomp.children:
                parent_of.setdefault(child_code, parent_code)

        def has_child_with_decomp(code: str) -> bool:
            decomp = tree.decompositions.get(code)
            if not decomp:
                return False
            return any(cc in tree.decompositions for cc, _ in decomp.children)

        # --- Pasada 1: capítulos (nodos de agrupación) ---------------------
        chapters: set[str] = set()
        for code in tree.concepts:
            if code not in tree.decompositions:
                continue  # una hoja nunca agrupa nada → nunca es capítulo
            if code in tree.measurements:
                continue  # medido ⇒ partida, aunque tenga `~D` (partida-con-recursos)
            is_root = code not in referenced_as_child
            ends_hash = code.rstrip().endswith("#")  # marcador FIEBDC de capítulo
            if is_root or ends_hash or has_child_with_decomp(code):
                chapters.add(code)

        # --- Pasada 2: partidas / componentes ------------------------------
        for code, concept in tree.concepts.items():
            has_decomp = code in tree.decompositions
            has_measure = code in tree.measurements
            parent_code = parent_of.get(code)
            parent_is_chapter = parent_code in chapters

            if has_measure:
                concept.kind = Bc3ConceptKind.PARTIDA
            elif code in chapters:
                concept.kind = Bc3ConceptKind.CHAPTER
            elif (
                parent_is_chapter
                and not has_decomp
                and not _concept_has_price(concept)
                and _looks_like_section_header(
                    concept,
                    (tree.concepts.get(parent_code).description if parent_code and parent_code in tree.concepts else ""),
                )
            ):
                # Lever 1 — CABECERA de sección (auto-eco / eco de capítulo /
                # cláusula). Reclasificar-no-borrar a CHAPTER: no se pricia, no
                # infla el total. Ultra-conservador (solo señales inequívocas).
                concept.kind = Bc3ConceptKind.CHAPTER
            elif has_decomp:
                # `~D` sin medir y no es capítulo: partida descompuesta en
                # recursos si cuelga de un capítulo; si no, mantenemos el
                # comportamiento legacy (agrupación).
                concept.kind = (
                    Bc3ConceptKind.PARTIDA if parent_is_chapter else Bc3ConceptKind.CHAPTER
                )
            elif parent_is_chapter:
                # Hoja colgando de un capítulo: es una PARTIDA "en blanco"
                # (sin `~M` ni `~D` ni precio). Antes se perdía como COMPONENT.
                concept.kind = Bc3ConceptKind.PARTIDA
            elif code in referenced_as_child:
                concept.kind = Bc3ConceptKind.COMPONENT
            else:
                concept.kind = Bc3ConceptKind.UNKNOWN

    def _identify_roots(self, tree: Bc3Tree) -> None:
        """Identifica capítulos raíz (no son hijos de nadie).

        En FIEBDC-3 el primer `~C` suele ser el root del documento (~25-126##
        en Quatre Cantons). Sus hijos directos vía `~D` son los capítulos
        de primer nivel. Aquí simplemente listamos los capítulos no referenciados.
        """
        referenced_as_child: set[str] = set()
        for decomp in tree.decompositions.values():
            for child_code, _ in decomp.children:
                referenced_as_child.add(child_code)

        for code, concept in tree.concepts.items():
            if concept.kind == Bc3ConceptKind.CHAPTER and code not in referenced_as_child:
                tree.root_codes.append(code)

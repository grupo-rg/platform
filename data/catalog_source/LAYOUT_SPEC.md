# LAYOUT_SPEC — Parser COAATMCA Palma 47 (2025)

> Spec derivado de exploración real con `pdfplumber` sobre
> `docs/Palma47_2025_COAATMCA.pdf` (Fase A0, 2026-05-20).
>
> Antes de implementar el parser de extracción (Fase A), este documento
> define **qué es una partida**, **qué es un breakdown**, **cómo se detecta
> el capítulo/sub-capítulo** y **cómo se manejan los casos cross-page**.
>
> Sin este spec, el parser repetiría el error de S3-06 (extraer "21",
> "01.1" o "25 marzo 2025" como si fueran partidas).

## 1. Estructura física del PDF

- **Total páginas físicas**: 479.
- **Composición**:
  - **Página física 12**: portada del PDF (`CUADRO DE PRECIOS DESCOMPUESTOS`
    recuadrado y centrado). **SKIP** — `word_count=0`, sin footer canonical.
  - **Página física 13**: portada del primer capítulo (`• DEMOLICIONES •`
    centrado, entre líneas separadoras). **Extraer chapter_title, NO partidas**.
  - **Páginas físicas 14-477** (aprox): partidas + portadas de capítulo
    intercaladas + páginas de publicidad insertadas.
  - **Páginas físicas 474-477** (aprox): TOC con `•` y `••`.
  - **Páginas físicas 478-479**: contraportada / fin. **SKIP**.
- **Páginas de publicidad** intercaladas entre páginas de partidas
  (ejemplo: física 32 con anuncio TOMEU BARCELÓ entre impresa 19 y 20).
  El número de páginas de publicidad acumulado hace que el **offset
  físico↔impreso sea VARIABLE** (no constante +24).
- **Numeración impresa vs física**: offset variable, crece con cada
  página de publicidad insertada. Casos comprobados:
  | Código     | Página física | Página impresa |
  | ---------- | ------------- | -------------- |
  | XFB010     | 468           | 444            |
  | YMM010     | 459           | 436            |
  | 0XA110b    | 460           | 437            |
  | DQC040     | 14            | 12             |

  **Regla**: el parser usa SIEMPRE numeración física. Las referencias del
  usuario a "página 444" son impresas; convertir internamente.

## 1.B Clasificación de página (PRIMER paso del parser)

Antes de extraer NADA, clasificar cada página física en uno de 4 tipos:

| Tipo                  | Heurística determinista                                          | Acción                                        |
| --------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| `pdf_cover`           | `word_count < 10` AND sin footer canonical AND contiene texto    | SKIP                                          |
|                       | grande tipo `CUADRO DE PRECIOS DESCOMPUESTOS`                    |                                               |
| `chapter_cover`       | `10 <= word_count <= 40` AND contiene patrón `• [MAYÚS] •`       | EXTRAER `chapter_title` del bloque centrado;  |
|                       | centrado en el body AND footer canonical presente                | abrir nuevo capítulo; NO extraer partidas    |
| `advertisement`       | (`word_count < 100` OR mucho `image_count`) AND sin footer       | SKIP                                          |
|                       | canonical                                                         |                                               |
| `content_page`        | `word_count > 100` AND footer canonical (formato                 | PARSEAR partidas + breakdowns                 |
|                       | `MAYÚSCULAS Sub-capítulo`)                                       |                                               |
| `toc_page`            | Contiene líneas con patrón `• CAPITULO ........` o               | PARSEAR TOC (jerarquía)                       |
|                       | `•• Subcap .........`                                            |                                               |

### Detección de "footer canonical"

Regex aplicada a la concatenación de words en `y > 0.92*h`:

```regex
^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,YÍÓ]{3,40}\s+[A-Za-záéíóúñ][A-Za-záéíóúñ\s/,.-]{3,60}$
```

Ejemplos válidos:
```
DEMOLICIONES Forjados
CUBIERTAS Cubiertas planas
CARPINTERIA DE MADERA Puertas balconeras
BIOCONSTRUCCIÓN Cubierta
ENSAYOS Y CONTROL TECNICO Estanqueidad al finalizar la obra
```

Ejemplos NO válidos (descartar página):
```
BALEARES                          # contraportada
obramat.es                         # contraportada
Camí V ell de Sineu, 20E           # contraportada
(vacío)                           # publicidad
```

### Detección de "chapter_cover"

Una **portada de capítulo** tiene exactamente este patrón en el body:

```
─────────────────────────  (línea horizontal)
       • DEMOLICIONES •
─────────────────────────  (línea horizontal)
```

Detección programática:
1. `word_count` total entre 5 y 40 (margen amplio).
2. En `body`, una línea contiene SOLO 1-5 tokens: `["•", "DEMOLICIONES", "•"]`
   o `["•", "MOVIMIENTO", "DE", "TIERRAS", "•"]`.
3. Los tokens centrales (entre los dos `•`) están todos en MAYÚSCULAS y
   forman el `chapter_title` canónico.
4. Hay líneas horizontales arriba y abajo (`horizontal_lines >= 2`).

### Detección de "advertisement"

Una página de publicidad típicamente:
1. NO tiene footer canonical (regex anterior falla).
2. `word_count` bajo (anuncios usan mayormente imágenes).
3. NO contiene ningún código `^[A-Z0-9]{2,4}\d{2,4}[a-z]?$` ni breakdown.
4. Puede contener nombres comerciales, teléfonos, direcciones, URLs.

**Heurística segura**: si el footer no matchea el formato canonical Y la
página no tiene NI items detectables NI estructura de TOC → es
advertisement. SKIP.

## 2. Estructura de UNA página de contenido

### 2.1 Regiones por y-coord (height típica ≈ 842 pt para A4)

| Región    | Rango y       | Contenido                                                    |
| --------- | ------------- | ------------------------------------------------------------ |
| header    | `y < 0.10·h`  | Título del capítulo en font grande (a veces vacío)           |
| body      | `0.10·h..0.92·h` | Partidas, breakdowns, sub-capítulos en negrita            |
| footer    | `y > 0.92·h`  | `CAPÍTULO Sub-capítulo` repetido en cada página              |

### 2.2 Columnas (x-coords aproximadas)

Para una página A4 con ~30pt margin:

| Elemento                     | x range  | Notas                                  |
| ---------------------------- | -------- | -------------------------------------- |
| Código de partida            | 30–70    | Left-aligned, inicio de línea          |
| Unidad de partida            | 70–95    | `u`, `m²`, `m³`, `ml`, `kg`, `t`, ... |
| Descripción de partida       | 95–470   | Multilínea, puede contener saltos      |
| Precio total partida         | 470–580  | Right-aligned, font ligeramente mayor  |
| Código de breakdown          | 40–130   | Indentado un poco más que partida      |
| Cantidad breakdown           | 130–160  | Formato español `1,000`, `0,209`       |
| Unidad breakdown             | 160–175  | Corta                                  |
| Descripción breakdown        | 175–440  | Una sola línea típicamente             |
| Precio unitario breakdown    | 440–510  | Right-aligned                          |
| Precio total breakdown       | 510–580  | Right-aligned                          |

> **Coords aproximadas** — el parser debe inferirlas dinámicamente del
> primer batch de palabras de cada página, no hardcodear.

## 3. Patrones de identificación

### 3.1 Códigos de partida

Patrones reales observados:

```
DQC040     DEH020     DEF060     DRS070     DRS011     LVC010
XFB010     YMM010     YMM011     0XA110b    1012
```

**Regex permisivo**:

```regex
^[A-Z0-9][A-Z0-9_.]{1,14}$
```

**PERO la regex NO es suficiente**. Para validar que un token ES código
de partida (vs ser un breakdown code o una fecha), exigir:

1. Aparece al **inicio de línea** (x ≈ 30–50, antes que cualquier otro
   token en esa línea).
2. La línea contiene un **unit canónico** en la siguiente columna
   (`u`, `m²`, `m³`, `ml`, `kg`, `ud`, `t`, `h`, `l`, `pa`, `%`).
3. La línea termina con un **precio** numérico right-aligned (regex
   `\d+,\d{2}` o `\d+\.\d{2}`).

Si los 3 se cumplen → partida. Si no → puede ser breakdown o ruido.

### 3.2 Códigos de breakdown

Patrones reales observados:

```
mt49reh010aaa    mo20    mo023    mo055    mo058
UIB_MO_0001.1   13.11.01_UIB   13.12A.01_UIB   18.04.01_UIB
%   %0450   %0400   %CI   P40
```

**Regex muy permisivo**:

```regex
^[a-zA-Z0-9_.%][\w._%]{0,29}$
```

**Validar por contexto** (NO usar regex como único filtro):

1. Línea indentada respecto a partidas (x mayor que partida).
2. Tiene una **cantidad numérica** en formato español (`1,000`,
   `0,209`, `7,000`) en columna 2.
3. Tiene un **unit** corto en columna 3.
4. Termina con **precio unitario + precio total**.

### 3.3 Sub-capítulo

- Texto en **font Bold** (font name contiene `"Bold"`).
- En region=body.
- Línea corta (suele ocupar <50% del ancho de página).
- NO matchea regex de partida ni breakdown.

Ejemplos vistos:

```
Medicina preventiva    Andamios    Cubierta    Pinturas    Cubiertas planas
```

### 3.4 Capítulo (chapter)

**Fuente primaria**: el footer de cada página. Patrón:

```
CAPÍTULO Sub-capítulo
```

Ejemplos:

```
DEMOLICIONES Forjados
CUBIERTAS Cubiertas planas
CARPINTERIA DE MADERA Puertas balconeras
BIOCONSTRUCCIÓN Cubierta
BIOCONSTRUCCIÓN Pinturas
ENSAYOS Y CONTROL TECNICO Estanqueidad al finalizar la obra
```

**Parseo**: split por el primer espacio entre **caracteres mayúsculas** y
**caracteres mixtos**. La capítulo es la primera parte (todo en
MAYÚSCULAS, puede tener tildes, espacios y "Y"), el sub-capítulo es el
resto.

**⚠️ Cuidado: footer STALE en páginas de índice**. Las páginas
físicas 478-479 (índice del catálogo) muestran el footer del último
capítulo activo (`ENSAYOS Y CONTROL TECNICO Estanqueidad al finalizar...`),
**no del contenido actual**. El parser debe ignorar el footer en esas
páginas (detectar índice por presencia de `•` y `••`).

### 3.5 Índice del catálogo (TOC)

Páginas físicas 478-479. Estructura:

```
• DEMOLICIONES .........................................................
•• Cubiertas ...........................................................
•• Forjados ............................................................
•• Hormigones ..........................................................
•• ...
• REHABILITACIÓN, REPARACIÓN Y MANTENIMIENTO ...........................
•• PREPARACIÓN DE SUPERFICIES ..........................................
•• ...
• BIOCONSTRUCCIÓN ......................................................
•• Actuaciones previas .................................................
```

Jerarquía:
- `•` (un punto): capítulo nivel 1.
- `••` (dos puntos): sub-capítulo nivel 2.
- Después puntos guía (`..........`) y opcionalmente número de página
  impreso (que NO leemos — usamos físico).

**Útil para**:
- Validar que el parser extrae partidas de TODOS los capítulos del índice.
- Detectar capítulos completos faltantes.

## 4. Casos edge (críticos)

### 4.1 Partida cruzando dos páginas

Una partida puede empezar en página N (código + unit + descripción) y
**continuar** en N+1 (resto descripción + breakdowns + precio_total al
final del bloque).

**Detección**: si la primera línea de body de la página N+1 NO empieza
con un código de partida válido (3.1), entonces es **continuación** de la
partida iniciada en N.

**Algoritmo**: mantener `current_item` cross-page. Cerrar partida solo al
detectar un nuevo código de partida o final de archivo.

### 4.2 Sub-capítulo cambia mid-page

Una página puede tener:

```
... breakdown final de la partida anterior ...
<separador horizontal>
[BOLD] Nuevo sub-capítulo
[CODE] [unit] descripción de partida...
```

**Detección**: cualquier texto en bold dentro del body que NO matchee
regex de partida es un sub-capítulo. Resetear `current_subchapter`.

### 4.3 Página solo de breakdowns (continuación de una partida grande)

Cuando la partida tiene muchos breakdowns (>30 filas), continúa en una
página siguiente que NO contiene código de partida nuevo, solo
breakdowns y al final el precio_total.

**Detección**: igual que 4.1 — si la página no empieza con código de
partida, es continuación.

### 4.4 Cambio de capítulo cross-page

A veces una página termina con el último breakdown del capítulo A, y la
siguiente empieza con el primer item del capítulo B. El footer de la
página A todavía dice `CAPÍTULO_A Sub-capítulo_A`, la de B ya dice
`CAPÍTULO_B Sub-capítulo_B`.

**Algoritmo**: usar el footer de la página donde aparece la primera
línea del item, no de la anterior.

### 4.5 Notas dentro de descripción

La descripción puede contener:

```
Suministro y colocación de doble acristalamiento estándar, 4/12/4...
Incluye: Colocación, calzado, montaje y ajuste en la carpintería.
Criterio de medición de proyecto: Superficie acristalada según UNE...
Normativa de aplicación: UNE-EN 1279.
```

`Incluye:`, `Criterio de medición de proyecto:`, `Normativa de aplicación:`
son **PARTE de la descripción**, no headers separados. El parser debe
concatenarlos.

### 4.6 Códigos de breakdown personalizados (no canónicos)

El catálogo incluye breakdowns con códigos no-COAATMCA:

- `UIB_MO_*` (Universitat de les Illes Balears, mano de obra).
- `13.XX.XX_UIB` (UIB con dewey-decimal).
- `%CI`, `%0450`, `%0400` (medios auxiliares con sufijo).
- `P40` (códigos cortos custom).

El parser NO debe asumir prefijos `mt/mo/mq` exclusivamente.

## 5. Algoritmo de extracción (resumen)

```python
def extract_catalog(pdf_path):
    items = []
    current_chapter = None
    current_subchapter = None
    current_item = None

    with pdfplumber.open(pdf_path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            # PASO 0: clasificar página antes de tocar el contenido.
            page_type = classify_page(page)

            if page_type == "pdf_cover" or page_type == "advertisement":
                continue  # SKIP totalmente

            if page_type == "chapter_cover":
                # Cerrar item anterior y resetear contexto.
                if current_item:
                    items.append(current_item.finalize())
                    current_item = None
                current_chapter = extract_chapter_title_from_cover(page)
                current_subchapter = None  # el sub-cap real vendrá del footer de la siguiente
                continue

            if page_type == "toc_page":
                toc.extend(extract_toc_entries(page))
                continue

            # Page type == "content_page"
            # 1. Extract footer chapter
            footer_text = extract_footer_text(page)
            ch, subch = parse_chapter_subchapter(footer_text)
            # El footer del capítulo es source-of-truth en cada page; solo se
            # actualiza el chapter si difiere (cross-page chapter transition).
            current_chapter = ch
            current_subchapter = subch  # se puede sobreescribir por bold inline

            # 2. Lines de body
            lines = extract_body_lines(page)

            for line in lines:
                if is_subchapter_bold(line):
                    if current_item:
                        items.append(current_item.finalize())
                        current_item = None
                    current_subchapter = line.text.strip()
                    continue

                if is_partida_line(line):
                    if current_item:
                        items.append(current_item.finalize())
                    current_item = Partida.from_line(line, current_chapter, current_subchapter)
                    continue

                if is_breakdown_line(line) and current_item:
                    current_item.add_breakdown(line)
                    continue

                # Línea de continuación de descripción.
                if current_item:
                    current_item.append_description(line.text)

    if current_item:
        items.append(current_item.finalize())

    return items
```

## 6. Validación post-extracción

Después de extraer, validar:

1. **Total items ≥ 1,661** (paridad con `prices/coaatmca_2025_price_book.json`).
2. **Cada capítulo del índice (físicas 478-479) tiene partidas extraídas**.
3. **Sin partidas con descripción vacía** (>50 chars mínimo).
4. **Sin partidas con código duplicado** (los duplicados del JSON
   también deberían aparecer aquí — útil para confirmar el bug del JSON).
5. **Cross-check delta** vs JSON:
   - Items en PDF NOT en JSON → posibles items perdidos en parser JSON
     original.
   - Items en JSON NOT en PDF → posibles items inventados.

## 7. Output esperado

```json
{
  "source_pdf": "docs/Palma47_2025_COAATMCA.pdf",
  "extracted_at": "2026-05-20T...",
  "stats": {
    "total_items": 1700,
    "total_breakdowns": 11000,
    "chapters": 25,
    "subchapters": 95
  },
  "items": [
    {
      "code": "DQC040",
      "unit": "m²",
      "price_total": 17.41,
      "description": "Desmontaje de cobertura de teja cerámica curva, colocada con mortero...",
      "chapter": "DEMOLICIONES",
      "subchapter": "Cubiertas",
      "page_physical": 14,
      "breakdowns": [
        { "code": "mo020", "quantity": 0.123, "unit": "h", "description": "Oficial 1ª construcción.", "price_unit": 28.65, "price_total": 3.52 },
        { "code": "mo113", "quantity": 0.554, "unit": "h", "description": "Peón ordinario construcción.", "price_unit": 23.02, "price_total": 12.75 },
        { "code": "%",     "quantity": 7.0,   "unit": "%", "description": "Medios auxiliares",            "price_unit": 16.27, "price_total": 1.14 }
      ]
    }
  ],
  "toc": [
    { "level": 1, "title": "DEMOLICIONES", "page_physical": 14 },
    { "level": 2, "title": "Cubiertas",    "page_physical": 14 },
    { "level": 2, "title": "Forjados",     "page_physical": 16 },
    ...
  ]
}
```

## 8. Pendientes para Fase A

- [ ] Implementar `is_partida_line(line)` con detección por contexto (3 reglas de 3.1).
- [ ] Implementar `is_breakdown_line(line)` (3.2).
- [ ] Implementar `is_subchapter_bold(line)` con detección de fontname.
- [ ] Parser de footer cross-page (3.4 + 4.4).
- [ ] Acumulador cross-page de partida (4.1, 4.3).
- [ ] Parser de TOC (3.5 + 6.2).
- [ ] Cross-check delta vs JSON existente (6.5).
- [ ] Tests con páginas físicas representativas:
  - 14 (DQC040, primer capítulo).
  - 100 (CUBIERTAS Cubiertas planas).
  - 250 (CARPINTERIA DE MADERA).
  - 459 (YMM010/011, partidas pequeñas múltiples).
  - 460 (0XA110b, comienzo de Andamios).
  - 468 (XFB010, ensayos).
  - 478 (índice TOC).

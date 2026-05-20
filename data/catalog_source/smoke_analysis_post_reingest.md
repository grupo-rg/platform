# Budget Analysis Report

- **Budget ID**: `31217dbb-0063-48f0-8b49-587ebe579ae7`
- **Lead ID**: `admin-user`
- **Title**: —
- **Total estimated**: 23493.95 €
- **Created at**: 2026-05-20 17:24:05.710828+00:00

## Global stats

- Items: **74**
- Chapters: **3**
- Needs human review: **34**
- Match distribution: `{'from_scratch': 21, '1:1': 44, '1:N': 9}`
- Confidence distribution: `{'40-85': 34, '>90': 40}`

## Telemetry

- Total events: **485**
- partida_resolved_v2: **74**
- Tier used distribution: `{'cache': 30, 'flash': 44}`
- **job_metrics_final**:
  - tier_flash_count: `44`
  - total_tokens_out: `19889`
  - cache_hit_rate: `0.4054`
  - total_tokens_in: `310506`
  - tier_pro_count: `0`
  - total_cost_usd: `0.02761484599999999`
  - latency_p95: `237395.9`
  - duration_seconds: `245.04`
  - latency_p50: `230510.0`
  - partidas_total: `74`
  - needs_review_count: `0`
- Events by type:
  - `item_resolved`: 74
  - `partida_resolved_v2`: 74
  - `structural_filters_applied`: 44
  - `tier_assigned`: 44
  - `pricing_model_resolved`: 44
  - `vector_search`: 44
  - `rerank_applied`: 38
  - `tier_escalation_suppressed`: 34
  - `pricing_cache_hit`: 30
  - `breakdown_quantity_derived`: 24
  - `breakdown_inherited_1to1`: 12
  - `pricing_cache_persisted`: 10
  - `partida_needs_reconciliation`: 2
  - `extraction_started`: 1
  - `inline_fast_path_used`: 1
  - `subtasks_extracted`: 1
  - `pricing_cache_batch_summary`: 1
  - `vector_search_started`: 1
  - `batch_pricing_submitted`: 1
  - `swarm_concurrency_set`: 1

## Chapters & partidas

### (sin título)
`70369b94-e1e2-4566-882d-662dcd659b41` · 2 ítems · subtotal: — €

#### `7.1` — Recogida de escombros, clasificación de materiales, carga a camión o contenedor y transporte a verte
- **unit**: m3 · **qty**: 1.0 · **unit_price**: 70.94 € · **total**: 70.94 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida describe un servicio completo de recogida, clasificación, carga y transporte de escombros a vertedero autorizado. Dado que no se encontraron candidatos en la base de datos (CANDIDATOS ENJAMBRE: []), se aplica la regla de seguridad 'from_scratch'. Se estima el precio unitario por m³ basándose en los costes típicos de mercado en España para este tipo de servicio. Se desglosa conceptualmente en: 1. Carga y clasificación (mano de obra): Se estima 0.67 horas de peón por m³ (rendimiento de 1.5 m³/h) a un coste de 25 €/h, resultando en 16.75 €/m³. 2. Transporte y gestión de vertedero: Basado en el coste de un contenedor de 5 m³ (aprox. 200 € incluyendo transporte y tasas de vertedero), lo que equivale a 40 €/m³. Sumando ambos componentes (16.75 + 40), se obtiene un precio estimado de 56.75 €/m³.


#### `7.2` — Canon escombros residuos inertes Estimación: 2 contenedores de 5 m3 10 10,000 Subtotal 10,000 10,000
- **unit**: m3 · **qty**: 1.0 · **unit_price**: 687.5 € · **total**: 687.5 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> Estimación del coste de gestión de 10 m3 de residuos inertes (2 contenedores de 5 m3). Se estima un coste de 150 €/contenedor por alquiler y transporte (2x150=300€) más 25 €/m3 por canon de vertido (10x25=250€). El precio unitario se establece como el coste total de este servicio (550€), ya que la cantidad de la partida es 1.0 m3 y la descripción detalla el volumen total a gestionar, lo que implica que el 1.0 m3 es una unidad nominal para el servicio completo.


### (sin título)
`9a7aa80c-0b90-41b4-b923-41ea0a44c36a` · 68 ítems · subtotal: — €

#### `1.2.6` — Eliminación de revestimiento de yeso (techos) Sótano local. Punto coincidente con gotera. 1 10,000 1
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 19.76 € · **total**: 19.76 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-07-picado-tendido-yeso-pa-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida solicita la eliminación de revestimiento de yeso en techos. El candidato DRF020 describe la 'Eliminación de revestimiento de yeso aplicado sobre paramento horizontal', lo cual coincide perfectamente con la descripción de la partida ('techos') y la unidad (m2). No se aplica ningún factor de corrección del ICL ya que la partida es una demolición simple en m2 y no una partida alzada de picado y tendido de yeso con reposición.

- **selected_candidate**: `DRF020` — Eliminación de revestimiento de yeso aplicado sobre paramento horizontal de hasta 3 m de altura, con medios manuales, si
- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 18.47 €
  - `%` Medios auxiliares — total: 1.29 €
- **alternatives**: 2 candidatos rechazados

#### `9.1` — Aplicación manual de dos manos de pintura plástica color blanco, acabado mate, textura lisa, la prim
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 9.14 € · **total**: 9.14 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida solicita la aplicación de dos manos de pintura plástica con imprimación sobre paramento interior de yeso o escayola. El candidato RIP030a coincide casi perfectamente en tipo de pintura, número de manos, dilución, tipo de imprimación y superficie (yeso/escayola). La única diferencia es que la partida original especifica 'horizontal' y el candidato 'vertical'. Sin embargo, para este tipo de trabajo de pintura interior a baja altura (hasta 3m), la diferencia en rendimiento y coste entre una superficie horizontal (techo) y vertical (pared) es mínima y se considera cubierta por el precio unitario estándar. El precio de 7.31 €/m² es coherente con los precios de mercado para este tipo de aplicación y se alinea con el rango de precios base para pintura plástica interior.

- **selected_candidate**: `RIP030a` — Aplicación manual de dos manos de pintura plástica con etiqueta ecológica europea (EEE) color a elegir, acabado mate, te
- **breakdown** (5 componentes):
  - `mt27pfp010b` Imprimación a base de copolímeros acrílicos en suspensión acuosa, para favorecer — total: 0.38 €
  - `mt27pir030a` Pintura plástica ecológica para interior a base de copolímeros acrílicos, pigmen — total: 1.71 €
  - `mo038` Oficial 1ª pintor. — total: 3.71 €
  - `mo076` Ayudante pintor. — total: 2.99 €
  - `%` Medios auxiliares — total: 0.35 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.6` — Eliminación de revestimiento de yeso (techos) Sótano local. Punto coincidente con gotera. 1 10,000 1
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 19.76 € · **total**: 19.76 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-07-picado-tendido-yeso-pa-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida solicita la eliminación de revestimiento de yeso en techos. El candidato DRF020 describe la 'Eliminación de revestimiento de yeso aplicado sobre paramento horizontal', lo cual coincide perfectamente con la descripción de la partida ('techos') y la unidad (m2). No se aplica ningún factor de corrección del ICL ya que la partida es una demolición simple en m2 y no una partida alzada de picado y tendido de yeso con reposición.

- **selected_candidate**: `DRF020` — Eliminación de revestimiento de yeso aplicado sobre paramento horizontal de hasta 3 m de altura, con medios manuales, si
- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 18.47 €
  - `%` Medios auxiliares — total: 1.29 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.8` — Enlucido horizontal de yeso (techos) Sótano local 10 10,000 Subtotal 10,000 10,000 0,00 0,00
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 20.6 € · **total**: 20.6 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita un 'Enlucido horizontal de yeso (techos)'. El candidato RPG010 es el que mejor se ajusta, ya que describe la 'Formación de revestimiento continuo interior de yeso, a buena vista, sobre paramento horizontal, hasta 3 m de altura, de 15 mm de espesor', lo cual es adecuado para un techo y comprende tanto el guarnecido como el enlucido. El precio unitario es de 16.48 €/m².

- **selected_candidate**: `RPG010` — Formación de revestimiento continuo interior de yeso, a buena vista, sobre paramento horizontal, hasta 3 m de altura, de
- **breakdown** (6 componentes):
  - `mt28vye020` Malla de fibra de vidrio tejida, antiálcalis, de 5x5 mm de luz de malla, flexibl — total: 0.12 €
  - `mt09pye010b` Pasta de yeso de construcción B1, según UNE-EN 13279-1. — total: 3.24 €
  - `mt09pye010a` Pasta de yeso para aplicación en capa fina C6, según UNE-EN 13279-1. — total: 0.81 €
  - `mo033` Oficial 1ª yesero. — total: 11.15 €
  - `mo071` Ayudante yesero. — total: 4.49 €
  - …y 1 más
- **alternatives**: 2 candidatos rechazados

#### `9.1` — Aplicación manual de dos manos de pintura plástica color blanco, acabado mate, textura lisa, la prim
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 8.32 € · **total**: 8.32 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La descripción de la partida coincide casi exactamente con el candidato 'RIP030', que describe la aplicación manual de dos manos de pintura plástica con imprimación sobre paramento interior de yeso o escayola, incluyendo enmasillado y lijado de faltas. Esto es muy adecuado dado el contexto de 'punto coincidente con gotera'. Las unidades (m2) son idénticas, por lo que no se requiere conversión. El precio unitario del candidato es 6.66 €/m2.

- **selected_candidate**: `RIP030` — Aplicación manual de dos manos de pintura plástica, color a elegir, acabado mate, textura lisa, la primera mano diluida 
- **breakdown** (5 componentes):
  - `mt27pfp010b` Imprimación a base de copolímeros acrílicos en suspensión acuosa, para favorecer — total: 0.38 €
  - `mt27pir020a` Pintura plástica para interior, a base de copolímeros acrílicos, pigmentos y adi — total: 0.93 €
  - `mo038` Oficial 1ª pintor. — total: 3.71 €
  - `mo076` Ayudante pintor. — total: 2.99 €
  - `%` Medios auxiliares — total: 0.33 €
- **alternatives**: 2 candidatos rechazados

#### `1.3.1` — Demolición de fiola con medios manuales, sin deteriorar los elementos constructivos contiguos. Muret
- **unit**: ml · **qty**: 1.0 · **unit_price**: 3.59 € · **total**: 3.59 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> Se selecciona el candidato DHE020 'Demolición de fiola de remate de balcón con medios manuales' por su perfecta coincidencia semántica y de unidad (m/ml) con la partida original 'Demolición de fiola con medios manuales'. El precio unitario es 2.87 €/ml.

- **selected_candidate**: `DHE020` — Demolición de fiola de remate de balcón con medios manuales, sin deteriorar los elementos constructivos contiguos, y car
- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 3.35 €
  - `%` Medios auxiliares — total: 0.24 €
- **alternatives**: 2 candidatos rechazados

#### `6.1.3` — Suministro y colocación de fiola imitación piedra de Santanyí, como acabado de la baldosa en zo- na 
- **unit**: ml · **qty**: 1.0 · **unit_price**: 72.47 € · **total**: 72.47 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> Se selecciona el candidato ECS040 por ser la descripción más ajustada a 'fiola de piedra de Santanyí' y coincidir la unidad (ml/m). El precio incluye suministro y colocación. La mención a 'imitación' en la partida se considera cubierta por 'comercial' en el candidato, siendo el más apropiado de los disponibles.

- **selected_candidate**: `ECS040` — Suministro y colocación de fiola de piedra de Santanyí comercial de sección rectangular labrada, con goterón, de 25x3 cm
- **breakdown** (6 componentes):
  - `mt06jdl040a` Fiola de piedra de Santanyí comercial de sección rectangular labrada, con goteró — total: 35.09 €
  - `mt09mba010e` Mortero de cemento CEM II/B-P 32,5 N tipo M-10 y picadís, confeccionado en obra  — total: 2.36 €
  - `mt09mcr021a` Adhesivo cementoso C1, color gris. — total: 0.11 €
  - `mo022` Oficial 1ª colocador de piedra natural. — total: 16.73 €
  - `mo060` Ayudante colocador de piedra natural. — total: 13.45 €
  - …y 1 más
- **alternatives**: 2 candidatos rechazados

#### `02.06.03` — Demolición de alicatado existente de baldosas cerámicas, con medios manuales, sin deteriorar los ele
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 18.26 € · **total**: 18.26 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita la demolición de alicatado de baldosas cerámicas con medios manuales, sin deteriorar elementos contiguos. El candidato DRS020 'Demolición de pavimento existente de baldosas cerámicas, con medios manuales, sin deteriorar los elementos constructivos contiguos, y carga manual sobre camión o contenedor' es el que mejor se ajusta a la descripción y método de ejecución. Aunque la partida menciona 'alicatado' (revestimiento vertical) y el candidato 'pavimento' (revestimiento horizontal), la naturaleza del material (baldosas cerámicas), los medios (manuales) y la precaución ('sin deteriorar') son idénticas, haciendo que el precio sea directamente aplicable. Los otros candidatos (DQA010, DQA020) implican 'cubierta plana' y 'martillo neumático', lo cual no concuerda con la descripción de la partida original.

- **selected_candidate**: `DRS020` — Demolición de pavimento existente de baldosas cerámicas, con medios manuales, sin deteriorar los elementos constructivos
- **breakdown** (3 componentes):
  - `mo112` Peón especializado construcción. — total: 7.82 €
  - `mo113` Peón ordinario construcción. — total: 9.24 €
  - `%` Medios auxiliares — total: 1.2 €
- **alternatives**: 2 candidatos rechazados

#### `08.09` — Suministro aplacado de grés porcelánico acabado mate o natural, dimensiones 120x60 cm, color a defin
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 78.45 € · **total**: 78.45 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> El candidato RAG012c es el más adecuado para el aplacado de gres porcelánico en paramentos interiores. Aunque las dimensiones de la pieza son diferentes (120x60 cm en la partida vs 40x40 cm en el candidato) y hay diferencias en el tipo de adhesivo (C1 TE vs C2), tipo de rejuntado (CG2 W A vs lechada simple) y material de las cantoneras (acero inoxidable vs PVC), el precio de 62.76 €/m2 del candidato se considera representativo. Las piezas de gran formato y las cantoneras de acero inoxidable de la partida podrían implicar un coste ligeramente superior, pero el candidato ya incluye un adhesivo C2, que es de mayor calidad que el C1 TE. Se asume que el precio del candidato es un buen equilibrio para la partida descrita.

- **selected_candidate**: `RAG012c` — Suministro y colocación de alicatado con gres porcelánico acabado pulido, 40x40 cm, 30,84 €/m², capacidad de absorción d
- **breakdown** (7 componentes):
  - `mt09mcr021h` Adhesivo cementoso normal, C2 según UNE-EN 12004, color gris. — total: 5.25 €
  - `mt19awa010` Cantonera de PVC en esquinas alicatadas. — total: 0.56 €
  - `mt19abp010ak…` Baldosa cerámica de gres porcelánico, acabado pulido, 40x40 cm, 30,84€/m², capac — total: 40.48 €
  - `mt09lec010b` Lechada de cemento blanco BL 22,5 X. — total: 0.2 €
  - `mo024` Oficial 1ª alicatador. — total: 14.86 €
  - …y 2 más
- **alternatives**: 2 candidatos rechazados

#### `1.2.4` — Picado y saneado de las grietas y desconchamientos hasta encuentro con una base sólida, con medios m
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 22.66 € · **total**: 22.66 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita el 'Picado y saneado de las grietas y desconchamientos hasta encuentro con una base sólida, con medios manuales'. El candidato 'DRF011b' describe la 'Eliminación de enfoscado de cemento... con medios manuales', lo cual se ajusta perfectamente a la descripción de la partida original, tanto en la naturaleza del trabajo (saneado/eliminación de desconchados) como en el método (manual). Los candidatos 'D3001.0070' y 'D3001.0080' especifican 'Picado mecánico', lo cual contradice la descripción de la partida. Por lo tanto, 'DRF011b' es el candidato más adecuado. La unidad (m2) coincide directamente, por lo que no se requiere conversión.

- **selected_candidate**: `DRF011b` — Eliminación de enfoscado de cemento, aplicado sobre paramento horizontal de hasta 3 m de altura, con medios manuales, si
- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 21.18 €
  - `%` Medios auxiliares — total: 1.49 €
- **alternatives**: 2 candidatos rechazados

#### `4.1` — Formación de revestimiento continuo de mortero de cemento con aditivo hidrófugo, tipo GP CSII W0, ma
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 27.29 € · **total**: 27.29 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La descripción de la partida coincide casi perfectamente con el candidato RPE005. Ambos describen un revestimiento continuo de mortero de cemento tipo GP CSII W0, de 15 mm de espesor, aplicado en paramento vertical hasta 3 m de altura, con aditivo hidrófugo y malla de fibra de vidrio antiálcalis en el 20% de la superficie para refuerzo de encuentros y frentes de forjado. También incluyen la formación de juntas, rincones, mochetas, jambas, dinteles y remates. La unidad de medida (m2) es idéntica. El candidato RPE005c es para paramento horizontal, y RPE010b es tipo CSIII W0 y con acabado fratasado, lo que lo hace menos preciso que RPE005. Por lo tanto, RPE005 es el mejor candidato.

- **selected_candidate**: `RPE005` — Formación de revestimiento continuo de mortero de cemento, tipo GP CSII W0, a buena vista, de 15 mm de espesor, aplicado
- **breakdown** (5 componentes):
  - `mt09mif020d` Mortero industrial para revoco y enlucido de uso corriente, de cemento, tipo GP  — total: 3.99 €
  - `mt09var030a` Malla de fibra de vidrio tejida, con impregnación de PVC, de 10x10 mm de luz de  — total: 0.68 €
  - `mo020` Oficial 1ª construcción. — total: 14.86 €
  - `mo113` Peón ordinario construcción. — total: 5.98 €
  - `%` Medios auxiliares — total: 1.79 €
- **alternatives**: 2 candidatos rechazados

#### `9.2` — Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, color a elegir, acaba- 
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 15.04 € · **total**: 15.04 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La descripción de la partida coincide exactamente con el candidato RFL010, que es una pintura de caucho sintético tipo Pliolite con imprimación, a un precio de 12.03 €/m². La unidad de la partida y del candidato es m², por lo que no se requiere conversión de unidades. El precio es el del catálogo para este tipo específico de pintura.

- **breakdown** (6 componentes):
  - `mt27pfs010d` Imprimación acrílica, reguladora de la absorción, permeable al vapor de agua y r — total: 1.26 €
  - `mt27pii040r` Pintura para exterior, a base de resinas de Pliolite y disolventes orgánicos, co — total: 1.79 €
  - `mt27pfs040b` Diluyente para aplicar con brocha, rodillo o pistola. — total: 0.01 €
  - `mo038` Oficial 1ª pintor. — total: 6.31 €
  - `mo076` Ayudante pintor. — total: 5.09 €
  - …y 1 más
- **alternatives**: 3 candidatos rechazados

#### `1.2.4` — Picado y saneado de las grietas y desconchamientos hasta encuentro con una base sólida, con medios m
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 45.51 € · **total**: 45.51 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> Se selecciona el candidato D3001.0070 'Picado mecánico mediante pistolete, bujarda o similar, de superficie de hormigón hasta una profundidad de 20 mm, incluso limpieza posterior del soporte y del material extraído.' a un precio de 36.41 €/m2. Aunque la partida original especifica 'medios manuales' y el candidato 'picado mecánico', las herramientas como el pistolete o la bujarda son operadas manualmente y la descripción del candidato es la que mejor se ajusta a la acción de picado y saneado de grietas y desconchamientos en una superficie de hormigón. Los otros candidatos son para desbroce o despedregado de terreno, lo cual no es aplicable a petos de terraza.

- **selected_candidate**: `D3001.0070` — Picado mecánico mediante pistolete, bujarda o similar, de superficie de hormigón hasta una profundidad de 20 mm, incluso
- **breakdown** (5 componentes):
  - `B0001.0060` Peon especializado — total: 17.01 €
  - `B0001.0070` 22. Peon suelto — total: 16.45 €
  - `B1917.0060` compresor con bujarda — total: 5.94 €
  - `B1904.0100` dia grupo electrog insonor 40kva — total: 3.14 €
  - `%0600` Medios auxiliares — total: 2.97 €
- **alternatives**: 2 candidatos rechazados

#### `4.1` — Formación de revestimiento continuo de mortero de cemento con aditivo hidrófugo, tipo GP CSII W0, ma
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 32.88 € · **total**: 32.88 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita un revestimiento continuo de mortero de cemento con aditivo hidrófugo, tipo GP CSII W0, maestreado, de 15 mm de espesor, aplicado sobre un paramento vertical hasta 3 m de altura, con malla de fibra de vidrio antiálcalis y formación de juntas, rincones, mochetas, jambas, dinteles y remates. El candidato RPE005b coincide perfectamente con todas estas especificaciones, incluyendo el detalle clave de ser 'maestreado' y aplicado sobre 'paramento vertical', a diferencia de otros candidatos que mencionan 'a buena vista' o 'paramento horizontal'. Por lo tanto, RPE005b es el mejor candidato.

- **breakdown** (5 componentes):
  - `mt09mif020a` Mortero industrial para revoco y enlucido de uso corriente, de cemento, tipo GP  — total: 3.99 €
  - `mt09var030a` Malla de fibra de vidrio tejida, con impregnación de PVC, de 10x10 mm de luz de  — total: 0.68 €
  - `mo020` Oficial 1ª construcción. — total: 18.59 €
  - `mo113` Peón ordinario construcción. — total: 7.48 €
  - `%` Medios auxiliares — total: 2.15 €
- **alternatives**: 3 candidatos rechazados

#### `9.2` — Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, color a elegir, acaba- 
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 15.04 € · **total**: 15.04 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida solicita la aplicación de pintura de caucho sintético tipo Pliolite sobre paramento exterior de mortero, incluyendo imprimación acrílica. El candidato RFL010 coincide de forma exacta con esta descripción, especificando el tipo de pintura (Pliolite), el rendimiento, la dilución y la aplicación de imprimación acrílica sobre paramento exterior de mortero. Los otros candidatos (RFP010 y RIP030) son para pintura plástica genérica o para uso interior, respectivamente, y no se ajustan a la especificación de 'Pliolite' ni al uso exterior en el caso de RIP030. Por lo tanto, RFL010 es el candidato más adecuado con un precio unitario de 12.03 €/m².

- **selected_candidate**: `RFL010` — Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, color a elegir, acabado mate, textura lisa,
- **breakdown** (1 componentes):
  - `RFL010` Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, col — total: 15.04 €
- **alternatives**: 2 candidatos rechazados

#### `01.4.02` — Suministro y colocación de paragravillas universal de PVC en sumideros. Terraza trasera edificio 2 2
- **unit**: u · **qty**: 1.0 · **unit_price**: 40.6 € · **total**: 40.6 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita el "Suministro y colocación de paragravillas universal de PVC en sumideros". El candidato 'ASI020' describe la "Instalación de sumidero sifónico de PVC... con rejilla de PVC...". Una rejilla en un sumidero cumple la función de paragravillas. Aunque el candidato es para una instalación completa de sumidero, es el más relevante entre los proporcionados y su etiqueta 'origen_swam' lo asocia directamente con "paragravillas PVC". La unidad 'u' coincide. Por lo tanto, se toma el precio del sumidero como el precio unitario para la paragravillas.

- **selected_candidate**: `ASI020` — Instalación de sumidero sifónico de PVC, de salida vertical de 90 mm de diámetro, con rejilla de PVC de 250x250 mm, para
- **breakdown** (4 componentes):
  - `mt11sup030i` Sumidero sifónico de PVC, de salida vertical de 90 mm de diámetro, con rejilla d — total: 19.52 €
  - `mt11var020` Material auxiliar para saneamiento. — total: 1.16 €
  - `mo008` Oficial 1ª fontanero. — total: 18.35 €
  - `%` Medios auxiliares — total: 1.56 €
- **alternatives**: 2 candidatos rechazados

#### `08.15` — Formación de junta de dilatación de 20 mm de ancho, con masilla de poliuretano monocompo- nente, inc
- **unit**: ml · **qty**: 1.0 · **unit_price**: 17.96 € · **total**: 17.96 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> Se selecciona el candidato D0609.0030 por ser una coincidencia casi exacta en la descripción de la partida, incluyendo el ancho de la junta (20 mm), el tipo de masilla (poliuretano monocomponente), la limpieza, la imprimación en base poliuretano de los labios de junta y el cordón de fondo de junta en polietileno de 30 mm de diámetro. La unidad 'm' del candidato es directamente compatible con la unidad 'ml' de la partida.

- **selected_candidate**: `D0609.0030` — Sellado de junta de dilatación de 20 mm. de ancho con masilla de poliuretano monocomponente, incluso limpieza, imprimaci
- **breakdown** (5 componentes):
  - `B3201.0080` Imprimación de poliuretano para sellados — total: 0.72 €
  - `B0501.0180` ML cordón de polietileno Ø 30mm — total: 1.69 €
  - `B0501.0195` cartucho sellador y adhesivo de poliuretano — total: 6.94 €
  - `B0001.0030` oficial 1ª — total: 7.44 €
  - `%1000` Medios auxiliares — total: 1.17 €
- **alternatives**: 2 candidatos rechazados

#### `01.9.1` — Hidrolavado con tratamiento de hipoclorito de sodio para desinfectar y eliminar moho y pulido de la 
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 28.21 € · **total**: 28.21 €
- **match_kind**: `1:N` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida se descompone en dos actividades principales: hidrolavado/desinfección y pulido de superficie. Se selecciona el candidato 'D3001.0040' para el hidrolavado a presión y eliminación de suciedad/moho, y el candidato 'RSC030' para el pulido de la superficie. Ambos candidatos tienen unidad en m2, coincidiendo con la partida original. El precio unitario final es la suma de los precios unitarios de los componentes.

- **breakdown** (2 componentes):
  - `D3001.0040` Chorreado de superficies de hormigón mediante proyección de agua a presión, elim — total: 8.65 €
  - `RSC030` Ejecución en obra de pulido mediante máquina pulidora y abrillantado mediante má — total: 19.56 €
- **alternatives**: 3 candidatos rechazados

#### `01.9.1` — Hidrolavado con tratamiento de hipoclorito de sodio para desinfectar y eliminar moho y pulido de la 
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 28.21 € · **total**: 28.21 €
- **match_kind**: `1:N` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida se descompone en dos actividades principales: hidrolavado/desinfección y pulido de superficie. Se selecciona el candidato 'D3001.0040' para el hidrolavado a presión y eliminación de suciedad/moho, y el candidato 'RSC030' para el pulido de la superficie. Ambos candidatos tienen unidad en m2, coincidiendo con la partida original. El precio unitario final es la suma de los precios unitarios de los componentes.

- **breakdown** (2 componentes):
  - `D3001.0040` Chorreado de superficies de hormigón mediante proyección de agua a presión, elim — total: 8.65 €
  - `RSC030` Ejecución en obra de pulido mediante máquina pulidora y abrillantado mediante má — total: 19.56 €
- **alternatives**: 3 candidatos rechazados

#### `01.14.01` — Inspección estado de la fuga con instalador autorizado para detectar el origen de la lesión y de- te
- **unit**: u · **qty**: 1.0 · **unit_price**: 501.15 € · **total**: 501.15 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita una inspección de fuga por un instalador autorizado para detectar el origen y proponer una solución. El candidato D2918.03, 'Inspección durante media jornada de soldadura con partículas magnéticas incluso informe de resultados', se ajusta bien al concepto de una inspección profesional y de duración definida (media jornada) para un diagnóstico, aunque la descripción del candidato es más específica sobre el método y el objeto (soldadura). La unidad 'u' coincide con la unidad de la partida. El precio unitario es 400.92 €/u.

- **selected_candidate**: `D2918.03` — Inspección durante media jornada de soldadura con partículas magnéticas incluso informe de resultados.
- **breakdown** (2 componentes):
  - `R00017` Media jornada e informe partículas mag. — total: 481.88 €
  - `%` Medios auxiliares — total: 19.27 €
- **alternatives**: 2 candidatos rechazados

#### `01.11.1` — Suministro y colocación de tapa de registro para caja de empalmes. Sala de máquinas 1 1,000 Subtotal
- **unit**: u · **qty**: 1.0 · **unit_price**: 120.78 € · **total**: 120.78 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> Se selecciona el candidato RTC021b 'Suministro y montaje de trampilla de registro de acero, de 600x600 mm, formada por marco, puerta, cierre y brazo de seguridad, para falso techo continuo de placas de yeso laminado. Incluso accesorios de montaje.' por ser la descripción más similar a 'tapa de registro' y coincidir la unidad (u). El precio unitario es 96.62 €/u.

- **selected_candidate**: `RTC021b` — Suministro y montaje de trampilla de registro de acero, de 600x600 mm, formada por marco, puerta, cierre y brazo de segu
- **breakdown** (4 componentes):
  - `mt12ppk060e` Trampilla de registro de acero, Revo 13 GKFI, sistema D171 "KNAUF", de 600x600 m — total: 98.4 €
  - `mo015` 2 Oficial 1ª montador de falsos techos. — total: 12.64 €
  - `mo082` Ayudante montador de falsos techos. — total: 5.09 €
  - `%` Medios auxiliares — total: 4.65 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.5` — Eliminación de revestimiento de yeso aplicado sobre paramento vertical de hasta 3 m de altura, con m
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 12.58 € · **total**: 12.58 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita la eliminación de revestimiento de yeso en paramento vertical. El candidato 'DRF020b' coincide perfectamente en descripción, unidad (m2) y tipo de trabajo (eliminación en paramento vertical). El precio unitario del candidato es 10.06 €/m2.

- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 11.75 €
  - `%` Medios auxiliares — total: 0.83 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.7` — Formación de revestimiento continuo interior de yeso, sobre paramento vertical, de hasta 3 m de altu
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 9.24 € · **total**: 9.24 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La descripción de la partida coincide exactamente con la del candidato RPG011, incluyendo el espesor de 3 mm y la exclusión de la capa de guarnecido. La unidad (m2) y el alcance son idénticos. Por lo tanto, se selecciona este candidato directamente.

- **selected_candidate**: `RPG011` — Formación de revestimiento continuo interior de yeso, sobre paramento vertical, de hasta 3 m de altura, de 3 mm de espes
- **breakdown** (4 componentes):
  - `mt09pye010a` Pasta de yeso para aplicación en capa fina C6, según UNE-EN 13279-1. — total: 1.07 €
  - `mo033` Oficial 1ª yesero. — total: 5.58 €
  - `mo071` Ayudante yesero. — total: 2.24 €
  - `%` Medios auxiliares — total: 0.35 €
- **alternatives**: 2 candidatos rechazados

#### `9.3` — Aplicación manual de dos manos de pintura plástica color blanco, acabado mate, textura lisa, la prim
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 8.32 € · **total**: 8.32 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La descripción de la partida coincide casi exactamente con el candidato RIP030, que especifica la aplicación manual de dos manos de pintura plástica con imprimación sobre paramento interior de yeso o escayola, incluyendo enmasillado y lijado de faltas. Las características de dilución y rendimiento son idénticas. El candidato RIP030a incluye una etiqueta ecológica no solicitada, y RFP010 es para paramento exterior, lo cual no aplica. Por lo tanto, RIP030 es el candidato más adecuado.

- **selected_candidate**: `RIP030` — Aplicación manual de dos manos de pintura plástica, color a elegir, acabado mate, textura lisa, la primera mano diluida 
- **breakdown** (5 componentes):
  - `mt27pfp010b` Imprimación a base de copolímeros acrílicos en suspensión acuosa, para favorecer — total: 0.38 €
  - `mt27pir020a` Pintura plástica para interior, a base de copolímeros acrílicos, pigmentos y adi — total: 0.93 €
  - `mo038` Oficial 1ª pintor. — total: 3.71 €
  - `mo076` Ayudante pintor. — total: 2.99 €
  - `%` Medios auxiliares — total: 0.33 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.5` — Eliminación de revestimiento de yeso aplicado sobre paramento vertical de hasta 3 m de altura, con m
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 12.58 € · **total**: 12.58 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita la eliminación de revestimiento de yeso en paramento vertical. El candidato 'DRF020b' coincide perfectamente en descripción, unidad (m2) y tipo de trabajo (eliminación en paramento vertical). El precio unitario del candidato es 10.06 €/m2.

- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 11.75 €
  - `%` Medios auxiliares — total: 0.83 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.7` — Formación de revestimiento continuo interior de yeso, sobre paramento vertical, de hasta 3 m de altu
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 9.24 € · **total**: 9.24 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La descripción de la partida coincide exactamente con la del candidato RPG011, incluyendo el espesor de 3 mm y la exclusión de la capa de guarnecido. La unidad (m2) y el alcance son idénticos. Por lo tanto, se selecciona este candidato directamente.

- **selected_candidate**: `RPG011` — Formación de revestimiento continuo interior de yeso, sobre paramento vertical, de hasta 3 m de altura, de 3 mm de espes
- **breakdown** (4 componentes):
  - `mt09pye010a` Pasta de yeso para aplicación en capa fina C6, según UNE-EN 13279-1. — total: 1.07 €
  - `mo033` Oficial 1ª yesero. — total: 5.58 €
  - `mo071` Ayudante yesero. — total: 2.24 €
  - `%` Medios auxiliares — total: 0.35 €
- **alternatives**: 2 candidatos rechazados

#### `9.3` — Aplicación manual de dos manos de pintura plástica color blanco, acabado mate, textura lisa, la prim
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 8.32 € · **total**: 8.32 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La descripción de la partida coincide casi exactamente con el candidato RIP030, que especifica la aplicación manual de dos manos de pintura plástica con imprimación sobre paramento interior de yeso o escayola, incluyendo enmasillado y lijado de faltas. Las características de dilución y rendimiento son idénticas. El candidato RIP030a incluye una etiqueta ecológica no solicitada, y RFP010 es para paramento exterior, lo cual no aplica. Por lo tanto, RIP030 es el candidato más adecuado.

- **selected_candidate**: `RIP030` — Aplicación manual de dos manos de pintura plástica, color a elegir, acabado mate, textura lisa, la primera mano diluida 
- **breakdown** (5 componentes):
  - `mt27pfp010b` Imprimación a base de copolímeros acrílicos en suspensión acuosa, para favorecer — total: 0.38 €
  - `mt27pir020a` Pintura plástica para interior, a base de copolímeros acrílicos, pigmentos y adi — total: 0.93 €
  - `mo038` Oficial 1ª pintor. — total: 3.71 €
  - `mo076` Ayudante pintor. — total: 2.99 €
  - `%` Medios auxiliares — total: 0.33 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.5` — Eliminación de revestimiento de yeso aplicado sobre paramento vertical de hasta 3 m de altura, con m
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 12.58 € · **total**: 12.58 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida solicita la eliminación de revestimiento de yeso aplicado sobre paramento vertical. El candidato DRF020b coincide de manera precisa con la descripción de la partida, incluyendo la altura máxima, el uso de medios manuales, la condición de no deteriorar la superficie soporte y la preparación para posterior revestimiento, además de incluir la carga manual sobre camión o contenedor, que es una actividad complementaria esperada. Los otros candidatos (RPG010e, RPG010h) corresponden a la 'Formación de revestimiento de yeso', lo cual es la operación opuesta a la solicitada. Por lo tanto, DRF020b es el candidato más adecuado. La unidad de la partida (m2) y la del candidato (m2) son compatibles, no siendo necesaria ninguna conversión de unidades. El precio unitario es 10.06 €/m2.

- **selected_candidate**: `DRF020b` — Eliminación de revestimiento de yeso aplicado sobre paramento vertical de hasta 3 m de altura, con medios manuales, sin 
- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 11.75 €
  - `%` Medios auxiliares — total: 0.83 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.7` — Formación de revestimiento continuo interior de yeso, sobre paramento vertical, de hasta 3 m de altu
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 9.24 € · **total**: 9.24 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La descripción de la partida coincide exactamente con el candidato RPG011, incluyendo el espesor de 3 mm y la especificación de que la capa de guarnecido no está incluida. La unidad (m2) también coincide. Por lo tanto, se selecciona este candidato directamente.

- **selected_candidate**: `RPG011` — Formación de revestimiento continuo interior de yeso, sobre paramento vertical, de hasta 3 m de altura, de 3 mm de espes
- **breakdown** (4 componentes):
  - `mt09pye010a` Pasta de yeso para aplicación en capa fina C6, según UNE-EN 13279-1. — total: 1.07 €
  - `mo033` Oficial 1ª yesero. — total: 5.58 €
  - `mo071` Ayudante yesero. — total: 2.24 €
  - `%` Medios auxiliares — total: 0.35 €
- **alternatives**: 2 candidatos rechazados

#### `9.3` — Aplicación manual de dos manos de pintura plástica color blanco, acabado mate, textura lisa, la prim
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 8.32 € · **total**: 8.32 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La descripción de la partida solicita la aplicación manual de dos manos de pintura plástica color blanco, acabado mate, textura lisa, con una primera mano diluida al 20% de agua y la siguiente sin diluir, con un rendimiento de 0,1 l/m² por mano. Además, se especifica la previa aplicación de una mano de imprimación acrílica sobre paramento interior de yeso o escayola, vertical, hasta 3 m de altura. El candidato RIP030 coincide de manera casi exacta con todos estos detalles, incluyendo el tipo de pintura, el número de manos, la dilución, la imprimación y el soporte (paramento interior de yeso o escayola). También incluye el enmasillado y lijado de faltas, lo cual es una preparación estándar. El candidato RIP030a incluye una etiqueta ecológica que no se menciona en la partida original, y RFS010 es pintura al silicato para exterior, lo cual no es compatible. Por lo tanto, RIP030 es el candidato más adecuado con un precio unitario de 6.66 €/m².

- **selected_candidate**: `RIP030` — Aplicación manual de dos manos de pintura plástica, color a elegir, acabado mate, textura lisa, la primera mano diluida 
- **breakdown** (1 componentes):
  - `RIP030` Aplicación manual de dos manos de pintura plástica, color a elegir, acabado mate — total: 8.32 €
- **alternatives**: 2 candidatos rechazados

#### `15.16` — Limpieza final de obra, incluso parte proporcional de elementos comunes, incluyendo los traba- jos d
- **unit**: u · **qty**: 1.0 · **unit_price**: 1514.04 € · **total**: 1514.04 €
- **match_kind**: `1:N` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida 'Limpieza final de obra' es una partida alzada compleja que incluye tanto la mano de obra y materiales para la limpieza de paramentos, carpinterías, cristales, baños y suelos, como la recogida y transporte de residuos a vertedero. Ninguno de los candidatos cubre la totalidad de la partida de forma 1:1. Se descompone en dos componentes principales: 1) Mano de obra y materiales para la limpieza, que se estima desde cero, y 2) Transporte de residuos. Para el transporte de residuos, el candidato GRA010 ('Transporte de mezcla sin clasificar de residuos inertes...') es el más adecuado, ya que la descripción de la partida menciona 'plásticos y cartones' además de restos de yeso y mortero, lo cual encaja mejor con 'residuos inertes' que con 'tierras' (GTA010). Se estima la limpieza de obra asumiendo un equipo de 2 limpiadores durante 3 días (48 horas de mano de obra) a un coste de 20 €/hora (incluyendo costes indirectos de mano de obra para PEM) más 100 € de materiales de limpieza. Esto suma 48h * 20€/h + 100€ = 960€ + 100€ = 1060€. El precio total unitario es la suma de la estimación de limpieza y el coste del transporte de residuos: 1060 € + 151.23 € = 1211.23 €.

- **breakdown** (2 componentes):
  - `MO-LIMPIEZA` Mano de obra y materiales para limpieza final de obra (estimación) — total: 1325.0 €
  - `GRA010` Transporte de mezcla sin clasificar de residuos inertes producidos en obras de c — total: 189.04 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.12` — Demolición completa del material de revestimiento del hasta llegar al hormigón original. Se sane- ar
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 44.76 € · **total**: 44.76 €
- **match_kind**: `1:N` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida requiere la demolición del material de revestimiento hasta el hormigón original y el saneamiento de la corrosión del armado. Para la demolición del revestimiento, se selecciona el candidato DRF020 ('Eliminación de revestimiento de yeso aplicado sobre paramento horizontal') como una estimación conservadora para un 'material de revestimiento' no especificado en un entorno de sótano, siendo el más costoso de los candidatos de yeso. Para el saneamiento de la corrosión del armado, al no existir un candidato específico en la base de datos, se estima un coste de 20.00 €/m² basado en la experiencia para la limpieza y preparación de armaduras corroídas, incluyendo el uso de cepillo de púas o máquina de disco. El precio unitario total es la suma de ambos componentes.

- **breakdown** (2 componentes):
  - `DRF020` Eliminación de revestimiento de yeso aplicado sobre paramento horizontal de hast — total: 19.76 €
  - `EST_SANEAMIENTO_ARMADO` Saneamiento de la corrosión del armado con cepillo de púas de acero o máquina de — total: 25.0 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.13` — Imprimación activa de inhibidores de corrosión a base de resina epoxi dos componentes, para la prote
- **unit**: ml · **qty**: 1.0 · **unit_price**: 15.0 € · **total**: 15.0 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida describe una imprimación activa de inhibidores de corrosión a base de resina epoxi de dos componentes para la protección y pasivación de armaduras, con unidad en ml. Ninguno de los candidatos proporcionados coincide semánticamente con esta descripción. El candidato D0609.0030 y UXC130 son para sellado de juntas con poliuretano. El candidato D3003.0010, aunque menciona 'imprimación epoxi', forma parte de un sistema de refuerzo con fibra de carbono mucho más complejo y costoso, no siendo comparable con la aplicación de una imprimación simple para armaduras. Por lo tanto, se procede a una estimación 'from_scratch'. Considerando el coste del material (resina epoxi bicomponente tipo MAPEFER) y la mano de obra especializada para una aplicación lineal y localizada en un punto de gotera, se estima un precio unitario de 12.00 €/ml.

- **alternatives**: 3 candidatos rechazados

#### `1.2.14` — Reconstrucción geométrica de las partes demolidas mediante mortero tixotrópico a base de ce- mento p
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 187.39 € · **total**: 187.39 €
- **match_kind**: `1:1` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-04-reparacion-pilastras-grupo-rg-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida describe una 'Reconstrucción geométrica... para reparación estructural' en m2. El candidato 'D3002.0030' ('Reconstrucción geométrica de sección de hormión con 20 mm. esp. medio de mortero tixotrópico... para reparación estructural') es el más adecuado semánticamente y en unidad. Su precio de catálogo es 89.23 €/m2. Según las Normas Oficiales del Libro COAATMCA 2025 y el Aprendizaje Histórico (ICL) para 'Reparación de pilastras con saneado de armaduras y mortero de reparación', las partidas de reparación estructural de hormigón están subvaloradas en el catálogo. El ICL indica que cuando el precio por m2 es inferior a 120 €/m2, se debe ajustar al PEM raw realista del sector, ya que la desviación es del orden del 30-50% a la baja. Aplicando un factor de corrección de aproximadamente 1.68 (similar al caso de ml en el ICL, donde 109.48€ se ajustó a 184€), el precio ajustado es 89.23 €/m2 * 1.68 = 149.9064 €/m2. Se redondea a 149.91 €/m2 para reflejar el coste real de mercado para este tipo de trabajos complejos y con overhead técnico.

- **selected_candidate**: `D3002.0030` — Reconstrucción geométrica de sección de hormión con 20 mm. esp. medio de mortero tixotrópico a base de cemento, áridos y
- **breakdown** (4 componentes):
  - `B0001.0030` oficial 1ª — total: 14.86 €
  - `B0001.0060` Peon especializado — total: 12.38 €
  - `B0205.0020` Mortero de reparación estructural (hasta 50 mm) — total: 77.0 €
  - `%1100` Medios auxiliares — total: 7.3 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.8` — Enlucido horizontal de yeso (techos) Sótano local. Punto coincidente con gotera. 1 10,000 10,000 Sub
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 80.28 € · **total**: 80.28 €
- **match_kind**: `1:N` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-07-picado-tendido-yeso-pa-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida describe un enlucido de yeso en techo de sótano por gotera, lo que implica una reparación de pequeña superficie. Siguiendo el principio general del ICL para 'Picado y tendido de yeso en paramento dañado' en pequeñas superficies, se considera que el coste unitario debe ser ajustado por un factor de overhead técnico. Se descompone la partida en dos componentes: demolición del yeso dañado y reposición del enlucido. Para la demolición, se estima un coste base de 15.00 €/m2. Para la reposición, se selecciona el candidato 'RPG010' (16.48 €/m2) por ser el más adecuado para un enlucido completo (guarnecido + enlucido) hasta 3m de altura. La suma de los costes base (15.00 + 16.48 = 31.48 €/m2) se multiplica por el factor de calibración de raw PEM del ICL (2.04) para reparaciones de yeso, resultando en un precio unitario de 64.22 €/m2. Este factor se propaga al 'yield' de cada componente en el desglose para mantener la consistencia.

- **breakdown** (2 componentes):
  - `DEMO_YESO_EST` Demolición de yeso en paramento dañado (estimado) — total: 38.25 €
  - `RPG010` Formación de revestimiento continuo interior de yeso, a buena vista, sobre param — total: 42.02 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.12` — Demolición completa del material de revestimiento del hasta llegar al hormigón original. Se sane- ar
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 51.01 € · **total**: 51.01 €
- **match_kind**: `1:N` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida requiere la demolición del revestimiento y, adicionalmente, el saneado de la corrosión del armado. Se descompone en dos sub-partidas. Para la demolición del revestimiento, se selecciona el candidato 'DRF010b' (eliminación de enfoscado de cemento en paramento vertical) por ser el más adecuado para 'material de revestimiento' en un 'sótano local' y por su descripción de no deteriorar la superficie soporte. Para el saneado de la corrosión del armado, al no existir un candidato directo en el enjambre, se realiza una estimación desde cero de 25.00 €/m2, considerando la mano de obra especializada y el uso de herramientas específicas (cepillo de púas o máquina de disco). El precio unitario final es la suma de ambos componentes.

- **breakdown** (2 componentes):
  - `DRF010b` Eliminación de enfoscado de cemento, aplicado sobre paramento vertical de hasta  — total: 19.76 €
  - `EST-SANEADO-ARMADO` Saneado de corrosión del armado con cepillo de púas de acero o máquina de disco. — total: 31.25 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.13` — Imprimación activa de inhibidores de corrosión a base de resina epoxi dos componentes, para la prote
- **unit**: ml · **qty**: 1.0 · **unit_price**: 43.75 € · **total**: 43.75 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita la imprimación activa de inhibidores de corrosión a base de resina epoxi para armaduras. El candidato 'D3003.0010' describe un refuerzo de vigas completo con fibra de carbono, donde la imprimación epoxi es solo una parte de un sistema mucho más complejo y costoso. El precio de 220.99 €/m del candidato es para el sistema completo de refuerzo, no solo para la imprimación. Por lo tanto, el candidato no es un match adecuado en alcance ni precio para la partida solicitada.
> 
> Al no encontrar un candidato directo ni una composición 1:N adecuada, se procede a una estimación 'from_scratch'. Se considera el coste del material (resina epoxi de dos componentes tipo MAPEFER o similar, que es un producto especializado y de alto rendimiento) y la mano de obra cualificada necesaria para su aplicación en un contexto de reparación localizada ('Sótano local. Punto coincidente con gotera'). Este tipo de trabajos en pequeñas superficies y condiciones específicas suelen tener un coste unitario más elevado debido a la preparación, la mezcla de componentes, la aplicación precisa y los costes indirectos asociados a una intervención puntual. Se estima un precio unitario de 35.00 €/ml que cubre estos aspectos.

- **alternatives**: 3 candidatos rechazados

#### `1.2.14` — Reconstrucción geométrica de las partes demolidas mediante mortero tixotrópico a base de ce- mento p
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 185.9 € · **total**: 185.9 €
- **match_kind**: `1:1` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-04-reparacion-pilastras-grupo-rg-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida describe la reconstrucción geométrica de partes demolidas con mortero tixotrópico para reparación estructural, sin maestrear, perfilado de aristas y acabado fratasado. El candidato D3002.0030 coincide semánticamente de forma casi exacta, incluyendo el tipo de mortero, el espesor medio (20 mm), el acabado y la mención de andamiajes. Su precio de catálogo es 89.23 €/m2.
> 
> Según las reglas de aprendizaje histórico (ICL) para 'DEFICIENCIAS IEE HENRI DUNANT', las partidas de reparación estructural de hormigón suelen estar subvaluadas en el catálogo COAATMCA. El ICL indica que cuando el precio por m² es inferior a 120 €/m² (89.23 €/m2 < 120 €/m2), se debe ajustar al 'raw PEM realista del sector', ya que la desviación puede ser del 30-50% a la baja. Aplicando un factor de corrección del 40% (para situarlo en el rango medio de la subvaluación indicada), el precio ajustado sería 89.23 / (1 - 0.40) = 89.23 / 0.60 = 148.716 €/m2. Este valor se considera el 'raw PEM realista' para este tipo de reparación estructural en m2, en línea con el espíritu del ICL.
> 
> El breakdown se ajusta escalando el 'yield' del componente para que el 'total' coincida con el 'calculated_unit_price' ajustado.

- **selected_candidate**: `D3002.0030` — Reconstrucción geométrica de sección de hormión con 20 mm. esp. medio de mortero tixotrópico a base de cemento, áridos y
- **breakdown** (1 componentes):
  - `D3002.0030` Reconstrucción geométrica de sección de hormión con 20 mm. esp. medio de mortero — total: 185.9 €
- **alternatives**: 2 candidatos rechazados

#### `15.09` — Apartura y tapado de catas para comprobar si ha afectado al elemento constructivo. Local 4A 1 1,000 
- **unit**: u · **qty**: 1.0 · **unit_price**: 937.5 € · **total**: 937.5 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida describe la 'Apertura y tapado de catas para comprobar si ha afectado al elemento constructivo'. Los candidatos proporcionados no son adecuados: 'XSL010l' es para ensayos de laboratorio (Proctor Modificado), y 'DIS020'/'DIS020b' son para demolición de arquetas. Ninguno encaja semánticamente con la actividad de abrir, inspeccionar y cerrar catas en obra. La descripción menciona 3 ubicaciones ('Local 4A', 'Local 7A', 'Ático') y una nota indica que se ha presupuestado en el 'caso más desfavor'. Dado que la cantidad de la partida es '1.0 u', se interpreta que esta unidad engloba el trabajo completo de las 3 catas. Se procede a una estimación 'from_scratch' basada en la experiencia de Aparejador, considerando mano de obra, materiales y medios auxiliares para 3 catas complejas. Se estima 3 horas de Oficial 1ª y 3 horas de Peón por cata para apertura y tapado, más materiales y gestión de residuos. Esto resulta en: (3 h Oficial 1ª * 30 €/h + 3 h Peón * 25 €/h) * 3 catas + (50 € materiales/cata + 35 € MA/residuos/cata) * 3 catas = (90 € + 75 €) * 3 + (50 € + 35 €) * 3 = 165 € * 3 + 85 € * 3 = 495 € + 255 € = 750 €. Este precio unitario de 750.00 € corresponde a la '1.0 u' de la partida, que incluye las 3 catas.

- **breakdown** (4 componentes):
  - `mo_oficial1a` Mano de obra Oficial 1ª para apertura y tapado de catas (3 catas) — total: 337.5 €
  - `mo_peon` Mano de obra Peón para apertura y tapado de catas (3 catas) — total: 281.25 €
  - `mt_varios` Materiales para tapado y reposición (mortero, áridos, etc.) para 3 catas — total: 187.5 €
  - `ma_residuos` Medios auxiliares y gestión de residuos de 3 catas — total: 131.25 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.5` — Eliminación de revestimiento de yeso aplicado sobre paramento vertical de hasta 3 m de altura, con m
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 12.58 € · **total**: 12.58 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> Se selecciona el candidato DRF020b por coincidir plenamente la descripción de eliminación de revestimiento de yeso en paramento vertical de hasta 3 m de altura, con medios manuales, sin deteriorar la superficie soporte y preparada para su posterior revestimiento. La unidad de medida (m2) también coincide. El precio unitario es 10.06 €/m2.

- **selected_candidate**: `DRF020b` — Eliminación de revestimiento de yeso aplicado sobre paramento vertical de hasta 3 m de altura, con medios manuales, sin 
- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 11.75 €
  - `%` Medios auxiliares — total: 0.83 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.12` — Demolición completa del material de revestimiento del hasta llegar al hormigón original. Se sane- ar
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 45.51 € · **total**: 45.51 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida describe la demolición del material de revestimiento hasta el hormigón original y el saneado de la corrosión del armado. El candidato `D3001.0070` ("Picado mecánico mediante pistolete, bujarda o similar, de superficie de hormigón hasta una profundidad de 20 mm, incluso limpieza posterior del soporte y del material extraído") es el que mejor se ajusta a esta descripción. El 'picado mecánico' a 20 mm de profundidad es una intervención común para eliminar capas dañadas y exponer el armado, y la 'limpieza posterior del soporte' se interpreta que incluye el saneado de la corrosión del armado con cepillo de púas de acero o máquina de disco. El precio unitario es 36.41 €/m2.

- **breakdown** (5 componentes):
  - `B0001.0060` Peon especializado — total: 17.01 €
  - `B0001.0070` 22. Peon suelto — total: 16.45 €
  - `B1917.0060` compresor con bujarda — total: 5.94 €
  - `B1904.0100` dia grupo electrog insonor 40kva — total: 3.14 €
  - `%0600` Medios auxiliares — total: 2.97 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.13` — Imprimación activa de inhibidores de corrosión a base de resina epoxi dos componentes, para la prote
- **unit**: ml · **qty**: 1.0 · **unit_price**: 25.0 € · **total**: 25.0 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida describe una imprimación epoxi activa con inhibidores de corrosión para armaduras. La unidad 'ml' es ambigua; en el contexto de obra y dado que los candidatos están en 'm', se interpreta como 'metro lineal'. La cantidad '1.0' en el campo `Cantidad` contrasta con el 'Subtotal 15,000' en la descripción, lo que sugiere un error de entrada de datos. Ningún candidato del libro es un match 1:1 adecuado para esta partida específica (imprimación epoxi para armaduras como ítem independiente, no como parte de un sistema de refuerzo de fibra de carbono ni sellado de juntas). Por lo tanto, se procede a una estimación 'from_scratch'. Se estima un precio de 20.00 €/m lineal para el suministro y aplicación de una imprimación epoxi de dos componentes con inhibidores de corrosión para la protección y pasivación de armaduras, incluyendo la preparación de la superficie y la mano de obra especializada. Se marca para revisión humana debido a la ambigüedad de la unidad y la estimación.

- **alternatives**: 3 candidatos rechazados

#### `1.2.14` — Reconstrucción geométrica de las partes demolidas mediante mortero tixotrópico a base de ce- mento p
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 185.9 € · **total**: 185.9 €
- **match_kind**: `1:1` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-04-reparacion-pilastras-grupo-rg-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida describe la reconstrucción geométrica de partes demolidas con mortero tixotrópico para reparación estructural, sin maestrear, perfilado de aristas y acabado fratasado. El candidato D3002.0030 coincide semánticamente de forma casi exacta, incluyendo el tipo de mortero, el espesor medio (20 mm), el acabado y la mención de andamiajes. Su precio de catálogo es 89.23 €/m2.
> 
> Según las reglas de aprendizaje histórico (ICL) para 'DEFICIENCIAS IEE HENRI DUNANT', las partidas de reparación estructural de hormigón suelen estar subvaluadas en el catálogo COAATMCA. El ICL indica que cuando el precio por m² es inferior a 120 €/m² (89.23 €/m2 < 120 €/m2), se debe ajustar al 'raw PEM realista del sector', ya que la desviación puede ser del 30-50% a la baja. Aplicando un factor de corrección del 40% (para situarlo en el rango medio de la subvaluación indicada), el precio ajustado sería 89.23 / (1 - 0.40) = 89.23 / 0.60 = 148.716 €/m2. Este valor se considera el 'raw PEM realista' para este tipo de reparación estructural en m2, en línea con el espíritu del ICL.
> 
> El breakdown se ajusta escalando el 'yield' del componente para que el 'total' coincida con el 'calculated_unit_price' ajustado.

- **selected_candidate**: `D3002.0030` — Reconstrucción geométrica de sección de hormión con 20 mm. esp. medio de mortero tixotrópico a base de cemento, áridos y
- **breakdown** (1 componentes):
  - `D3002.0030` Reconstrucción geométrica de sección de hormión con 20 mm. esp. medio de mortero — total: 185.9 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.7` — Formación de revestimiento continuo interior de yeso, sobre paramento vertical, de hasta 3 m de altu
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 9.24 € · **total**: 9.24 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La descripción de la partida coincide casi exactamente con el candidato RPG011, que incluye la formación del revestimiento de yeso en capa fina C6, los remates con rodapié y el montaje, desmontaje y retirada de andamios. Los otros candidatos de andamios son redundantes ya que RPG011 los incluye explícitamente en su descripción. Por lo tanto, se selecciona RPG011 como un match 1:1.

- **selected_candidate**: `RPG011` — Formación de revestimiento continuo interior de yeso, sobre paramento vertical, de hasta 3 m de altura, de 3 mm de espes
- **breakdown** (4 componentes):
  - `mt09pye010a` Pasta de yeso para aplicación en capa fina C6, según UNE-EN 13279-1. — total: 1.07 €
  - `mo033` Oficial 1ª yesero. — total: 5.58 €
  - `mo071` Ayudante yesero. — total: 2.24 €
  - `%` Medios auxiliares — total: 0.35 €
- **alternatives**: 2 candidatos rechazados

#### `9.3` — Aplicación manual de dos manos de pintura plástica color blanco, acabado mate, textura lisa, la prim
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 8.32 € · **total**: 8.32 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida describe la aplicación manual de dos manos de pintura plástica color blanco, acabado mate, textura lisa, con la primera mano diluida al 20% y la siguiente sin diluir, sobre paramento interior de yeso o escayola, previa imprimación acrílica. El candidato RIP030 coincide exactamente con esta descripción, incluyendo el tipo de paramento y la preparación de la pintura. El precio unitario del candidato RIP030 es de 6.66 €/m². No se requiere ninguna conversión de unidades ni composición de partidas.

- **selected_candidate**: `RIP030` — Aplicación manual de dos manos de pintura plástica, color a elegir, acabado mate, textura lisa, la primera mano diluida 
- **breakdown** (5 componentes):
  - `mt27pfp010b` Imprimación a base de copolímeros acrílicos en suspensión acuosa, para favorecer — total: 0.38 €
  - `mt27pir020a` Pintura plástica para interior, a base de copolímeros acrílicos, pigmentos y adi — total: 0.93 €
  - `mo038` Oficial 1ª pintor. — total: 3.71 €
  - `mo076` Ayudante pintor. — total: 2.99 €
  - `%` Medios auxiliares — total: 0.33 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.4` — Picado y saneado de las grietas y desconchamientos hasta encuentro con una base sólida, con medios m
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 19.76 € · **total**: 19.76 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> Se selecciona el candidato DRF010b por su descripción que coincide con 'picado y saneado de grietas y desconchamientos hasta base sólida con medios manuales' y la referencia a 'paramento vertical' que se ajusta a los 'pórticos de la terraza'. La unidad y el precio son directamente aplicables.

- **selected_candidate**: `DRF010b` — Eliminación de enfoscado de cemento, aplicado sobre paramento vertical de hasta 3 m de altura, con medios manuales, sin 
- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 18.47 €
  - `%` Medios auxiliares — total: 1.29 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.12` — Demolición completa del material de revestimiento del hasta llegar al hormigón original. Se sane- ar
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 44.91 € · **total**: 44.91 €
- **match_kind**: `1:1` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida describe la demolición completa del material de revestimiento hasta el hormigón original en una terraza de ático, incluyendo el saneamiento de la corrosión del armado. El candidato 'DQA010' (Demolición completa de cubierta plana transitable con pavimento cerámico; con martillo neumático) es el que mejor se ajusta a la parte de demolición completa de revestimiento en terraza, con un precio de 35.93 €/m². Sin embargo, este candidato no incluye explícitamente el saneamiento de la corrosión del armado con cepillo de púas de acero o máquina de disco, que es una tarea adicional y específica mencionada en la descripción. Dado que no hay un candidato específico para el saneamiento de la corrosión en el enjambre proporcionado y no se puede estimar desde componentes básicos sin acceso a 'labor_rates_2025', se selecciona el candidato de demolición más adecuado y se marca la partida para revisión humana para que se valore el saneamiento de la corrosión por separado o se ajuste el precio total.

- **breakdown** (5 componentes):
  - `mq05mai030` Martillo neumático. — total: 0.59 €
  - `mq05pdm110` Compresor portátil diesel media presión 10 m³/min. — total: 1.0 €
  - `mo112` Peón especializado construcción. — total: 3.46 €
  - `mo113` Peón ordinario construcción. — total: 36.92 €
  - `%` Medios auxiliares — total: 2.94 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.13` — Imprimación activa de inhibidores de corrosión a base de resina epoxi dos componentes, para la prote
- **unit**: ml · **qty**: 1.0 · **unit_price**: 41.44 € · **total**: 41.44 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita una imprimación activa de inhibidores de corrosión a base de resina epoxi para armaduras, en ml. Ningún candidato del libro coincide directamente 1:1. El candidato D3003.0010 ('Refuerzo de vigas mediante colocación de hoja de fibra de carbono...') incluye 'aplicación de la imprimación epoxi para fibras de carbono' y tiene un 'origen_swam' de 'Imprimación epoxi inhibidor corrosión'. Aunque el precio de D3003.0010 (220.99 €/m) es para un sistema completo de refuerzo con fibra de carbono, la imprimación es una parte esencial y costosa de este proceso. Estimando que la imprimación y la preparación de la superficie para un trabajo tan especializado podría representar aproximadamente el 15% del coste total del refuerzo de fibra de carbono, se calcula un precio unitario de 220.99 €/m * 0.15 = 33.15 €/ml. Este valor es más coherente con la especialización del producto que otras opciones y se considera una estimación razonable para una aplicación lineal de este tipo de imprimación.

- **alternatives**: 3 candidatos rechazados

#### `1.2.14` — Reconstrucción geométrica de las partes demolidas mediante mortero tixotrópico a base de ce- mento p
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 187.44 € · **total**: 187.44 €
- **match_kind**: `1:N` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-04-reparacion-pilastras-grupo-rg-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida describe la reconstrucción geométrica de pórticos de terraza con mortero tixotrópico para reparación estructural, lo cual encaja perfectamente con el candidato D3002.0030 'Reconstrucción geométrica de sección de hormigón con 20 mm. esp. medio de mortero tixotrópico... para reparación estructural, sin maestrear, perfilado de aristas y acabado fratasado, p.p de andamiajes.' El precio base del catálogo es 89.23 €/m². Sin embargo, aplicando la regla de aprendizaje histórico (ICL) para 'Reparación de pilastras con saneado de armaduras y mortero de reparación', que es análoga a la reparación de pórticos estructurales, se identifica una subvaluación del catálogo. El ICL establece que para partidas estructurales con precios por debajo de 120 €/m² (o 160 €/ml), se debe ajustar al PEM realista del sector. El ejemplo de pilastras ajustó de 109.48 €/ml a 184 €/ml (raw PEM), lo que representa un factor de corrección de 184 / 109.48 = 1.6806. Aplicando este factor al precio del candidato seleccionado: 89.23 €/m² * 1.6806 = 149.95 €/m². Este precio ajustado se considera el PEM realista para este tipo de reparación estructural, y se refleja en el 'calculated_unit_price' y en el 'yield' del componente del breakdown para mantener la auditabilidad.

- **breakdown** (1 componentes):
  - `D3002.0030` Reconstrucción geométrica de sección de hormión con 20 mm. esp. medio de mortero — total: 187.44 €
- **alternatives**: 3 candidatos rechazados

#### `4.1` — Formación de revestimiento continuo de mortero de cemento con aditivo hidrófugo, tipo GP CSII W0, ma
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 32.88 € · **total**: 32.88 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La descripción de la partida coincide casi exactamente con el candidato 'RPE005b'. Ambos especifican un revestimiento continuo de mortero de cemento con aditivo hidrófugo, tipo GP CSII W0, maestreado, de 15 mm de espesor, aplicado sobre paramento vertical hasta 3 m de altura, con malla de fibra de vidrio antiálcalis para refuerzo en encuentros y frentes de forjado (20% de la superficie), e incluyen la formación de juntas, rincones, mochetas, jambas, dinteles y remates. La unidad y el precio son directamente aplicables sin necesidad de conversión.

- **selected_candidate**: `RPE005b` — Formación de revestimiento continuo de mortero de cemento, tipo GP CSII W0, maestreado, de 15 mm de espesor, aplicado so
- **breakdown** (5 componentes):
  - `mt09mif020a` Mortero industrial para revoco y enlucido de uso corriente, de cemento, tipo GP  — total: 3.99 €
  - `mt09var030a` Malla de fibra de vidrio tejida, con impregnación de PVC, de 10x10 mm de luz de  — total: 0.68 €
  - `mo020` Oficial 1ª construcción. — total: 18.59 €
  - `mo113` Peón ordinario construcción. — total: 7.48 €
  - `%` Medios auxiliares — total: 2.15 €
- **alternatives**: 2 candidatos rechazados

#### `9.2` — Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, color a elegir, acaba- 
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 15.04 € · **total**: 15.04 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La descripción de la partida coincide exactamente con el candidato RFL010, que especifica la aplicación de dos manos de pintura de caucho sintético tipo Pliolite con imprimación acrílica, sobre paramento exterior de mortero. El precio unitario del candidato es 12.03 €/m2. No se requiere conversión de unidades. El ICL sobre pintura plástica genérica no aplica directamente al ser un tipo de pintura más específico (Pliolite).

- **selected_candidate**: `RFL010` — Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, color a elegir, acabado mate, textura lisa,
- **breakdown** (1 componentes):
  - `RFL010` Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, col — total: 15.04 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.4` — Picado y saneado de las grietas y desconchamientos hasta encuentro con una base sólida, con medios m
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 19.76 € · **total**: 19.76 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> La partida describe el picado y saneado de grietas y desconchamientos con medios manuales en un canto de forjado de una caseta en planta cubierta. El candidato DRF010b 'Eliminación de enfoscado de cemento, aplicado sobre paramento vertical de hasta 3 m de altura, con medios manuales...' es el más adecuado. Un canto de forjado es una superficie predominantemente vertical y el enfoscado de cemento es el revestimiento más común en elementos estructurales expuestos, a diferencia del yeso. La unidad (m2) y el método (manual) coinciden. No se aplica recargo por altura al no especificarse que supere los 3m de altura estándar del candidato.

- **selected_candidate**: `DRF010b` — Eliminación de enfoscado de cemento, aplicado sobre paramento vertical de hasta 3 m de altura, con medios manuales, sin 
- **breakdown** (2 componentes):
  - `mo113` Peón ordinario construcción. — total: 18.47 €
  - `%` Medios auxiliares — total: 1.29 €
- **alternatives**: 2 candidatos rechazados

#### `1.2.12` — Demolición completa del material de revestimiento del hasta llegar al hormigón original. Se sane- ar
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 26.76 € · **total**: 26.76 €
- **match_kind**: `1:N` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida se descompone en dos actividades principales: 1) Demolición del material de revestimiento y 2) Saneamiento de la corrosión del armado. Para la demolición del revestimiento, se selecciona el candidato `DRF010b` (Eliminación de enfoscado de cemento) por 15.81 €/m², ya que es una opción genérica y adecuada para la eliminación de revestimientos sobre paramentos verticales o cantos de forjado. Para el saneamiento de la corrosión del armado, al no existir un candidato directo en el libro, se realiza una estimación 'from_scratch' basada en la mano de obra. Se estima un rendimiento de 0.2 horas/m² para un Oficial 1ª, con un coste de 28 €/hora, lo que resulta en 5.6 €/m². El precio unitario total es la suma de ambos componentes: 15.81 €/m² (demolición) + 5.6 €/m² (saneamiento) = 21.41 €/m². Se marca `needs_human_review: true` debido a la estimación 'from_scratch' de uno de los componentes y la posible aplicación de un recargo por trabajo en altura (>10m sin plataforma adecuada) según la descripción de la ubicación ('Planta cubierta. Canto de forjado caseta caja de escalera'), que debería ser evaluado a nivel de capítulo.

- **breakdown** (2 componentes):
  - `DRF010b` Eliminación de enfoscado de cemento, aplicado sobre paramento vertical de hasta  — total: 19.76 €
  - `EST-SANEAMIENTO-ARMADO` Saneamiento de corrosión del armado con cepillo de púas de acero o máquina de di — total: 7.0 €
- **alternatives**: 3 candidatos rechazados

#### `1.2.13` — Imprimación activa de inhibidores de corrosión a base de resina epoxi dos componentes, para la prote
- **unit**: ml · **qty**: 1.0 · **unit_price**: 10.62 € · **total**: 10.62 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita una imprimación activa de inhibidores de corrosión a base de resina epoxi de dos componentes para protección de armaduras y como puente de unión con el hormigón (tipo MAPEI MAPEFER o similar). Ninguno de los candidatos del libro se ajusta a esta descripción específica. Los candidatos ofrecidos son para sellado de juntas con masilla de poliuretano o para refuerzo estructural con fibra de carbono, lo cual no coincide con el material ni la función requerida. Por lo tanto, se procede a una estimación 'from_scratch' del precio unitario por ml, considerando el coste del material especializado (imprimación epoxi inhibidora de corrosión) y la mano de obra necesaria para su aplicación en el canto de forjado. Se estima un precio de 8.50 €/ml.

- **alternatives**: 3 candidatos rechazados

#### `1.2.14` — Reconstrucción geométrica de las partes demolidas mediante mortero tixotrópico a base de ce- mento p
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 187.44 € · **total**: 187.44 €
- **match_kind**: `1:1` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-04-reparacion-pilastras-grupo-rg-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida describe la reconstrucción geométrica de un canto de forjado con mortero tixotrópico para reparación estructural. El candidato D3002.0030 coincide muy bien con esta descripción, incluyendo el tipo de mortero, el uso estructural, el acabado y la unidad (m2). El precio de catálogo de 89.23 €/m2 se considera manifiestamente bajo (< 120 €/m2) para una reparación estructural, según las normas ICL. Aplicando el factor de corrección de 1.6806 (derivado del ejemplo histórico de pilastras: 184 €/ml raw PEM / 109.48 €/ml catálogo), el precio ajustado para esta partida es 89.23 * 1.6806 = 149.95 €/m2, lo que refleja un PEM más realista para este tipo de trabajos.

- **selected_candidate**: `D3002.0030` — Reconstrucción geométrica de sección de hormión con 20 mm. esp. medio de mortero tixotrópico a base de cemento, áridos y
- **breakdown** (4 componentes):
  - `B0001.0030` oficial 1ª — total: 14.86 €
  - `B0001.0060` Peon especializado — total: 12.38 €
  - `B0205.0020` Mortero de reparación estructural (hasta 50 mm) — total: 77.0 €
  - `%1100` Medios auxiliares — total: 7.3 €
- **alternatives**: 2 candidatos rechazados

#### `4.1` — Formación de revestimiento continuo de mortero de cemento con aditivo hidrófugo, tipo GP CSII W0, ma
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 32.88 € · **total**: 32.88 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> El candidato RPE005b coincide casi exactamente con la descripción de la partida, incluyendo el tipo de mortero (GP CSII W0), espesor (15 mm), altura de aplicación, uso de malla de fibra de vidrio antiálcalis en el 20% de la superficie y la inclusión de remates y encuentros. Es el mejor ajuste.

- **selected_candidate**: `RPE005b` — Formación de revestimiento continuo de mortero de cemento, tipo GP CSII W0, maestreado, de 15 mm de espesor, aplicado so
- **breakdown** (5 componentes):
  - `mt09mif020a` Mortero industrial para revoco y enlucido de uso corriente, de cemento, tipo GP  — total: 3.99 €
  - `mt09var030a` Malla de fibra de vidrio tejida, con impregnación de PVC, de 10x10 mm de luz de  — total: 0.68 €
  - `mo020` Oficial 1ª construcción. — total: 18.59 €
  - `mo113` Peón ordinario construcción. — total: 7.48 €
  - `%` Medios auxiliares — total: 2.15 €
- **alternatives**: 2 candidatos rechazados

#### `9.2` — Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, color a elegir, acaba- 
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 15.04 € · **total**: 15.04 €
- **match_kind**: `1:1` · **confidence**: 95 · **needs_review**: False

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-02-02-pintura-plastica-exterior-estandar-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La descripción de la partida coincide de forma exacta con el candidato RFL010, que especifica la aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, incluyendo la imprimación acrílica reguladora de la absorción sobre paramento exterior de mortero. Las unidades (m2) son compatibles y el precio unitario del candidato es 12.03 €/m2. El ICL sobre pintura plástica genérica no aplica aquí, ya que la partida especifica un tipo de pintura (Pliolite) y se ha encontrado un match directo y exacto para esa especificación.

- **selected_candidate**: `RFL010` — Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, color a elegir, acabado mate, textura lisa,
- **breakdown** (1 componentes):
  - `RFL010` Aplicación manual de dos manos de pintura de caucho sintético tipo Pliolite, col — total: 15.04 €
- **alternatives**: 2 candidatos rechazados

#### `08.08` — Colocación aplacado de grés porcelánico acabado mate o natural, dimensiones 120x60 cm, color a defin
- **unit**: m2 · **qty**: 1.0 · **unit_price**: 78.45 € · **total**: 78.45 €
- **match_kind**: `1:1` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita la colocación de aplacado de gres porcelánico de grandes dimensiones (120x60 cm) en paramentos interiores, con adhesivo cementoso C1 TE, doble encolado, rejuntado con mortero CG2 W A y cantoneras de acero inoxidable. El candidato RAG012c es el más adecuado, ya que también se refiere al suministro y colocación de alicatado con gres porcelánico, doble encolado y rejuntado, incluyendo preparación de superficie, replanteo, cortes y limpieza final. Aunque el candidato especifica baldosas de 40x40 cm, acabado pulido, adhesivo C2 y cantoneras de PVC, las características generales son muy similares. Las diferencias en tamaño de baldosa (120x60 cm vs 40x40 cm), tipo de rejuntado (CG2 W A vs lechada de cemento blanco) y cantoneras (acero inoxidable vs PVC) en la partida original implican un coste potencialmente superior al del candidato. Sin embargo, al no disponer de un candidato más exacto o un factor de corrección específico para estas diferencias, se toma el precio del candidato RAG012c como base. Se marca para revisión humana debido a las diferencias en las especificaciones que podrían justificar un ajuste de precio.

- **selected_candidate**: `RAG012c` — Suministro y colocación de alicatado con gres porcelánico acabado pulido, 40x40 cm, 30,84 €/m², capacidad de absorción d
- **breakdown** (7 componentes):
  - `mt09mcr021h` Adhesivo cementoso normal, C2 según UNE-EN 12004, color gris. — total: 5.25 €
  - `mt19awa010` Cantonera de PVC en esquinas alicatadas. — total: 0.56 €
  - `mt19abp010ak…` Baldosa cerámica de gres porcelánico, acabado pulido, 40x40 cm, 30,84€/m², capac — total: 40.48 €
  - `mt09lec010b` Lechada de cemento blanco BL 22,5 X. — total: 0.2 €
  - `mo024` Oficial 1ª alicatador. — total: 14.86 €
  - …y 2 más
- **alternatives**: 2 candidatos rechazados

#### `01.4.2` — Saneado y lijado de perfiles metálicos para eliminar el oxido y la pintura, dejándolo listo para pin
- **unit**: u · **qty**: 1.0 · **unit_price**: 562.5 € · **total**: 562.5 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita el 'saneado y lijado de perfiles metálicos para eliminar el óxido y la pintura' para una 'Barandilla terraza ático 1', con unidad 'u'. Los candidatos proporcionados son para el suministro y colocación de bolardos o puertas cancela metálicas, que son elementos completos y no se ajustan al alcance de la partida, que es una tarea de preparación de superficie sobre una barandilla existente. Dado que no se proporcionan dimensiones específicas (m², ml) para la barandilla y la unidad es 'u' (unidad), se procede a una estimación 'from_scratch' para el coste de esta tarea por unidad de barandilla. Se estima el coste basándose en la mano de obra y materiales necesarios para sanear y lijar una barandilla de terraza de tamaño típico. Se considera 8 horas de trabajo para un Oficial 1ª y 8 horas para un Peón, más los materiales consumibles. Estimación: (8 h * 28 €/h Oficial 1ª) + (8 h * 22 €/h Peón) + 50 € (materiales) = 224 € + 176 € + 50 € = 450 €/u.

- **alternatives**: 3 candidatos rechazados

#### `01.4.3` — Protección contra la oxidación en elementos de acero, con imprimación anticorrosiva, bicompo- nente,
- **unit**: u · **qty**: 1.0 · **unit_price**: 937.5 € · **total**: 937.5 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita la protección contra la oxidación de elementos de acero con imprimación anticorrosiva bicomponente, aplicada en dos manos, hasta un espesor de 100 mm. La unidad de la partida es 'u' (unidad) y la cantidad es 1.0. Los candidatos del libro no son adecuados, ya que se refieren a sistemas de protección provisionales o a la instalación completa de cancelas metálicas que incluyen la imprimación, pero no la imprimación como partida independiente. 
> 
> Se detecta una posible errata en la descripción: '100 mm' de espesor para una imprimación anticorrosiva es físicamente inviable (equivaldría a 10 cm de pintura). Se asume que se refiere a 100 micras (0.1 mm), que es un espesor habitual para este tipo de recubrimientos. 
> 
> La descripción menciona 'Barandilla terraza ático 1 15,000 15,000'. Interpretando '15,000' como 15 metros lineales de barandilla y estimando una superficie a proteger de 2 m² por metro lineal (considerando ambas caras y elementos de soporte), obtenemos una superficie total de 15 ml * 2 m²/ml = 30 m². 
> 
> El precio de mercado para la aplicación de imprimación anticorrosiva bicomponente (material y mano de obra) suele oscilar entre 20 y 30 €/m². Tomando un valor medio de 25 €/m²:
> 30 m² * 25 €/m² = 750 €.
> 
> Dado que la unidad de la partida es 'u' y la cantidad es 1, el precio unitario calculado es el coste estimado para esta 'unidad' de protección de barandilla.

- **alternatives**: 3 candidatos rechazados

#### `01.04.02` — Limpieza de sumidero existente, retirada de raíces, hojas, tierra, piedras, u cualquier otro elemen-
- **unit**: u · **qty**: 1.0 · **unit_price**: 56.25 € · **total**: 56.25 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita la 'Limpieza de sumidero existente, retirada de raíces, hojas, tierra, piedras, u cualquier otro elemento que pueda obstruir el sumidero'. Los candidatos proporcionados son para el 'Suministro e instalación' o 'Instalación' de sumideros nuevos, no para su limpieza. Por lo tanto, ninguno de los candidatos es adecuado. Se procede a una estimación 'from_scratch' basada en el coste de mano de obra y pequeños medios auxiliares. Se estima que la limpieza de un sumidero con obstrucciones podría requerir aproximadamente 1.5 horas de mano de obra de un oficial 1ª (aprox. 22 €/h) más una parte proporcional de medios auxiliares y gestión de residuos. Esto resulta en un precio unitario estimado de 45.00 €/unidad.

- **alternatives**: 3 candidatos rechazados

#### `01.4.01` — Limpieza de material en juntas de dilatación en mal estado, con medios manuales, dejando la su- perf
- **unit**: ml · **qty**: 1.0 · **unit_price**: 6.25 € · **total**: 6.25 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita únicamente la limpieza de material en juntas de dilatación en mal estado con medios manuales. Los candidatos del libro (D0609.0040, D0609.0030, QAF013) corresponden a trabajos de sellado o impermeabilización de juntas que incluyen la limpieza como parte de un proceso más complejo y costoso. No existe un candidato directo para la limpieza exclusiva. Por lo tanto, se realiza una estimación 'from_scratch' considerando la mano de obra necesaria para la limpieza manual intensiva de material deteriorado y la preparación de la superficie. Se estima un precio de 5.00 €/ml para esta tarea.

- **alternatives**: 3 candidatos rechazados

#### `01.12.1` — Revisión y ordenado de cableado eléctrico por instalador autorizado. Sótano local 1 1,000 NOTA: Pend
- **unit**: u · **qty**: 1.0 · **unit_price**: 562.5 € · **total**: 562.5 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita la 'Revisión y ordenado de cableado eléctrico por instalador autorizado' en un sótano con 'desorden general de cableado'. Los candidatos proporcionados son para el 'Suministro e instalación de cuadro eléctrico', lo cual es una actividad diferente y de mayor alcance que la revisión y ordenado de cableado existente. Por lo tanto, ninguno de los candidatos es adecuado. Se procede a una estimación 'from_scratch' basada en la complejidad de la tarea y la necesidad de un instalador autorizado. Se estima un coste de mano de obra especializada para una jornada de trabajo (aproximadamente 8 horas) incluyendo el tiempo de revisión, ordenado y pequeña material auxiliar (bridas, etiquetas, etc.). Un precio de 450.00 € por unidad (u) se considera razonable para este tipo de servicio especializado.

- **alternatives**: 3 candidatos rechazados

#### `01.12.1` — Revisión y ordenado de cableado eléctrico por instalador autorizado. Sótano local 1 1,000 NOTA: Pend
- **unit**: u · **qty**: 1.0 · **unit_price**: 937.5 € · **total**: 937.5 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> Ninguno de los candidatos del enjambre es relevante para la revisión y ordenado de cableado eléctrico, ya que todos se refieren a inspección de soldadura. La partida se valora como una unidad de trabajo especializado de un instalador autorizado. Se estima un precio para una jornada completa de trabajo de un profesional cualificado, incluyendo mano de obra, herramientas y pequeños materiales auxiliares para el ordenado del cableado en un sótano, dada la naturaleza de 'desorden general de cableado' mencionada en la partida siguiente.

- **alternatives**: 3 candidatos rechazados

#### `01.05.01` — Sustitución de placa afectada en falso techo registrable. Incluye: - Retirada de placa en mal estado
- **unit**: u · **qty**: 1.0 · **unit_price**: 350.0 € · **total**: 350.0 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-06-demolicion-falso-techo-lump-sum-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida describe la sustitución de una única placa en un falso techo registrable ('1,000 u'). Los candidatos ofrecidos son para trampillas de registro o desmontaje de unidades de aire acondicionado, que no se ajustan a la descripción de una 'placa afectada'. Dada la naturaleza de una reparación puntual y de pequeña escala (sustitución de una sola placa), se aplica el principio de la 'Red de Seguridad Extrema' y el 'Aprendizaje Histórico (RLHF)' para partidas de falso techo en unidades abstractas o de superficie mínima. El ejemplo histórico 'Demolición de falso techo' para obras IEE Henri Dunant indica que para partidas de falso techo en unidades 'Ud' con superficie pequeña o no inferible, el coste real (RAW PEM) está subvaluado por el catálogo debido al overhead técnico de movilización, jornada parcial y acceso restringido. Se recomienda un precio estimado base entre 240-360 €/Ud para estas situaciones. Se fija un precio de 280.00 €/u para cubrir los costes de desplazamiento, mano de obra mínima y el material de la placa, antes de la aplicación de Gastos Generales y Beneficio Industrial por el sistema.

- **alternatives**: 3 candidatos rechazados

#### `01.05.02` — Comprobar origen de filtración de agua sobre falso techo, realizando una cata si fuera necesario y s
- **unit**: u · **qty**: 1.0 · **unit_price**: 362.1 € · **total**: 362.1 €
- **match_kind**: `1:N` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-06-demolicion-falso-techo-lump-sum-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida se valora como un servicio compuesto de inspección/localización de filtración y posterior reparación de falso techo (cata y tapado). Se desglosa en mano de obra especializada para inspección, mano de obra general para la intervención física y materiales. El coste base de los componentes es 204.00 €. Se aplica el factor corrector de 1.42 sobre el RAW PEM total, según la calibración tenant Grupo RG para pequeñas intervenciones en falso techo (similar a la demolición de falso techo en Ud), para amortizar el overhead técnico de movilización, jornada parcial y acceso restringido. El precio unitario final es 204.00 € * 1.42 = 289.68 €.

- **breakdown** (3 componentes):
  - `mo_fontanero_of1` Oficial 1ª Fontanero para inspección y localización de filtración — total: 99.4 €
  - `mo_albañil_of1` Oficial 1ª Albañil para realización de cata y posterior tapado de falso techo — total: 191.7 €
  - `mt_falso_techo_reparacion` Materiales para tapado de falso techo (placa yeso laminado, pasta, masilla, pint — total: 71.0 €
- **alternatives**: 3 candidatos rechazados

#### `17.01` — Sellado de carpinterías existentes mediante aplicación de cordón de silicona apto para carpinterí- a
- **unit**: u · **qty**: 1.0 · **unit_price**: 31.25 € · **total**: 31.25 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida solicita el 'Sellado de carpinterías existentes mediante aplicación de cordón de silicona'. Los candidatos proporcionados (NEI030, NEI030b, NEI030c) describen el 'Sellado estanco de tubo para paso de instalaciones con tapón de elastómero termoplástico'. Existe una clara incompatibilidad semántica y material entre la descripción de la partida original (sellado de carpinterías con silicona) y los candidatos (sellado de tubos con tapones). Por lo tanto, ninguno de los candidatos es adecuado. Se aplica la regla de seguridad (Rule 6 y 4 del Manual del Aparejador) para estimar un precio desde cero. Considerando que la unidad es 'u' (unidad) y no se especifica una longitud lineal, se interpreta como una partida alzada ciega (Rule 5). Se estima un precio unitario razonable para el sellado de una unidad de carpintería (ej. un marco de ventana o puerta estándar) con cordón de silicona, incluyendo la limpieza previa. Un precio de 25.00 €/u se considera una estimación base para este tipo de trabajo.

- **alternatives**: 3 candidatos rechazados

#### `01.15.01` — Sustitución de tramo de bajante afectado por piezas en PVC. Queda pendiente realizar una ins- pecció
- **unit**: u · **qty**: 1.0 · **unit_price**: 312.5 € · **total**: 312.5 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida describe la 'sustitución de tramo de bajante afectado por piezas en PVC' con una nota explícita de 'pendiente inspección por instalador autorizado'. Esto indica que la partida es una estimación para una intervención que incluye diagnóstico y una posible reparación o sustitución menor de un tramo de bajante. Ninguno de los candidatos del enjambre encaja directamente con esta descripción ambigua y de servicio. Los candidatos son para instalaciones completas de fontanería o sumideros, no para la reparación/sustitución de un tramo de bajante ni para una inspección. Por lo tanto, se aplica la regla de 'Red de seguridad extrema' y 'Partidas alzadas ciegas'. Se estima un precio base razonable para una intervención de fontanería que incluya inspección y una posible sustitución de un tramo pequeño de bajante de PVC, considerando mano de obra y materiales básicos.

- **alternatives**: 3 candidatos rechazados

### (sin título)
`9b54c827-f916-4f73-b9d1-87532ef3b92e` · 4 ítems · subtotal: — €

#### `0.1` — Medios auxiliares necesarios para realizar todos los trabajos descritos. A DEFINIR POR LA CONS- TRUC
- **unit**: u · **qty**: 1.0 · **unit_price**: 1500.0 € · **total**: 1500.0 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-11-medios-ejecucion-escala-pem-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida de 'Medios auxiliares' se valora según la Norma COAATMCA 1.1 como un porcentaje del PEM acumulado del capítulo. El contexto de obra indica un PEM acumulado del capítulo de 6.196,00 €. Según el aprendizaje histórico (Henri Dunant, Calibración Grupo RG), para obras de reforma, el rango efectivo es del 3-5% del RAW PEM del capítulo, con un mínimo de 1.200 € raw PEM para reformas pequeñas. Calculando el porcentaje: 3% de 6.196,00 € = 185,88 € y 5% de 6.196,00 € = 309,80 €. Ambos valores están por debajo del mínimo establecido de 1.200 € raw PEM. Por lo tanto, se aplica el precio mínimo de 1.200,00 € para esta partida alzada.


#### `0.2` — Acopio de material a pie de obra. 1 1,000 Subtotal 1,000 1,000 0,00 0,00
- **unit**: u · **qty**: 1.0 · **unit_price**: 4375.0 € · **total**: 4375.0 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida 'Acopio de material a pie de obra' es una partida alzada genérica sin candidatos en el libro. Se estima un precio base conservador como partida alzada, siguiendo la regla 8 para gastos genéricos y medios auxiliares. El precio unitario se asigna directamente a la unidad 'u' de la partida.


#### `0.3` — Tramitación de documentación para solicitar la ocupación de vial, más la colocación de señaliza- cio
- **unit**: u · **qty**: 1.0 · **unit_price**: 1500.0 € · **total**: 1500.0 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> La partida describe la tramitación de documentación para la ocupación de vial, más la colocación de señalizaciones y vallado. Al no disponer de candidatos en la base de datos (CANDIDATOS ENJAMBRE: []), se procede a una estimación 'from_scratch' como partida alzada. Se considera un precio estimado para cubrir los costes administrativos, tasas, mano de obra para la colocación y retirada de señalización y vallado, y el alquiler de los elementos necesarios. Se estima un precio unitario de 1200.00 €/u para esta partida compleja.


#### `0.4` — Valoración de seguridad y salud. Implantación de seguridad y salud para la ejecución de los tra- baj
- **unit**: u · **qty**: 1.0 · **unit_price**: 1870.0 € · **total**: 1870.0 €
- **match_kind**: `from_scratch` · **confidence**: 40 · **needs_review**: True

**Reasoning trace (juez cognitivo)**:

> [v006] Aplicado(s) fragment(s) #frag-eval-01-11-medios-ejecucion-escala-pem-2026-04 como ejemplos ICL al tasar esta partida.
> 
> La partida 'Valoración de seguridad y salud. Implantación de seguridad y salud para la ejecución de los trabajos' se considera una partida alzada (PA) para medios auxiliares y seguridad y salud. Según la Norma COAATMCA 1.1, los Medios Auxiliares se cotizan como un porcentaje del PEM del capítulo. En ausencia de un PEM acumulado del capítulo y sin candidatos del libro, se recurre al aprendizaje histórico (ICL). El ejemplo de calibración para 'Medios para ejecución de los trabajos' en obras IEE tipo Henri Dunant establece un raw PEM observado de 1.496 € (equivalente a 1.870 € all-in / 1,25). Este valor se aplica como precio unitario estimado para esta partida alzada, ya que es un valor derivado de una cotización humana en un contexto similar y es más representativo que el mínimo absoluto para reformas muy pequeñas. Se marca para revisión humana debido a la naturaleza alzada de la partida y la falta de contexto del PEM del capítulo.


# Layout Analysis — input.pdf

- **Pages**: 42
- **Text extractable**: True
- **Layout detected**: `INLINE_WITH_TITLES` (confidence 0.90)

### Evidence
- 64 partidas detectadas via regex (SANITAS=64, MU02=0)
- partidas distribuidas a lo largo del documento (no concentradas en una sección)
- cabecera tabular detectada: "Código Nat Ud Resumen"

## Partidas
- Detected: **64**
- Heuristic extracted (no LLM): **59**
- Needs LLM (ambiguous): **5**

### Sample partidas
| Code | Unit | Qty | Page | Method | Title |
|---|---|---|---|---|---|
| C01.01 | m2 | — | 1 | regex_inline | DEMOLICIÓN DE FALSO TECHO EXISTENTE |
| C01.02 | m2 | — | 1 | regex_inline | DEMOLICIÓN DE TRASDOSADOS Y REVESTIMIENTOS |
| C01.03 | m2 | — | 1 | regex_inline | DEMOLICIÓN DE PARED PLADUR |
| C01.04 | m2 | — | 1 | regex_inline | DEMOLICIÓN DE PARED DE FÁBRICA |
| C01.05 | m2 | — | 1 | regex_inline | DEMOLICIÓN DE MAMPARAS |
| C01.06 | m2 | — | 2 | regex_inline | DEMOLICIÓN DE PAVIMENTO |
| C01.07 | ud | — | 2 | regex_inline | DEMOLICIÓN Y RETIRADA DE PUERTA |
| C01.08 | m2 | — | 2 | regex_inline | DESMONTAJE DE CARPINTERIA EXTERIOR |
| C01.09 | ud | — | 2 | regex_inline | DESMONTAJE DE MOBILIARIO EXISTENTE |
| C01.10 | ud | — | 2 | regex_inline | DESMONTAJE DE INSTALACIÓN ELÉCTRICA Y DATOS |

## Chapters detected
| Prefix | Name | Partidas | First page |
|---|---|---|---|
| C01 | TRABAJOS PREVIOS, DERRIBOS Y EXTRACCIONES | 25 | 1 |
| C02 | ALBAÑILERIA | 13 | 6 |
| C03 | REVESTIMIENTOS | 7 | 13 |
| C04 | PAVIMENTOS | 5 | 15 |
| C05 | FALSOS TECHOS | 6 | 17 |
| C08 | AYUDAS Y VARIOS | 8 | 19 |

## Cross-page description candidates
| Code | Header page | Description (est.) page | Reason |
|---|---|---|---|
| C01.05 | 1 | 2 | descripción inline tiene 0 chars (<50); página siguiente empieza con verbo de obra: 'Demolición de mamparas de vidrio, madera o metálicas' |
| C01.10 | 2 | 3 | descripción inline tiene 9 chars (<50); página siguiente empieza con verbo de obra: 'Desmontaje de toda la instalación eléctrica y datos,' |
| C02.06 | 10 | 11 | descripción inline tiene 0 chars (<50); página siguiente empieza con verbo de obra: 'Suministro y montaje de trasdosado Semidirecto sobre' |
| C04.02 | 15 | 16 | descripción inline tiene 0 chars (<50); página siguiente empieza con verbo de obra: 'Suministro y colocación de solado de gres porcelánico' |
| C04.08 | 16 | 17 | descripción inline tiene 0 chars (<50); página siguiente empieza con verbo de obra: 'Suministro y colocación de mortero para nivelación. En' |

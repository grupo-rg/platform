# Audit del catálogo `price_book_2025` (Fase 11.D.5)
_Generado: 2026-04-27T13:29:42.996552+00:00_

## Resumen
- Total docs (kind=breakdown): **10516**
- Docs con inconsistencias: **715 (6.8 %)**

## Distribución por categoría derivada
| Categoría | Count | % |
|---|---:|---:|
| material_fixed | 3790 | 36.0 % |
| labor | 3148 | 29.9 % |
| indirect | 1652 | 15.7 % |
| material_variable | 831 | 7.9 % |
| other | 715 | 6.8 % |
| machinery | 380 | 3.6 % |

## Tipos de inconsistencia (resumen)
| Tipo | Casos |
|---|---:|
| prefijo | 715 |

## Top 30 inconsistencias
| doc_id | code | type | is_variable | derived | issues |
|---|---|---|---|---|---|
| `0101#01` | `B0001.0030` | ? | False | other | prefijo desconocido en code='B0001.0030' |
| `0101#02` | `B0001.0070` | ? | False | other | prefijo desconocido en code='B0001.0070' |
| `0101#03` | `B1702.0010` | ? | False | other | prefijo desconocido en code='B1702.0010' |
| `0101#04` | `B1904.0130` | ? | False | other | prefijo desconocido en code='B1904.0130' |
| `0101#05` | `B1421.0040` | ? | True | other | prefijo desconocido en code='B1421.0040' |
| `0101#06` | `B1206.0010` | ? | False | other | prefijo desconocido en code='B1206.0010' |
| `0101#07` | `B3008.0340` | ? | False | other | prefijo desconocido en code='B3008.0340' |
| `0201#01` | `B0001.0070` | ? | False | other | prefijo desconocido en code='B0001.0070' |
| `0201#02` | `B1905.01511` | ? | True | other | prefijo desconocido en code='B1905.01511' |
| `0301#01` | `B0201.00111_U` | ? | True | other | prefijo desconocido en code='B0201.00111_U' |
| `0401#01` | `U07DA020` | ? | True | other | prefijo desconocido en code='U07DA020' |
| `0401#02` | `P40` | ? | False | other | prefijo desconocido en code='P40' |
| `0401#03` | `B0002.0020` | ? | False | other | prefijo desconocido en code='B0002.0020' |
| `0401#04` | `U01AA011` | ? | False | other | prefijo desconocido en code='U01AA011' |
| `0402#01` | `U07DA020` | ? | True | other | prefijo desconocido en code='U07DA020' |
| `0402#04` | `P40` | ? | False | other | prefijo desconocido en code='P40' |
| `0402#06` | `B0002.0020` | ? | False | other | prefijo desconocido en code='B0002.0020' |
| `0402#07` | `U01AA011` | ? | False | other | prefijo desconocido en code='U01AA011' |
| `0403#01` | `U07DA020` | ? | True | other | prefijo desconocido en code='U07DA020' |
| `0403#02` | `P40` | ? | False | other | prefijo desconocido en code='P40' |
| `0403#03` | `B0002.0020` | ? | False | other | prefijo desconocido en code='B0002.0020' |
| `0403#04` | `U01AA011` | ? | False | other | prefijo desconocido en code='U01AA011' |
| `0404#01` | `U07DA020` | ? | True | other | prefijo desconocido en code='U07DA020' |
| `0404#02` | `P40` | ? | False | other | prefijo desconocido en code='P40' |
| `0404#06` | `B0002.0020` | ? | False | other | prefijo desconocido en code='B0002.0020' |
| `0404#07` | `U01AA011` | ? | False | other | prefijo desconocido en code='U01AA011' |
| `0405#01` | `U07DA020` | ? | True | other | prefijo desconocido en code='U07DA020' |
| `0405#02` | `P40` | ? | False | other | prefijo desconocido en code='P40' |
| `0405#03` | `B0002.0020` | ? | False | other | prefijo desconocido en code='B0002.0020' |
| `0405#04` | `U01AA011` | ? | False | other | prefijo desconocido en code='U01AA011' |

> ⚠️ **6.8 %** supera el umbral del 5 %. Abrir tarea de saneamiento del seed para v007.

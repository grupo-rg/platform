"""Sprint 4 Fase A — Parser TABULAR coord-based para PDFs cliente PRESTO/CIFRE.

Módulo nuevo complementario al layout_analyzer existente. Se activa con la
env var `USE_TABULAR_PARSER=true` (default OFF). Cuando activo:

- Detecta cabecera `CÓDIGO RESUMEN UDS LONGITUD ANCHURA ALTURA PARCIALES
  CANTIDAD PRECIO IMPORTE` por página.
- Mapea x-coords de cada columna a partir de la cabecera.
- Agrupa `extract_words()` por y-coord en filas y por x-coord en columnas.
- Detecta jerarquía 1-4 niveles (CAPÍTULO → SUBCAPÍTULO → APARTADO → Partida).
- Aplica filtros anti-falsos-positivos (lección S3-06).
- Devuelve `TabularExtractionResult` con métricas de viabilidad.

Si el resultado no es viable (<80% qty + <80% chapter rate) → caller debe
caer a LLM Vision como fallback.
"""

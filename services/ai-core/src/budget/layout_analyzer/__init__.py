"""Subdomain `layout_analyzer` — análisis estructural offline de PDFs de mediciones.

Spike de descubrimiento (Fase 9.S, 2026-04-22). Dado un PDF de mediciones,
produce un fingerprint estructural (qué layout, cuántas partidas detectables
sin LLM, dónde están las ambigüedades). NO está conectado al pipeline de
producción todavía — es una herramienta diagnóstica que el operador ejecuta
offline para decidir cómo evolucionar la arquitectura del extractor.

Ver `services/ai-core/scripts/analyze_measurement_pdf.py` para la CLI.
"""

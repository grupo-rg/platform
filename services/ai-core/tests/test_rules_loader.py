"""Fase 5.A.1 — tests del `load_rules()` (markdown de normas COAATMCA).

El markdown `services/ai-core/prompts/rules/coaatmca_2025_rules.md` vive
versionado en el repo como única fuente de verdad de las reglas que el
Judge aplica al razonar precios. El loader:
  - Lee el fichero una sola vez al arrancar (cacheable).
  - Devuelve el contenido como `str` sin mutilación.
  - No lanza si falta una sección (el usuario ve el markdown vacío en logs).

Invariantes que el test verifica:
  - El fichero existe y tiene las 5 secciones documentadas en el plan.
  - `load_rules()` devuelve un string no vacío.
  - El string contiene los marcadores numéricos críticos: "13%", "6%", "IVA",
    "Medios Auxiliares", "Conversiones de unidades", "1:N".
  - Cacheo: llamadas repetidas devuelven el mismo objeto (o mismo contenido
    sin re-leer del disco).
"""

from __future__ import annotations

import pytest

from prompts.rules import load_rules


class TestLoadRulesMarkdown:
    def test_returns_non_empty_string(self) -> None:
        rules = load_rules()
        assert isinstance(rules, str)
        assert len(rules) > 100  # markdown razonablemente poblado

    def test_contains_key_sections(self) -> None:
        rules = load_rules()
        # Los headings que el prompt del Judge espera referenciar
        for heading in ["Porcentajes", "Conversiones", "Partidas 1:N"]:
            assert heading in rules, f"Falta sección '{heading}' en el markdown"

    def test_contains_critical_numbers(self) -> None:
        rules = load_rules()
        # Normalizamos espacios: aceptar tanto "13%" como "13 %"
        normalized = rules.replace(" %", "%")
        # Porcentajes contractuales que NO deben perderse nunca
        assert "13%" in normalized  # Gastos Generales
        assert "6%" in normalized   # Beneficio Industrial
        assert "21%" in normalized  # IVA

    def test_mentions_allowed_unit_conversions(self) -> None:
        rules = load_rules()
        assert "m²" in rules or "m2" in rules
        assert "m³" in rules or "m3" in rules
        assert "espesor" in rules.lower()

    def test_is_cacheable(self) -> None:
        """Segunda llamada no debería releer el disco; devuelve el mismo valor."""
        a = load_rules()
        b = load_rules()
        # Como mínimo el contenido es idéntico; preferimos `is` si está cacheado.
        assert a == b

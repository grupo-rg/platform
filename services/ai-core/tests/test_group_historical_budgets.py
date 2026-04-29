"""Fase 5.H.0 — tests del parser determinista de nombres de presupuestos.

Cubre las dos ramas críticas del script `group_historical_budgets.py`:
  1. Parsing de fecha + versión + slug a partir del nombre de archivo.
  2. Agrupación por slug y selección de la "última versión" del grupo.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

# El script vive en scripts/, no en src/, así que importamos vía path relativo.
import importlib.util
import sys

_SCRIPT = (
    Path(__file__).resolve().parent.parent
    / "scripts"
    / "group_historical_budgets.py"
)
spec = importlib.util.spec_from_file_location("group_historical_budgets", _SCRIPT)
assert spec is not None and spec.loader is not None
_mod = importlib.util.module_from_spec(spec)
sys.modules["group_historical_budgets"] = _mod
spec.loader.exec_module(_mod)

parse_filename = _mod.parse_filename
group_by_project = _mod.group_by_project
classify = _mod.classify
GOLDEN = _mod.GOLDEN
APPROVED_PRE_2025 = _mod.APPROVED_PRE_2025
INTERMEDIATE = _mod.INTERMEDIATE
RAW = _mod.RAW


# -------- Parser ------------------------------------------------------------


class TestParseFilename:
    def test_extracts_date_from_standard_prefix(self):
        p = parse_filename(Path("20250120 Maria Santandreu.pdf"))
        assert p.date == date(2025, 1, 20)
        assert p.version_num == 0
        assert "maria" in p.project_slug
        assert "santandreu" in p.project_slug

    def test_extracts_date_with_underscore_separator(self):
        p = parse_filename(Path("20240407 EDIF PLURIF PASTORIA_sin_materiales.PDF"))
        assert p.date == date(2024, 4, 7)
        assert p.ext == ".pdf"

    def test_detects_version_V6(self):
        p = parse_filename(Path("20241211 CP LLUIS MARTI V6_solo local.pdf"))
        assert p.version_num == 6
        # Ambos V1 y V6 del mismo proyecto deben compartir slug.
        p2 = parse_filename(Path("20240429 CP LLUIS MARTI V1.pdf"))
        assert p.project_slug == p2.project_slug

    def test_detects_rev_suffix(self):
        p = parse_filename(Path("20230607 TIBIDOY-VALLDEMOSSA_rev2.pdf"))
        assert p.version_num == 2

    def test_no_date_gets_none(self):
        p = parse_filename(Path("ADMINISTRACIONES.xlsx"))
        assert p.date is None
        assert p.ext == ".xlsx"

    def test_raw_format_flagged(self):
        assert parse_filename(Path("11-08301-18.zip")).is_raw_format is True
        assert parse_filename(Path("foo.dwg")).is_raw_format is True
        assert parse_filename(Path("bar.pzh")).is_raw_format is True
        assert parse_filename(Path("20250120 ok.pdf")).is_raw_format is False

    def test_slug_stable_across_minor_name_variants(self):
        """"HOTEL MARTE" y "MARTE HOTEL" deben colisionar al mismo slug — el
        ordenado alfabético de tokens lo garantiza."""
        p1 = parse_filename(Path("20221118 REFORMA HOTEL MARTE - TIBIDOY.pdf"))
        p2 = parse_filename(Path("20221123 MARTE TIBIDOY HOTEL reforma v2.pdf"))
        assert p1.project_slug == p2.project_slug


# -------- Grouping + classification ----------------------------------------


class TestGrouping:
    def test_latest_picks_max_date_then_max_version(self):
        files = [
            parse_filename(Path("20250101 LLUIS MARTI V1.pdf")),
            parse_filename(Path("20250601 LLUIS MARTI V3.pdf")),
            parse_filename(Path("20250601 LLUIS MARTI V2.pdf")),
        ]
        groups = group_by_project(files)
        assert len(groups) == 1
        latest = groups[0].latest
        assert latest.date == date(2025, 6, 1)
        assert latest.version_num == 3

    def test_classify_2025_latest_goes_to_golden(self):
        files = [parse_filename(Path("20250120 Maria Santandreu.pdf"))]
        plan = classify(files)
        assert len(plan[GOLDEN]) == 1
        assert plan[GOLDEN][0][0].name == "20250120 Maria Santandreu.pdf"

    def test_classify_2023_latest_goes_to_approved_pre_2025(self):
        files = [parse_filename(Path("20230120 HOTEL BELLVER.pdf"))]
        plan = classify(files)
        assert len(plan[APPROVED_PRE_2025]) == 1

    def test_classify_older_versions_go_to_intermediate(self):
        files = [
            parse_filename(Path("20240429 CP LLUIS MARTI V1.pdf")),
            parse_filename(Path("20241211 CP LLUIS MARTI V6.pdf")),
        ]
        plan = classify(files)
        # V6 es la última → no es 2025 → va a APPROVED_PRE_2025
        pre_2025 = [p.name for p, _ in plan[APPROVED_PRE_2025]]
        intermediate = [p.name for p, _ in plan[INTERMEDIATE]]
        assert "20241211 CP LLUIS MARTI V6.pdf" in pre_2025
        assert "20240429 CP LLUIS MARTI V1.pdf" in intermediate

    def test_classify_zip_and_dwg_go_to_raw(self):
        files = [
            parse_filename(Path("11-08301-18.zip")),
            parse_filename(Path("plano.dwg")),
        ]
        plan = classify(files)
        assert len(plan[RAW]) == 2

    def test_classify_mixed_2025_scenario(self):
        """Escenario real: 3 proyectos 2025, uno con versiones, uno .xlsx
        hermano, uno puro. Verifica el mix final."""
        files = [
            parse_filename(Path("20250120 Maria Santandreu.pdf")),
            parse_filename(Path("20250306 CAS CATALA.pdf")),
            parse_filename(Path("20250306 CAS CATALA.xlsx")),
            parse_filename(Path("20250505 ARAGON 181.pdf")),
            parse_filename(Path("20250505 ARAGON 181 (2).pdf")),
        ]
        plan = classify(files)

        golden = [p.name for p, _ in plan[GOLDEN]]
        # Los 3 proyectos 2025 deben tener al menos su "latest" en GOLDEN
        assert "20250120 Maria Santandreu.pdf" in golden
        # CAS CATALA: pdf es latest (ext priority), xlsx hermano va a GOLDEN también
        # porque en el grouping estos dos pertenecen al mismo grupo y solo uno es
        # "latest". El otro va a INTERMEDIATE.
        assert "20250306 CAS CATALA.pdf" in golden
        # ARAGON 181 y ARAGON 181 (2): duplicados exactos (misma fecha, sin
        # versión detectable — "(2)" es marcador de copia). El grouping los
        # pone juntos; uno es latest arbitrariamente y el otro intermediate.
        # El operador decide manualmente cuál conservar.
        aragon_in_golden = [n for n in golden if "ARAGON" in n]
        aragon_in_intermediate = [
            p.name for p, _ in plan[INTERMEDIATE] if "ARAGON" in p.name
        ]
        assert len(aragon_in_golden) + len(aragon_in_intermediate) == 2
        assert len(aragon_in_golden) >= 1, "al menos uno debe quedar como golden"

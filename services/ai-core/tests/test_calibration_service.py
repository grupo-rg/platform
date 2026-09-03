"""Calibración (catálogo → constructor real) — reader.

Cubre la semántica §4/§5/§8 de ``CalibrationTable.effective_factor`` y el
loader ``CalibrationService`` (fallback a code-defaults no-fatal).
"""
from __future__ import annotations

import pytest

from src.budget.application.services.calibration_service import (
    DEFAULT_CLAMP_MAX,
    DEFAULT_CLAMP_MIN,
    DEFAULT_GLOBAL_FACTOR,
    DEFAULT_GUARD_MIN_SAMPLES,
    CalibrationService,
    CalibrationTable,
    ChapterCalibration,
    is_low_confidence_chapter,
    normalize_chapter_key,
)


# --------------------------------------------------------------------------- #
# effective_factor — fallback global                                          #
# --------------------------------------------------------------------------- #
def test_unknown_chapter_falls_back_to_global():
    table = CalibrationTable(global_factor=1.36, chapters={})
    eff = table.effective_factor("CIMENTACIONES")
    assert eff.factor == pytest.approx(1.36)
    assert eff.source == "global"


def test_empty_and_none_chapter_fall_back_to_global():
    table = CalibrationTable(global_factor=1.4, chapters={
        "DEMOLICIONES": ChapterCalibration(factor=1.42, source="seed", manual_factor=1.42),
    })
    for ch in ("", "   ", None):
        eff = table.effective_factor(ch)
        assert eff.source == "global"
        assert eff.factor == pytest.approx(1.4)


# --------------------------------------------------------------------------- #
# effective_factor — per-chapter (seed / manual, below guard)                 #
# --------------------------------------------------------------------------- #
def test_per_chapter_seed_below_guard_uses_manual_seed_not_learned():
    table = CalibrationTable(
        global_factor=1.36,
        guard_min_samples=8,
        chapters={
            "DEMOLICIONES": ChapterCalibration(
                factor=1.42, source="seed", sample_count=5,
                manual_factor=1.42, learned_factor=1.90,  # learned NO debe aplicar aún
            ),
        },
    )
    eff = table.effective_factor("demoliciones")  # normaliza a UPPER
    assert eff.factor == pytest.approx(1.42)
    assert eff.source != "learned"
    assert eff.sample_count == 5


def test_manual_locked_always_wins_over_learned():
    table = CalibrationTable(
        global_factor=1.36, guard_min_samples=8,
        chapters={
            "ALBAÑILERÍA": ChapterCalibration(
                factor=1.42, source="manual", sample_count=200,
                manual_factor=1.50, manual_locked=True, learned_factor=2.10,
            ),
        },
    )
    eff = table.effective_factor("ALBAÑILERÍA")
    assert eff.factor == pytest.approx(1.50)
    assert eff.source == "manual"


# --------------------------------------------------------------------------- #
# effective_factor — min-sample guard                                         #
# --------------------------------------------------------------------------- #
def test_learned_not_applied_below_guard():
    table = CalibrationTable(
        global_factor=1.36, guard_min_samples=8,
        chapters={
            "SANEAMIENTO": ChapterCalibration(
                factor=1.36, source="seed", sample_count=7,
                manual_factor=1.36, learned_factor=1.95,
            ),
        },
    )
    eff = table.effective_factor("SANEAMIENTO")
    assert eff.factor == pytest.approx(1.36)   # sigue el manual/seed
    assert eff.source != "learned"


def test_learned_applied_at_guard_threshold():
    table = CalibrationTable(
        global_factor=1.36, guard_min_samples=8,
        chapters={
            "SANEAMIENTO": ChapterCalibration(
                factor=1.36, source="seed", sample_count=8,
                manual_factor=1.36, learned_factor=1.95,
            ),
        },
    )
    eff = table.effective_factor("SANEAMIENTO")
    assert eff.factor == pytest.approx(1.95)
    assert eff.source == "learned"
    assert eff.sample_count == 8


def test_learned_applied_above_guard():
    table = CalibrationTable(
        global_factor=1.36, guard_min_samples=8,
        chapters={
            "PINTURAS": ChapterCalibration(
                factor=1.36, source="seed", sample_count=25,
                learned_factor=1.80,
            ),
        },
    )
    eff = table.effective_factor("PINTURAS")
    assert eff.factor == pytest.approx(1.80)
    assert eff.source == "learned"


# --------------------------------------------------------------------------- #
# effective_factor — clamp de lectura                                         #
# --------------------------------------------------------------------------- #
def test_read_time_clamp_high():
    table = CalibrationTable(
        global_factor=1.36, guard_min_samples=8,
        clamp_min=0.8, clamp_max=2.6,
        chapters={
            "ESTRUCTURAS": ChapterCalibration(
                factor=1.36, source="seed", sample_count=30, learned_factor=5.0,
            ),
        },
    )
    eff = table.effective_factor("ESTRUCTURAS")
    assert eff.factor == pytest.approx(2.6)  # clamp máximo


def test_read_time_clamp_low():
    table = CalibrationTable(
        global_factor=1.36, guard_min_samples=8,
        clamp_min=0.8, clamp_max=2.6,
        chapters={
            "ESTRUCTURAS": ChapterCalibration(
                factor=1.36, source="seed", sample_count=30, learned_factor=0.1,
            ),
        },
    )
    eff = table.effective_factor("ESTRUCTURAS")
    assert eff.factor == pytest.approx(0.8)  # clamp mínimo


def test_per_chapter_clamp_override():
    table = CalibrationTable(
        global_factor=1.36, guard_min_samples=8,
        clamp_min=0.8, clamp_max=2.6,
        chapters={
            "AISLAMIENTOS": ChapterCalibration(
                factor=1.36, source="seed", sample_count=30, learned_factor=5.0,
                clamp_max=3.0,  # override por capítulo
            ),
        },
    )
    eff = table.effective_factor("AISLAMIENTOS")
    assert eff.factor == pytest.approx(3.0)


# --------------------------------------------------------------------------- #
# effective_factor — low-confidence / alucinados → global                     #
# --------------------------------------------------------------------------- #
def test_low_confidence_chapter_names_fall_back_to_global():
    # Aunque exista una entrada por capítulo, un nombre poco fiable la ignora.
    table = CalibrationTable(
        global_factor=1.36,
        chapters={
            "VARIOS": ChapterCalibration(factor=2.4, source="manual", manual_factor=2.4),
            "GENERAL": ChapterCalibration(factor=2.4, source="manual", manual_factor=2.4),
        },
    )
    for ch in ("VARIOS", "GENERAL", "SIN CAPÍTULO", "[UNKNOWN]", "Cap. NO ESPECIFICADO"):
        eff = table.effective_factor(ch)
        assert eff.source == "global", ch
        assert eff.factor == pytest.approx(1.36), ch


def test_is_low_confidence_predicate():
    assert is_low_confidence_chapter("VARIOS") is True
    assert is_low_confidence_chapter("[unknown]") is True
    assert is_low_confidence_chapter("") is True
    assert is_low_confidence_chapter("DEMOLICIONES") is False


def test_normalize_chapter_key():
    assert normalize_chapter_key("  demoliciones  ") == "DEMOLICIONES"
    assert normalize_chapter_key(None) == ""


# --------------------------------------------------------------------------- #
# CalibrationTable.from_dict / code_defaults                                   #
# --------------------------------------------------------------------------- #
def test_code_defaults_values():
    table = CalibrationTable.code_defaults()
    assert table.global_factor == pytest.approx(DEFAULT_GLOBAL_FACTOR)  # 1.0 neutro
    assert table.guard_min_samples == DEFAULT_GUARD_MIN_SAMPLES
    assert table.clamp_min == pytest.approx(DEFAULT_CLAMP_MIN)
    assert table.clamp_max == pytest.approx(DEFAULT_CLAMP_MAX)
    # CODE DEFAULTS neutros: sin seeds por capítulo (viven en el doc sembrado,
    # visibles para el owner). Nada oculto se aplica pre-seed.
    assert table.chapters == {}
    dem = table.effective_factor("DEMOLICIONES")
    assert dem.factor == pytest.approx(DEFAULT_GLOBAL_FACTOR)
    assert dem.source == "global"
    # Cualquier capítulo cae al global neutro.
    assert table.effective_factor("FONTANERÍA").factor == pytest.approx(DEFAULT_GLOBAL_FACTOR)


def test_from_dict_parses_and_normalizes_chapter_keys():
    doc = {
        "global": {"factor": 1.5, "source": "manual", "sample_count": 3},
        "chapters": {
            "demoliciones": {  # minúsculas → se normaliza a UPPER
                "factor": 1.42, "source": "seed", "sample_count": 0, "manual_factor": 1.42,
            },
        },
        "guard": {"min_samples": 10, "clamp_min": 0.7, "clamp_max": 2.2},
    }
    table = CalibrationTable.from_dict(doc)
    assert table.global_factor == pytest.approx(1.5)
    assert table.guard_min_samples == 10
    assert table.clamp_min == pytest.approx(0.7)
    assert table.clamp_max == pytest.approx(2.2)
    eff = table.effective_factor("DEMOLICIONES")
    assert eff.factor == pytest.approx(1.42)


def test_from_dict_partial_doc_falls_back_per_field():
    # Doc sin `global` ni `guard` → code-defaults por campo, sin romper.
    table = CalibrationTable.from_dict({"chapters": {}})
    assert table.global_factor == pytest.approx(DEFAULT_GLOBAL_FACTOR)
    assert table.guard_min_samples == DEFAULT_GUARD_MIN_SAMPLES
    assert table.effective_factor("CUALQUIERA").factor == pytest.approx(DEFAULT_GLOBAL_FACTOR)


# --------------------------------------------------------------------------- #
# CalibrationService loader (Firestore admin, no-fatal)                        #
# --------------------------------------------------------------------------- #
class _FakeSnap:
    def __init__(self, data):
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return self._data


class _FakeDoc:
    def __init__(self, data):
        self._data = data

    def get(self):
        return _FakeSnap(self._data)


class _FakeColl:
    def __init__(self, data):
        self._data = data

    def document(self, _doc_id):
        return _FakeDoc(self._data)


class _FakeDB:
    def __init__(self, data):
        self._data = data

    def collection(self, _name):
        return _FakeColl(self._data)


class _RaisingDB:
    def collection(self, _name):
        raise RuntimeError("firestore unreachable")


async def test_loader_reads_existing_doc():
    doc = {
        "global": {"factor": 1.6, "source": "manual", "sample_count": 12},
        "chapters": {"DEMOLICIONES": {"factor": 1.42, "source": "seed", "manual_factor": 1.42}},
        "guard": {"min_samples": 8, "clamp_min": 0.8, "clamp_max": 2.6},
    }
    svc = CalibrationService(db=_FakeDB(doc))
    table = await svc.load()
    assert table.global_factor == pytest.approx(1.6)
    assert table.effective_factor("DEMOLICIONES").factor == pytest.approx(1.42)


async def test_loader_missing_doc_falls_back_to_code_defaults():
    svc = CalibrationService(db=_FakeDB(None))  # snap.exists == False
    table = await svc.load()
    assert table.global_factor == pytest.approx(DEFAULT_GLOBAL_FACTOR)  # 1.0 neutro
    # Sin doc → sin seeds por capítulo; DEMOLICIONES cae al global neutro.
    assert table.effective_factor("DEMOLICIONES").factor == pytest.approx(DEFAULT_GLOBAL_FACTOR)


async def test_loader_firestore_error_falls_back_to_code_defaults():
    svc = CalibrationService(db=_RaisingDB())
    table = await svc.load()  # no debe propagar la excepción
    assert table.global_factor == pytest.approx(DEFAULT_GLOBAL_FACTOR)

"""Tests for the JSON structured logger.

Cloud Run / Cloud Logging auto-parses JSON stdout lines into structured
log entries. We use that — keeps the worker logs queryable by jobId and
attemptId in Cloud Logging without a separate agent.

We verify:
  - The formatter emits valid JSON.
  - Standard fields (message, severity, timestamp) are present.
  - `extra={...}` arbitrary keys are merged into the JSON payload, NOT
    nested under an `extra` key.
  - `exc_info` (exception traceback) is included as a `stack_trace` string.
  - Reserved fields (e.g. levelname) are mapped to GCP's `severity` convention.
"""

from __future__ import annotations

import json
import logging
from io import StringIO

import pytest

from src.core.logging import init_json_logging, JsonFormatter


def _capture_logger(level: int = logging.INFO):
    """Build a logger that writes JSON lines into an in-memory buffer."""
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger(f"test_logger_{id(buf)}")
    # Make sure we don't propagate to root (which would double-log).
    logger.propagate = False
    logger.handlers = [handler]
    logger.setLevel(level)
    return logger, buf


def _lines(buf: StringIO) -> list[dict]:
    out = []
    for line in buf.getvalue().splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


class TestJsonFormatter:
    def test_basic_message_emits_valid_json(self):
        logger, buf = _capture_logger()
        logger.info("Hello world")
        [entry] = _lines(buf)
        assert entry["message"] == "Hello world"
        assert entry["severity"] == "INFO"
        assert entry["logger"] == logger.name
        assert "timestamp" in entry

    def test_severity_maps_python_levels_to_gcp_levels(self):
        # GCP Cloud Logging expects DEBUG/INFO/WARNING/ERROR/CRITICAL —
        # Python's `WARN` and `FATAL` aliases get normalised.
        logger, buf = _capture_logger(level=logging.DEBUG)
        logger.debug("d")
        logger.info("i")
        logger.warning("w")
        logger.error("e")
        logger.critical("c")
        entries = _lines(buf)
        assert [e["severity"] for e in entries] == [
            "DEBUG",
            "INFO",
            "WARNING",
            "ERROR",
            "CRITICAL",
        ]

    def test_extra_keys_are_merged_at_top_level(self):
        logger, buf = _capture_logger()
        logger.info(
            "Pipeline starting",
            extra={
                "jobId": "job-abc",
                "attemptId": "att-1",
                "budgetId": "budget-9",
                "partidasResolved": 42,
            },
        )
        [entry] = _lines(buf)
        # These appear at the top level so Cloud Logging treats them as labels.
        assert entry["jobId"] == "job-abc"
        assert entry["attemptId"] == "att-1"
        assert entry["budgetId"] == "budget-9"
        assert entry["partidasResolved"] == 42

    def test_exception_includes_stack_trace(self):
        logger, buf = _capture_logger()
        try:
            raise RuntimeError("boom at chunk 42")
        except RuntimeError:
            logger.exception("Pipeline crashed", extra={"jobId": "job-x"})
        [entry] = _lines(buf)
        assert entry["severity"] == "ERROR"
        assert entry["jobId"] == "job-x"
        assert "stack_trace" in entry
        assert "RuntimeError: boom at chunk 42" in entry["stack_trace"]

    def test_falsey_extra_values_are_preserved(self):
        # Cloud Logging filters on exact equality, so we must NOT drop None /
        # 0 / "" — they're meaningful (e.g. partidasResolved=0 on a failure).
        logger, buf = _capture_logger()
        logger.info(
            "zero counters",
            extra={"partidasResolved": 0, "errorType": None},
        )
        [entry] = _lines(buf)
        assert entry["partidasResolved"] == 0
        assert entry["errorType"] is None

    def test_handles_non_json_serialisable_extra(self):
        """A buggy caller might pass an object that json can't serialise.
        Better to log something with a repr than to drop the line entirely."""
        logger, buf = _capture_logger()

        class Weird:
            def __repr__(self):
                return "Weird()"

        logger.info("weird payload", extra={"obj": Weird()})
        [entry] = _lines(buf)
        # Falls back to string repr.
        assert entry["obj"] == "Weird()"


class TestInitJsonLogging:
    def test_install_sets_root_handler_format(self, caplog):
        # init_json_logging is idempotent — calling twice doesn't duplicate
        # handlers (each subsequent call replaces).
        init_json_logging()
        init_json_logging()
        root = logging.getLogger()
        # Exactly one stream handler with our formatter.
        json_handlers = [
            h
            for h in root.handlers
            if isinstance(h.formatter, JsonFormatter)
        ]
        assert len(json_handlers) == 1

    def test_install_respects_level_override(self):
        init_json_logging(level=logging.WARNING)
        assert logging.getLogger().level == logging.WARNING
        # Reset for other tests.
        init_json_logging(level=logging.INFO)

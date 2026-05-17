"""JSON structured logger.

Cloud Logging on Cloud Run auto-parses any JSON line written to stdout into
a structured entry: top-level keys become indexed labels, and the special
fields `severity` and `message` are recognised natively. That's all we need
for queryable jobId / attemptId / budgetId filters in the Logs Explorer.

Usage at process start:

    from src.core.logging import init_json_logging
    init_json_logging()

Then anywhere:

    logger.info("Pipeline starting", extra={"jobId": jid, "attemptId": aid})

Anything in `extra={...}` is merged at the top level of the JSON output —
NOT nested — so `jsonPayload.jobId` in Cloud Logging works directly.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


# Keys that LogRecord already populates internally; ignore them when picking
# up `extra=` from caller. (`logger.info(..., extra={...})` stuffs the keys
# directly onto the record, so we have to filter them back out.)
_STANDARD_LOGRECORD_ATTRS = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "thread",
        "threadName",
        "taskName",  # Python 3.12+
    }
)


# Python level → GCP severity. The GCP severity enum:
# DEBUG / INFO / NOTICE / WARNING / ERROR / CRITICAL / ALERT / EMERGENCY.
# We map only what Python emits.
_LEVEL_TO_SEVERITY = {
    logging.DEBUG: "DEBUG",
    logging.INFO: "INFO",
    logging.WARNING: "WARNING",
    logging.ERROR: "ERROR",
    logging.CRITICAL: "CRITICAL",
}


def _safe_value(value: Any) -> Any:
    """Coerce a value into something json.dumps can handle. If it can't be
    serialised cleanly, fall back to its repr — never drop the log line."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_safe_value(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _safe_value(v) for k, v in value.items()}
    if isinstance(value, datetime):
        return value.isoformat()
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)


class JsonFormatter(logging.Formatter):
    """Formatter that emits one JSON object per log record."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        payload: dict[str, Any] = {
            "severity": _LEVEL_TO_SEVERITY.get(
                record.levelno, record.levelname
            ),
            "message": record.getMessage(),
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "logger": record.name,
        }

        # Merge `extra=` keys at the top level so Cloud Logging treats them
        # as labels rather than nesting them under `extra` (which would
        # require filters like `jsonPayload.extra.jobId="x"` — verbose).
        for key, value in record.__dict__.items():
            if key in _STANDARD_LOGRECORD_ATTRS:
                continue
            if key.startswith("_"):
                continue
            payload[key] = _safe_value(value)

        # Exception info → flat string so it's grepable in the Logs Explorer.
        if record.exc_info:
            payload["stack_trace"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False, default=_safe_value)


def init_json_logging(*, level: int = logging.INFO) -> None:
    """Idempotent installer for the JSON formatter on the root logger.

    Idempotency matters because both `worker_main.py` and `http/main.py`
    call this at process start; if the worker is also invoked via tests,
    calling twice mustn't pile up handlers.
    """
    root = logging.getLogger()
    # Strip any prior handlers WE installed; leave foreign ones alone (e.g.
    # pytest's capture handler) so test capture keeps working.
    root.handlers = [
        h for h in root.handlers if not isinstance(h.formatter, JsonFormatter)
    ]
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level)

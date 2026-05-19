"""Domain exceptions for the pipeline_jobs bounded context."""

from __future__ import annotations


class IllegalStateTransitionError(Exception):
    """Raised when a PipelineJob is asked to transition in a way the state
    machine forbids — e.g. claim an already-running job, complete a queued
    job, or retry a completed job.

    This is the explicit guardrail that replaces the previous silent
    behaviour where `BackgroundTasks` cancellations were swallowed and the
    UI stayed pinned to "processing" forever.
    """


class JobNotFoundError(Exception):
    """Raised by repositories when a job lookup misses."""


class JobTooLargeError(Exception):
    """S2-A-04 — el cap absoluto de partidas se superó.

    Cuando un PDF/NL extrae >2000 partidas, lo rechazamos en lugar de
    intentar chunkear. La razón: 2000 partidas × ~0.5s/partida = 1000s = 17min
    incluso con SWARM_CONCURRENCY=8, sin contar token cost. Es una señal
    de PDF mal extraído (sumatorios duplicados, formato no soportado) o
    proyecto que necesita revisión humana antes del pricing automático.
    """

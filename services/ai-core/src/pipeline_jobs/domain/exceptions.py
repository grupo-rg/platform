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

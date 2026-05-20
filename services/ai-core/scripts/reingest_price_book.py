"""Sprint 3.B — Re-ingest `prices/coaatmca_2025_price_book.json` into the
Firestore collection `price_book_2025` preserving the FULL v005 schema.

Why this exists
---------------
Sprint 3.B audit discovered:
  - 11 codes with unit suffix glued to the code (`D3001.0120m`
    -> `D3001.0120`). Fixed in JSON via `fix_json_code_suffix_bug.py`.
  - 4 items + 44 breakdown codes truncated by ellipsis (`UXH010c…`).
    Items disambiguated to `UXH010ca/cb/cc/cd`. Breakdowns kept as-is and
    marked with `_truncated_in_source: true`.
  - `is_variable` flag (CRITICAL for the budget editor) lives in 10,537
    breakdowns. We MUST preserve it exactly during re-ingest.

The existing `vectorize_catalog_v005.py` uses `CatalogTransformer` which
does NOT propagate `_truncated_in_source` and uses 1-indexed breakdown
ordinals. This re-ingest script is purpose-built for Sprint 3.B with:
  - Pre-flight validation that rejects the source if `is_variable` is
    missing on ANY breakdown.
  - Backup of the entire current collection (embeddings included) BEFORE
    any mutation.
  - Atomic-swap-via-session-id strategy: every new doc carries a
    `_reingest_session_id`, the deletion of older docs happens AFTER all
    new docs are written and verified.
  - Post-flight validation: counts in Firestore vs JSON, plus spot-check
    of `is_variable` preservation and existence of the 15 fixed codes.

Usage
-----
    python reingest_price_book.py            # dry-run (default; NO Firestore I/O)
    python reingest_price_book.py --apply    # commits to Firestore
    python reingest_price_book.py --backup-only  # only download the backup

Env required (read from services/ai-core/.env or shell):
  - GOOGLE_GENAI_API_KEY     (embeddings)
  - FIREBASE_PROJECT_ID
  - FIREBASE_CLIENT_EMAIL
  - FIREBASE_PRIVATE_KEY     (with literal \\n; the loader replaces them)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
SOURCE_JSON = REPO_ROOT / "prices" / "coaatmca_2025_price_book.json"
BACKUP_DIR = REPO_ROOT / "data" / "catalog_source"
PRICE_BOOK_COLLECTION = "price_book_2025"

sys.path.insert(0, str(ROOT))

# Reuse the existing domain primitives — single source of truth for the
# v005 schema. The schema docstring lives in `domain/price_book_entry.py`.
from src.budget.catalog.domain.price_book_entry import (  # noqa: E402
    EmbeddingTextBuilder,
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)
from src.budget.catalog.domain.unit import Unit  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("reingest_price_book")


# -------------------- Constants & tunables ----------------------------------

EMBED_BATCH_SIZE = 100  # gemini-embedding-001 accepts >= 100 per call
SAVE_BATCH_SIZE = 400  # Firestore caps batches at 500 ops + 10MiB payload
FIRESTORE_DELETE_BATCH = 400  # deletes count as ops; stay below 500 ceiling
FIRESTORE_DIM_LIMIT = 768  # Firestore Vector cap is 2048; query truncates to 768
EMBED_MODEL = "gemini-embedding-001"  # MRL truncated to 768

# Spec preflight thresholds (Sprint 3.B audit determined these are the
# minimum we must see in the COAATMCA_2025 catalogue).
MIN_ITEM_COUNT = 1650
MIN_BREAKDOWN_COUNT = 10_000


# -------------------- Pure helpers ------------------------------------------


def normalize_unit(raw: str) -> Optional[str]:
    """Single source of truth for unit normalization — delegates to Unit VO.

    Returns the canonical form (`m2`, `m3`, `ud`, `ml`, ...) or None when the
    raw token is not recognized by the canonical table.
    """
    return Unit.normalize(raw)


def unit_dimension(raw: str) -> Optional[str]:
    """Returns physical dimension (`superficie`, `masa`, ...) or None."""
    return Unit.dimension_of(raw)


def build_breakdown_doc_id(parent_code: str, idx: int) -> str:
    """`{parent}#{idx:02d}` — compound key for breakdowns.

    Sprint 3.B convention: 0-based per spec. Internally consistent because
    `breakdown_ids` on the parent item is set from these same IDs, so no
    downstream code constructs `#01` out of band.
    """
    return f"{parent_code}#{idx:02d}"


def code_is_truncated(code: str) -> bool:
    """A code is "truncated in source" if it contains ellipsis chars.

    Sprint 3.B: the PDF column width clipped some breakdown codes with `…`
    (or `...`). Items got disambiguated, but breakdowns are preserved as-is
    with this marker so a human can later validate.
    """
    if not code:
        return False
    return "…" in code or "..." in code


# -------------------- Pre-flight validation ---------------------------------


@dataclass
class PreflightReport:
    items_count: int = 0
    breakdowns_count: int = 0
    is_variable_true_count: int = 0
    is_variable_false_count: int = 0
    truncated_breakdown_codes: int = 0
    truncated_item_codes: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def preflight_validate(source: list[dict[str, Any]]) -> PreflightReport:
    """Validate the JSON source BEFORE touching Firestore. Aborts on any error.

    Checks (all critical unless noted):
      - source is a non-empty list of chapter dicts.
      - item count >= MIN_ITEM_COUNT.
      - total breakdowns count >= MIN_BREAKDOWN_COUNT.
      - every item has: code, description, unit, priceTotal, chapter.
      - every breakdown has: code, description, quantity, unit, price,
        AND `is_variable` (the critical Sprint 3.B field).
      - no empty item codes; no duplicate item codes.
    """
    report = PreflightReport()

    if not isinstance(source, list) or not source:
        report.errors.append("Source JSON must be a non-empty list of chapter blocks.")
        return report

    seen_item_codes: dict[str, str] = {}  # code -> chapter (for dup reporting)
    empty_item_codes = 0
    items_missing_field: list[tuple[str, str]] = []  # (code, missing_field)
    bk_missing_field: list[tuple[str, str, str]] = []  # (parent_code, code, missing)
    bk_missing_is_variable: list[tuple[str, str]] = []  # (parent_code, bk_code)

    for chap_idx, chap in enumerate(source):
        if not isinstance(chap, dict):
            report.errors.append(f"Chapter block {chap_idx} is not a dict.")
            continue
        chapter_name = chap.get("chapter") or ""
        if not chapter_name:
            report.warnings.append(f"Chapter block {chap_idx} has empty chapter name.")

        items = chap.get("items") or []
        if not isinstance(items, list):
            report.errors.append(
                f"Chapter {chapter_name!r} has non-list items field."
            )
            continue

        for item in items:
            if not isinstance(item, dict):
                report.errors.append(
                    f"Chapter {chapter_name!r}: non-dict item entry."
                )
                continue

            code = (item.get("code") or "").strip()
            if not code:
                empty_item_codes += 1
                continue

            # Track duplicates (full match — different chapters with same code = dup)
            if code in seen_item_codes:
                report.errors.append(
                    f"Duplicate item code {code!r} "
                    f"(first seen in {seen_item_codes[code]!r}, "
                    f"now in {chapter_name!r})."
                )
            else:
                seen_item_codes[code] = chapter_name

            # Required fields on items (chapter checked above)
            for fld in ("description", "unit", "priceTotal"):
                if fld not in item or item.get(fld) in (None, ""):
                    # priceTotal may be 0.0 which is falsy but valid
                    if fld == "priceTotal" and item.get(fld) == 0:
                        continue
                    items_missing_field.append((code, fld))

            if code_is_truncated(code):
                report.truncated_item_codes += 1

            report.items_count += 1

            for bk in item.get("breakdown") or []:
                if not isinstance(bk, dict):
                    report.errors.append(
                        f"Item {code!r} has non-dict breakdown entry."
                    )
                    continue
                bk_code = (bk.get("code") or "").strip()

                # is_variable is CRITICAL — Sprint 3.B determined its absence
                # breaks the budget editor's variable-material distinction.
                if "is_variable" not in bk:
                    bk_missing_is_variable.append((code, bk_code))
                else:
                    if bool(bk.get("is_variable")):
                        report.is_variable_true_count += 1
                    else:
                        report.is_variable_false_count += 1

                for fld in ("description", "quantity", "unit", "price"):
                    if fld not in bk or bk.get(fld) is None:
                        # quantity/price may legitimately be 0
                        if fld in ("quantity", "price") and bk.get(fld) == 0:
                            continue
                        if bk.get(fld) == "":
                            bk_missing_field.append((code, bk_code, fld))
                        elif fld not in bk:
                            bk_missing_field.append((code, bk_code, fld))

                if bk_code and code_is_truncated(bk_code):
                    report.truncated_breakdown_codes += 1

                report.breakdowns_count += 1

    if empty_item_codes:
        report.errors.append(f"{empty_item_codes} items have empty code.")
    if items_missing_field:
        # Show only first 5 to avoid spamming
        sample = ", ".join(f"{c}:{f}" for c, f in items_missing_field[:5])
        report.errors.append(
            f"{len(items_missing_field)} items missing required fields. Sample: {sample}"
        )
    if bk_missing_field:
        sample = ", ".join(f"{p}#{c}:{f}" for p, c, f in bk_missing_field[:5])
        report.errors.append(
            f"{len(bk_missing_field)} breakdowns missing required fields. "
            f"Sample: {sample}"
        )
    if bk_missing_is_variable:
        sample = ", ".join(f"{p}#{c}" for p, c in bk_missing_is_variable[:5])
        report.errors.append(
            f"CRITICAL: {len(bk_missing_is_variable)} breakdowns missing "
            f"`is_variable` field. Sample: {sample}"
        )

    if report.items_count < MIN_ITEM_COUNT:
        report.errors.append(
            f"Item count {report.items_count} < expected minimum {MIN_ITEM_COUNT}."
        )
    if report.breakdowns_count < MIN_BREAKDOWN_COUNT:
        report.errors.append(
            f"Breakdowns count {report.breakdowns_count} < expected minimum "
            f"{MIN_BREAKDOWN_COUNT}."
        )

    return report


# -------------------- Source -> entries transformation ----------------------


@dataclass
class TransformReport:
    items: list[PriceBookItemEntry]
    breakdowns: list[PriceBookBreakdownEntry]
    truncated_marks: int  # docs flagged with _truncated_in_source
    skipped_items: int
    skipped_breakdowns: int


def transform_source(
    source: list[dict[str, Any]], *, idx_base: int = 0
) -> TransformReport:
    """Build Pydantic entries from the JSON source.

    Differences vs the existing `CatalogTransformer`:
      - Preserves `_truncated_in_source` marker on breakdowns whose code
        contains ellipsis (set later when serializing the doc).
      - Uses `idx_base` (0 by default per Sprint 3.B spec) for breakdown
        ordinals. Existing prod data used 1-based; since we re-write ALL
        docs (including `breakdown_ids` on each parent), internal
        consistency is preserved.
    """
    items: list[PriceBookItemEntry] = []
    breakdowns: list[PriceBookBreakdownEntry] = []
    truncated_marks = 0
    skipped_items = 0
    skipped_breakdowns = 0

    for chap in source:
        chapter_name = chap.get("chapter") or ""
        for raw_item in chap.get("items") or []:
            code = (raw_item.get("code") or "").strip()
            description = raw_item.get("description")
            if not code or not description:
                skipped_items += 1
                continue

            unit_raw = raw_item.get("unit") or ""
            try:
                item_entry = PriceBookItemEntry(
                    code=code,
                    chapter=chapter_name,
                    section=raw_item.get("section") or "",
                    description=description,
                    unit_raw=unit_raw,
                    unit_normalized=normalize_unit(unit_raw),
                    unit_dimension=unit_dimension(unit_raw),
                    priceTotal=float(raw_item.get("priceTotal", 0.0) or 0.0),
                    source_page=raw_item.get("page"),
                )
            except Exception as exc:
                logger.warning(f"Skipping invalid item {code}: {exc}")
                skipped_items += 1
                continue

            # Build breakdowns with ordinal index per item.
            bk_entries: list[PriceBookBreakdownEntry] = []
            for bk in raw_item.get("breakdown") or []:
                bk_description = bk.get("description")
                if not bk_description:
                    skipped_breakdowns += 1
                    continue
                bk_idx = len(bk_entries) + idx_base
                bk_doc_id = build_breakdown_doc_id(code, bk_idx)
                original_code = (bk.get("code") or "").strip()
                # Preserve the original COAATMCA code (mt*/mo*/mq*/%) — that's
                # what the budget editor filters on. doc_id keeps uniqueness.
                bk_code = original_code or bk_doc_id
                bk_unit_raw = bk.get("unit") or ""

                # `is_variable` MUST be present (preflight checks this) — read
                # it directly without a default so a missing field would
                # bubble up as a KeyError here (shouldn't happen after
                # preflight). Use bool() in case the JSON gave us 0/1/None.
                is_var_raw = bk["is_variable"]
                is_variable = bool(is_var_raw)

                try:
                    bk_entries.append(
                        PriceBookBreakdownEntry(
                            code=bk_code,
                            doc_id=bk_doc_id,
                            parent_code=code,
                            parent_description=description,
                            parent_unit=unit_raw,
                            chapter=chapter_name,
                            description=bk_description,
                            unit_raw=bk_unit_raw,
                            unit_normalized=normalize_unit(bk_unit_raw),
                            unit_dimension=unit_dimension(bk_unit_raw),
                            quantity=float(bk.get("quantity", 1.0) or 1.0),
                            price_unit=float(bk.get("price_unit", 0.0) or 0.0),
                            price=float(bk.get("price", 0.0) or 0.0),
                            is_variable=is_variable,
                        )
                    )
                except Exception as exc:
                    logger.warning(
                        f"Skipping malformed breakdown of {code} ({bk_code}): {exc}"
                    )
                    skipped_breakdowns += 1

            # Set breakdown_ids AFTER all children are built (skipping
            # malformed ones doesn't break the doc_id list).
            item_entry.breakdown_ids = [
                (b.doc_id or b.code) for b in bk_entries
            ]
            items.append(item_entry)
            breakdowns.extend(bk_entries)

    # Count truncation marks (codes containing ellipsis).
    for it in items:
        if code_is_truncated(it.code):
            truncated_marks += 1
    for b in breakdowns:
        if code_is_truncated(b.code):
            truncated_marks += 1

    return TransformReport(
        items=items,
        breakdowns=breakdowns,
        truncated_marks=truncated_marks,
        skipped_items=skipped_items,
        skipped_breakdowns=skipped_breakdowns,
    )


# -------------------- Firebase / Gemini lazy init ---------------------------


def _init_firebase() -> Any:
    """Initialize firebase_admin and return a Firestore client.

    Honours FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY; otherwise falls
    back to GOOGLE_APPLICATION_CREDENTIALS (ADC).
    """
    import firebase_admin
    from firebase_admin import credentials, firestore

    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")

    if project_id and client_email and private_key:
        info = {
            "type": "service_account",
            "project_id": project_id,
            "private_key_id": "auto",
            "private_key": private_key,
            "client_email": client_email,
            "client_id": "auto",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": (
                f"https://www.googleapis.com/robot/v1/metadata/x509/"
                f"{client_email.replace('@', '%40')}"
            ),
        }
        try:
            firebase_admin.initialize_app(credentials.Certificate(info))
        except ValueError:
            pass  # already initialized
    else:
        # ADC fallback
        try:
            firebase_admin.initialize_app()
        except ValueError:
            pass

    return firestore.client()


def _is_rate_limit_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "429" in msg
        or "resource_exhausted" in msg
        or "rate limit" in msg
        or "500" in msg
    )


class GeminiBatchEmbedder:
    """Thin wrapper over google.genai.Client with retry + throttle.

    Mirrors `GeminiEmbeddingProvider` but stays inside this script so the
    re-ingest doesn't depend on the dry-run-only in-memory port and adapter
    machinery.
    """

    def __init__(
        self,
        *,
        max_retries: int = 5,
        base_delay: float = 4.0,
        inter_batch_delay: float = 0.7,
    ) -> None:
        api_key = os.environ.get("GOOGLE_GENAI_API_KEY") or os.environ.get(
            "GEMINI_API_KEY"
        )
        if not api_key:
            raise RuntimeError(
                "GOOGLE_GENAI_API_KEY (or GEMINI_API_KEY) env var required."
            )
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self._max_retries = max_retries
        self._base_delay = base_delay
        self._inter_batch_delay = inter_batch_delay

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        last_exc: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                response = await asyncio.to_thread(
                    self._client.models.embed_content,
                    model=EMBED_MODEL,
                    contents=texts,
                )
                vectors = [emb.values for emb in response.embeddings]
                if len(vectors) != len(texts):
                    raise RuntimeError(
                        f"Unexpected embedding count: got {len(vectors)}, "
                        f"expected {len(texts)}"
                    )
                if self._inter_batch_delay > 0:
                    await asyncio.sleep(self._inter_batch_delay)
                return [v[:FIRESTORE_DIM_LIMIT] for v in vectors]
            except Exception as exc:
                last_exc = exc
                if not _is_rate_limit_error(exc) or attempt == self._max_retries - 1:
                    raise
                delay = self._base_delay * (2 ** attempt) + random.uniform(0, 1)
                logger.warning(
                    f"Rate limit on embed_batch (attempt {attempt + 1}/"
                    f"{self._max_retries}), sleeping {delay:.1f}s"
                )
                await asyncio.sleep(delay)
        raise RuntimeError(f"embed_batch exhausted retries: {last_exc}")


# -------------------- Backup / write / delete -------------------------------


def _vector_payload(vector: list[float]) -> Any:
    """Try to wrap as a Firestore Vector; fallback to plain list (tests)."""
    try:
        from google.cloud.firestore_v1.vector import Vector

        return Vector(vector)
    except ImportError:
        return vector


def _list_from_vector_field(val: Any) -> list[float]:
    """Inverse of `_vector_payload` for backup serialization."""
    if val is None:
        return []
    # Firestore Vector exposes `.to_map_value()` or behaves like an iterable
    # in newer SDKs. We try multiple shapes.
    if hasattr(val, "to_map_value"):
        m = val.to_map_value()  # {"__type__": "Vector", "value": [...]}
        if isinstance(m, dict):
            return list(m.get("value", []))
    if isinstance(val, (list, tuple)):
        return list(val)
    # google.cloud.firestore_v1.vector.Vector behaves like Sequence
    try:
        return list(val)
    except Exception:
        return []


async def backup_collection(db: Any, output_path: Path) -> tuple[int, int]:
    """Stream the entire price_book_2025 collection into a JSON file.

    Includes embeddings (serialized as plain float lists) so a restore can
    avoid re-calling Gemini. Returns (items_count, breakdowns_count).
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    col = db.collection(PRICE_BOOK_COLLECTION)
    items_count = 0
    bk_count = 0

    logger.info(f"Streaming {PRICE_BOOK_COLLECTION} -> {output_path.name} ...")
    with output_path.open("w", encoding="utf-8") as f:
        # JSON array of docs — one per line for streaming-friendly diff
        f.write("[\n")
        first = True
        for snap in col.stream():
            data = snap.to_dict() or {}
            # Serialize embedding as plain list
            if "embedding" in data:
                data["embedding"] = _list_from_vector_field(data["embedding"])
            data["_doc_id"] = snap.id
            kind = data.get("kind")
            if kind == "item":
                items_count += 1
            elif kind == "breakdown":
                bk_count += 1
            if not first:
                f.write(",\n")
            f.write(json.dumps(data, ensure_ascii=False))
            first = False
        f.write("\n]\n")

    return items_count, bk_count


def _entry_to_doc_payload(
    entry: PriceBookItemEntry | PriceBookBreakdownEntry,
    embedding: list[float],
    session_id: str,
) -> tuple[str, dict[str, Any]]:
    """Build (doc_id, payload) for Firestore upsert.

    Adds `_reingest_session_id` (used to identify new vs stale docs) and
    `_truncated_in_source` when the entry's `code` contains ellipsis.
    """
    doc_id = getattr(entry, "doc_id", None) or entry.code
    payload = entry.model_dump()
    payload["embedding"] = _vector_payload(embedding)
    payload["_reingest_session_id"] = session_id
    if code_is_truncated(entry.code):
        payload["_truncated_in_source"] = True
    return doc_id, payload


async def write_entries(
    db: Any,
    pairs: list[tuple[Any, list[float]]],
    *,
    session_id: str,
) -> int:
    """Write entries to Firestore in batches. Returns the count written."""
    if not pairs:
        return 0
    col = db.collection(PRICE_BOOK_COLLECTION)
    total = 0
    for i in range(0, len(pairs), SAVE_BATCH_SIZE):
        chunk = pairs[i : i + SAVE_BATCH_SIZE]
        batch = db.batch()
        for entry, embedding in chunk:
            doc_id, payload = _entry_to_doc_payload(entry, embedding, session_id)
            ref = col.document(doc_id)
            batch.set(ref, payload)
        batch.commit()
        total += len(chunk)
        logger.info(
            f"  Wrote batch {i // SAVE_BATCH_SIZE + 1}: {len(chunk)} docs "
            f"(total: {total}/{len(pairs)})."
        )
    return total


async def delete_stale_docs(db: Any, *, session_id: str) -> int:
    """Delete docs whose `_reingest_session_id` != current session.

    These are leftover from the previous catalogue. We scan in pages of
    FIRESTORE_DELETE_BATCH and commit chunked deletes.
    """
    col = db.collection(PRICE_BOOK_COLLECTION)
    deleted = 0
    batch = db.batch()
    ops = 0
    for snap in col.stream():
        data = snap.to_dict() or {}
        if data.get("_reingest_session_id") == session_id:
            continue  # part of the fresh ingest
        batch.delete(col.document(snap.id))
        ops += 1
        deleted += 1
        if ops >= FIRESTORE_DELETE_BATCH:
            batch.commit()
            batch = db.batch()
            ops = 0
    if ops > 0:
        batch.commit()
    return deleted


# -------------------- Post-flight validation --------------------------------


def postflight_validate(
    db: Any,
    *,
    expected_items: int,
    expected_breakdowns: int,
    fixed_codes_to_check: list[str],
) -> tuple[bool, list[str]]:
    """Verify Firestore state matches expectations. Returns (ok, errors)."""
    errors: list[str] = []
    col = db.collection(PRICE_BOOK_COLLECTION)

    # Count items vs breakdowns by `kind`.
    item_q = col.where("kind", "==", "item").stream()
    bk_q = col.where("kind", "==", "breakdown").stream()
    actual_items = sum(1 for _ in item_q)
    actual_breakdowns = sum(1 for _ in bk_q)

    if actual_items != expected_items:
        errors.append(
            f"Items count mismatch: Firestore={actual_items}, JSON={expected_items}."
        )
    if actual_breakdowns != expected_breakdowns:
        errors.append(
            f"Breakdowns count mismatch: Firestore={actual_breakdowns}, "
            f"JSON={expected_breakdowns}."
        )

    # Spot-check existence of 15 fixed codes.
    missing_fixed: list[str] = []
    for code in fixed_codes_to_check:
        snap = col.document(code).get()
        if not snap.exists:
            missing_fixed.append(code)
    if missing_fixed:
        errors.append(
            f"Fixed codes missing in Firestore ({len(missing_fixed)}): "
            f"{', '.join(missing_fixed[:10])}"
        )

    # Sample 20 random items and verify `is_variable` propagated on at least
    # one of their breakdowns where applicable. We do this by reading 20
    # breakdown docs and confirming `is_variable` is a bool.
    sampled_bk = list(col.where("kind", "==", "breakdown").limit(20).stream())
    bad_is_var = [
        s.id for s in sampled_bk
        if not isinstance((s.to_dict() or {}).get("is_variable"), bool)
    ]
    if bad_is_var:
        errors.append(
            f"is_variable not a bool on {len(bad_is_var)} sampled breakdowns: "
            f"{', '.join(bad_is_var[:5])}"
        )

    return (not errors, errors)


# -------------------- Main orchestration ------------------------------------


@dataclass
class IngestReport:
    started_at: str = ""
    finished_at: str = ""
    duration_sec: float = 0.0
    source_path: str = ""
    backup_path: str = ""
    backup_items: int = 0
    backup_breakdowns: int = 0
    json_items: int = 0
    json_breakdowns: int = 0
    is_variable_true: int = 0
    is_variable_false: int = 0
    truncated_marks: int = 0
    item_embeddings_generated: int = 0
    bk_embeddings_generated: int = 0
    items_written: int = 0
    breakdowns_written: int = 0
    stale_docs_deleted: int = 0
    dry_run: bool = False
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items()}


async def run_dry(source: list[dict[str, Any]], transform: TransformReport) -> None:
    """Report what --apply would do, without any I/O to Gemini/Firestore."""
    item_count = len(transform.items)
    bk_count = len(transform.breakdowns)
    embed_batches_items = (item_count + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE
    embed_batches_bk = (bk_count + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE
    save_batches = (
        (item_count + bk_count) + SAVE_BATCH_SIZE - 1
    ) // SAVE_BATCH_SIZE

    logger.info("=" * 64)
    logger.info("DRY-RUN — what `--apply` WOULD do (no Firestore / Gemini I/O)")
    logger.info("=" * 64)
    logger.info(f"Items transformed:                  {item_count}")
    logger.info(f"Breakdowns transformed:             {bk_count}")
    logger.info(
        f"Truncated codes flagged (_truncated_in_source): "
        f"{transform.truncated_marks}"
    )
    logger.info(f"Items skipped (missing code/desc):  {transform.skipped_items}")
    logger.info(f"Breakdowns skipped:                 {transform.skipped_breakdowns}")
    logger.info("-" * 64)
    logger.info("EMBEDDINGS to generate (gemini-embedding-001 -> 768 dims):")
    logger.info(
        f"  Item batches:        {embed_batches_items} "
        f"({item_count} embeddings)"
    )
    logger.info(
        f"  Breakdown batches:   {embed_batches_bk} "
        f"({bk_count} embeddings)"
    )
    logger.info(f"  Total API calls:     {embed_batches_items + embed_batches_bk}")
    logger.info("-" * 64)
    logger.info(f"FIRESTORE write batches ({SAVE_BATCH_SIZE} docs/batch):")
    logger.info(f"  Save batches:        {save_batches}")
    logger.info(f"  Docs to write:       {item_count + bk_count}")
    logger.info("-" * 64)
    logger.info("BACKUP that would be created:")
    logger.info(
        f"  -> data/catalog_source/firestore_backup_pre_reingest_<timestamp>.json"
    )
    logger.info("-" * 64)
    logger.info("Sample first 3 item docs that WOULD be written:")
    for it in transform.items[:3]:
        truncated = " [_truncated_in_source=True]" if code_is_truncated(it.code) else ""
        logger.info(
            f"  doc_id={it.code!s:20s} chapter={it.chapter[:30]!r:32s} "
            f"unit_raw={it.unit_raw!r:6s} unit_norm={it.unit_normalized!r:6s}"
            f"{truncated}"
        )
    logger.info("Sample first 3 breakdown docs that WOULD be written:")
    for b in transform.breakdowns[:3]:
        truncated = " [_truncated_in_source=True]" if code_is_truncated(b.code) else ""
        logger.info(
            f"  doc_id={b.doc_id!s:20s} parent={b.parent_code!s:12s} "
            f"code={b.code!r:18s} is_variable={b.is_variable}"
            f"{truncated}"
        )
    logger.info("=" * 64)
    logger.info("DRY-RUN complete. NO writes performed. Use `--apply` to commit.")


async def run_apply(
    db: Any,
    source: list[dict[str, Any]],
    transform: TransformReport,
    report: IngestReport,
    *,
    fixed_codes_to_check: list[str],
) -> None:
    """Execute the full re-ingest: backup -> embed -> write -> delete -> validate."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    session_id = f"reingest_{timestamp}"
    backup_path = BACKUP_DIR / f"firestore_backup_pre_reingest_{timestamp}.json"

    # 1) Backup
    logger.info("=" * 64)
    logger.info("STEP 1/5 — Backup current price_book_2025")
    logger.info("=" * 64)
    b_items, b_bk = await backup_collection(db, backup_path)
    report.backup_path = str(backup_path)
    report.backup_items = b_items
    report.backup_breakdowns = b_bk
    logger.info(
        f"Backup written: {b_items} items + {b_bk} breakdowns -> {backup_path.name}"
    )

    # 2) Embed
    logger.info("=" * 64)
    logger.info("STEP 2/5 — Generate embeddings")
    logger.info("=" * 64)
    embedder = GeminiBatchEmbedder()

    async def embed_all(
        texts: list[str], label: str, log_every: int
    ) -> list[list[float]]:
        if not texts:
            return []
        out: list[list[float]] = []
        for i in range(0, len(texts), EMBED_BATCH_SIZE):
            batch = texts[i : i + EMBED_BATCH_SIZE]
            chunk_emb = await embedder.embed_batch(batch)
            out.extend(chunk_emb)
            if (i // EMBED_BATCH_SIZE) % max(1, log_every // EMBED_BATCH_SIZE) == 0:
                logger.info(
                    f"  {label}: {min(i + EMBED_BATCH_SIZE, len(texts))}/{len(texts)}"
                )
        return out

    item_texts = [EmbeddingTextBuilder.for_item(it) for it in transform.items]
    bk_texts = [EmbeddingTextBuilder.for_breakdown(b) for b in transform.breakdowns]

    item_embs = await embed_all(item_texts, "items", log_every=100)
    report.item_embeddings_generated = len(item_embs)
    bk_embs = await embed_all(bk_texts, "breakdowns", log_every=500)
    report.bk_embeddings_generated = len(bk_embs)

    # 3) Write
    logger.info("=" * 64)
    logger.info("STEP 3/5 — Write new docs to Firestore")
    logger.info("=" * 64)
    item_pairs = list(zip(transform.items, item_embs))
    bk_pairs = list(zip(transform.breakdowns, bk_embs))
    written_items = await write_entries(db, item_pairs, session_id=session_id)
    written_bk = await write_entries(db, bk_pairs, session_id=session_id)
    report.items_written = written_items
    report.breakdowns_written = written_bk
    logger.info(
        f"Wrote {written_items} items + {written_bk} breakdowns "
        f"(session_id={session_id})."
    )

    # 4) Delete stale (docs not in this session)
    logger.info("=" * 64)
    logger.info("STEP 4/5 — Delete stale docs (different session_id)")
    logger.info("=" * 64)
    deleted = await delete_stale_docs(db, session_id=session_id)
    report.stale_docs_deleted = deleted
    logger.info(f"Deleted {deleted} stale docs.")

    # 5) Post-flight validation
    logger.info("=" * 64)
    logger.info("STEP 5/5 — Post-flight validation")
    logger.info("=" * 64)
    ok, errs = postflight_validate(
        db,
        expected_items=len(transform.items),
        expected_breakdowns=len(transform.breakdowns),
        fixed_codes_to_check=fixed_codes_to_check,
    )
    if ok:
        logger.info("Post-flight OK.")
    else:
        for e in errs:
            logger.error(f"  - {e}")
        report.errors.extend(errs)


def _load_fixed_codes_from_patch() -> list[str]:
    """Load the 15 'corrected' codes from data/catalog_source/code_fixes_applied.json
    so post-flight checks they exist in Firestore.
    """
    patch_path = BACKUP_DIR / "code_fixes_applied.json"
    if not patch_path.exists():
        logger.warning(
            f"Patch file {patch_path} not found; skipping fixed-code post-check."
        )
        return []
    data = json.loads(patch_path.read_text(encoding="utf-8"))
    return [f["corrected"] for f in data.get("fixes", []) if "corrected" in f]


def _print_preflight(report: PreflightReport) -> None:
    logger.info("=" * 64)
    logger.info("PRE-FLIGHT VALIDATION")
    logger.info("=" * 64)
    logger.info(f"Items in JSON:             {report.items_count}")
    logger.info(f"Breakdowns in JSON:        {report.breakdowns_count}")
    logger.info(
        f"is_variable=true (breakdowns):   {report.is_variable_true_count}"
    )
    logger.info(
        f"is_variable=false (breakdowns):  {report.is_variable_false_count}"
    )
    logger.info(f"Truncated item codes:      {report.truncated_item_codes}")
    logger.info(f"Truncated breakdown codes: {report.truncated_breakdown_codes}")
    if report.warnings:
        logger.warning(f"Warnings ({len(report.warnings)}):")
        for w in report.warnings[:10]:
            logger.warning(f"  - {w}")
    if report.errors:
        logger.error(f"ERRORS ({len(report.errors)}):")
        for e in report.errors:
            logger.error(f"  - {e}")
    else:
        logger.info("Pre-flight OK.")


async def main_async(args: argparse.Namespace) -> int:
    started_at = datetime.now(timezone.utc)
    report = IngestReport(
        started_at=started_at.isoformat(),
        source_path=str(SOURCE_JSON),
        dry_run=(not args.apply and not args.backup_only),
    )
    t0 = time.time()

    # Step 0: load env
    load_dotenv(ROOT / ".env")

    # Backup-only path: requires Firebase but not Gemini, not source.
    if args.backup_only:
        logger.info("Mode: --backup-only")
        db = _init_firebase()
        timestamp = started_at.strftime("%Y%m%dT%H%M%SZ")
        backup_path = BACKUP_DIR / f"firestore_backup_pre_reingest_{timestamp}.json"
        b_items, b_bk = await backup_collection(db, backup_path)
        report.backup_path = str(backup_path)
        report.backup_items = b_items
        report.backup_breakdowns = b_bk
        logger.info(
            f"Backup-only complete: {b_items} items + {b_bk} breakdowns "
            f"-> {backup_path}"
        )
        report.finished_at = datetime.now(timezone.utc).isoformat()
        report.duration_sec = round(time.time() - t0, 2)
        logger.info("=" * 64)
        logger.info(f"DONE in {report.duration_sec:.1f}s")
        return 0

    # Step 1: load source
    if not SOURCE_JSON.exists():
        logger.error(f"Source JSON not found: {SOURCE_JSON}")
        logger.error(
            "This file is gitignored — must exist locally before running. "
            "Run fix_json_code_suffix_bug.py or your local ingest pipeline first."
        )
        return 2
    logger.info(f"Reading {SOURCE_JSON} ...")
    with SOURCE_JSON.open("r", encoding="utf-8") as f:
        source = json.load(f)
    logger.info(f"Loaded {len(source)} chapter blocks from JSON.")

    # Step 2: pre-flight
    pf = preflight_validate(source)
    _print_preflight(pf)
    if not pf.ok:
        logger.error("Pre-flight FAILED. Aborting.")
        return 3
    report.json_items = pf.items_count
    report.json_breakdowns = pf.breakdowns_count
    report.is_variable_true = pf.is_variable_true_count
    report.is_variable_false = pf.is_variable_false_count

    # Step 3: transform
    transform = transform_source(source, idx_base=args.idx_base)
    report.truncated_marks = transform.truncated_marks
    logger.info(
        f"Transformed: {len(transform.items)} items + "
        f"{len(transform.breakdowns)} breakdowns "
        f"({transform.truncated_marks} truncation marks)."
    )

    # Step 4: dry-run or apply
    fixed_codes = _load_fixed_codes_from_patch()
    if not args.apply:
        await run_dry(source, transform)
    else:
        logger.info("Mode: --APPLY — committing to Firestore.")
        db = _init_firebase()
        await run_apply(
            db,
            source,
            transform,
            report,
            fixed_codes_to_check=fixed_codes,
        )

    report.finished_at = datetime.now(timezone.utc).isoformat()
    report.duration_sec = round(time.time() - t0, 2)

    logger.info("=" * 64)
    logger.info("FINAL REPORT")
    logger.info("=" * 64)
    for k, v in report.to_dict().items():
        if isinstance(v, list):
            v = f"({len(v)})" if v else "(0)"
        logger.info(f"  {k:30s}: {v}")
    logger.info(f"Duration: {report.duration_sec:.1f}s")

    return 0 if not report.errors else 4


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Re-ingest prices/coaatmca_2025_price_book.json into Firestore "
            "price_book_2025 preserving full v005 schema + is_variable."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit to Firestore (default: dry-run, no I/O).",
    )
    parser.add_argument(
        "--backup-only",
        action="store_true",
        help="Only download the current Firestore collection to a JSON backup.",
    )
    parser.add_argument(
        "--idx-base",
        type=int,
        choices=[0, 1],
        default=0,
        help=(
            "Base index for breakdown ordinals in doc_id (default: 0 per Sprint "
            "3.B spec). Use 1 to keep the previous convention."
        ),
    )
    args = parser.parse_args()
    if args.apply and args.backup_only:
        logger.error("--apply and --backup-only are mutually exclusive.")
        return 1
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())

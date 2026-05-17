"""Shared Firebase Admin bootstrap.

Extracted from `src/core/http/main.py` (lines 24-50 of the original) so the
HTTP Service and the Cloud Run Job worker share the same initialisation
logic. `init_firebase_admin` is idempotent: calling it twice returns the
existing app instead of crashing.
"""

from __future__ import annotations

import logging
import os
from typing import Mapping, Optional

import firebase_admin
from firebase_admin import credentials

logger = logging.getLogger(__name__)


def init_firebase_admin(env: Optional[Mapping[str, str]] = None) -> None:
    """Initialise the Firebase Admin SDK once per process.

    Reads service-account credentials from env vars; falls back to
    Application Default Credentials (Cloud Run / gcloud auth) when any of
    them are missing. This mirrors the legacy behaviour of `http/main.py`
    so the worker doesn't need new env vars in production.
    """
    if firebase_admin._apps:  # noqa: SLF001 — public-API alternative is async
        return

    env = env if env is not None else os.environ

    project_id = env.get("FIREBASE_PROJECT_ID")
    client_email = env.get("FIREBASE_CLIENT_EMAIL")
    private_key = env.get("FIREBASE_PRIVATE_KEY")

    if project_id and client_email and private_key:
        logger.info("init_firebase_admin: using service account from env")
        # The private key is stored with literal `\n` escapes in env vars —
        # JSON parsers turn them back into actual newlines, but env vars
        # don't, so we do it explicitly.
        formatted_private_key = private_key.replace("\\n", "\n")
        cred = credentials.Certificate(
            {
                "type": "service_account",
                "project_id": project_id,
                "private_key_id": env.get("FIREBASE_PRIVATE_KEY_ID", ""),
                "private_key": formatted_private_key,
                "client_email": client_email,
                "client_id": env.get("FIREBASE_CLIENT_ID", ""),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": (
                    "https://www.googleapis.com/oauth2/v1/certs"
                ),
                "client_x509_cert_url": (
                    "https://www.googleapis.com/robot/v1/metadata/x509/"
                    + client_email.replace("@", "%40")
                ),
            }
        )
        firebase_admin.initialize_app(cred)
    else:
        logger.info(
            "init_firebase_admin: using Application Default Credentials"
        )
        firebase_admin.initialize_app()

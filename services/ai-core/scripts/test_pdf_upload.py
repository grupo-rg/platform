"""Smoke test del endpoint PDF → Budget.

Sube un PDF real al endpoint `/api/v1/jobs/measurements`, consulta la telemetría
que se acumula en Firestore y verifica:
  1. Auth + payload correctos (202 Accepted).
  2. La extracción completa sin colgar (aparece `budget_completed` en ≤10 min).
  3. Si hubo páginas densas: aparecen `extraction_partial_success` (rescate por salvage)
     o `extraction_retry_minimal` sin abortar el job.

Uso:
    # Local (uvicorn en :8080)
    python scripts/test_pdf_upload.py \\
        --url http://localhost:8080 \\
        --token $INTERNAL_WORKER_TOKEN \\
        --pdf ruta/al/estado-mediciones.pdf \\
        --strategy INLINE

    # Cloud Run
    python scripts/test_pdf_upload.py \\
        --url https://ai-core-....europe-southwest1.run.app \\
        --token $INTERNAL_WORKER_TOKEN \\
        --pdf ruta/al/estado-mediciones.pdf

El script es idempotente: cada ejecución usa un `budget_id` nuevo.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

import httpx


def poll_events(base_url: str, budget_id: str, timeout_s: int = 600) -> List[Dict[str, Any]]:
    """Consulta directa a Firestore no es posible desde el script sin credenciales.
    Emulamos la lectura conectándonos al endpoint SSE público del Next (si está).
    Para este smoke asumimos que el usuario valida manualmente en la consola de Firestore.

    Esta función hace sleep para dar tiempo al job y luego recuerda al operador
    cómo inspeccionar. Si tienes SSE configurado y expuesto, puedes conectar aquí.
    """
    print(f"\n⏳ Esperando ~{timeout_s}s para que el job termine en background…")
    print(f"   Puedes seguir la telemetría en tiempo real en Firestore:")
    print(f"   Colección: pipeline_telemetry/{budget_id}/events")
    print(f"   O en el panel admin: /dashboard/admin/pipelines/{budget_id}")
    time.sleep(min(timeout_s, 20))  # espera corta por defecto
    return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="Base URL del ai-core (local o Cloud Run)")
    parser.add_argument("--token", default=os.environ.get("INTERNAL_WORKER_TOKEN", ""), help="INTERNAL_WORKER_TOKEN")
    parser.add_argument("--pdf", required=True, help="Ruta al PDF del estado de mediciones")
    parser.add_argument("--strategy", default="INLINE", choices=["INLINE", "ANNEXED"])
    parser.add_argument("--lead-id", default="smoke-runner")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f"❌ PDF no encontrado: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    budget_id = f"smoke-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    url = f"{args.url.rstrip('/')}/api/v1/jobs/measurements"

    print(f"\n🧪 Subiendo PDF: {pdf_path.name}")
    print(f"   URL:       {url}")
    print(f"   leadId:    {args.lead_id}")
    print(f"   budgetId:  {budget_id}")
    print(f"   strategy:  {args.strategy}")

    headers = {}
    if args.token:
        headers["x-internal-token"] = args.token

    with open(pdf_path, "rb") as f:
        files = {"file": (pdf_path.name, f, "application/pdf")}
        data = {
            "leadId": args.lead_id,
            "budgetId": budget_id,
            "strategy": args.strategy,
        }
        try:
            r = httpx.post(url, files=files, data=data, headers=headers, timeout=60.0)
        except httpx.HTTPError as e:
            print(f"\n❌ Fallo de red: {e}", file=sys.stderr)
            sys.exit(2)

    if r.status_code == 401:
        print(f"\n❌ 401 Unauthorized — revisa que INTERNAL_WORKER_TOKEN coincide entre Next/Python.", file=sys.stderr)
        sys.exit(3)
    if r.status_code != 202:
        print(f"\n❌ Respuesta inesperada: {r.status_code}")
        print(r.text)
        sys.exit(4)

    body = r.json()
    print(f"\n✅ 202 Accepted")
    print(f"   Response: {body}")

    # Seguimiento (instrucciones al operador)
    poll_events(args.url, budget_id, timeout_s=600)

    print(f"\n📋 Checklist manual post-smoke:")
    print(f"   [ ] Cloud Run logs: ¿aparecen retries del schema completo o todo limpio?")
    print(f"   [ ] Firestore `pipeline_telemetry/{budget_id}/events`:")
    print(f"       [ ] Hay `extraction_started` y `subtasks_extracted`")
    print(f"       [ ] Si hubo truncamiento: `extraction_partial_success` (salvage) o `extraction_retry_minimal`")
    print(f"       [ ] Termina con `budget_completed`")
    print(f"   [ ] Firestore `budgets/{budget_id}`: tiene chapters con items reales con precios")
    print(f"\n   Duración esperada: 1–3 min para PDFs limpios, hasta 5 min para PDFs muy densos.")


if __name__ == "__main__":
    main()

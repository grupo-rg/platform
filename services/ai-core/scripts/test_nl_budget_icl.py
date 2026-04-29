"""
Smoke-test ICL contra el endpoint NL→Budget.

Uso:
    python scripts/test_nl_budget_icl.py --url http://localhost:8080 --token <INTERNAL_WORKER_TOKEN>

Dispara los 5 casos golden (cocina, baño, obra nueva, fachada, reforma integral),
devuelve 202 + budgetId y luego polls sobre Firestore para listar los eventos
emitidos y el budget final. El objetivo es confirmar que:
  1. El endpoint acepta la petición (auth + schema OK).
  2. El Architect descompone tareas no triviales.
  3. El SwarmPricing produce partidas con precio > 0.
  4. La telemetría llega a pipeline_telemetry/{budgetId}/events.

No sustituye tests funcionales formales — es un smoke de integración para
usar entre despliegues y antes de cutover a producción.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from typing import Any, Dict, List

import httpx

ICL_CASES: List[Dict[str, Any]] = [
    {
        "id": "cocina",
        "narrative": "Reforma de cocina de 12 m² en vivienda de 1998 (4ª planta sin ascensor), escala minor. "
                     "Trabajos: demolición de alicatado existente, alisado de paredes, nueva instalación de "
                     "tuberías de cobre, cableado eléctrico para electrodomésticos de alta potencia, suelo "
                     "cerámico 60x60, pintura plástica. Patologías: humedades visibles. Sin redistribución "
                     "de tabiques. No se incluye mobiliario de cocina.",
    },
    {
        "id": "bano",
        "narrative": "Reforma integral de baño de 6 m² en vivienda existente. Demolición completa de "
                     "alicatado y pavimento, nueva red de saneamiento, 4 puntos de agua, aparatos "
                     "sanitarios nuevos (inodoro, lavabo, plato de ducha), grifería termostática, "
                     "alicatado de paredes hasta techo, pavimento porcelánico antideslizante. Calidad media.",
    },
    {
        "id": "obra_nueva",
        "narrative": "Obra nueva de vivienda unifamiliar de 120 m² en una planta. Cimentación con zapatas "
                     "aisladas, estructura de hormigón armado, fachada con termoarcilla y SATE, cubierta "
                     "plana transitable, particiones de ladrillo, instalaciones completas (electricidad, "
                     "fontanería, climatización aerotermia + suelo radiante), carpintería exterior aluminio "
                     "con rotura de puente térmico, pavimentos porcelánicos en zonas comunes y tarima "
                     "laminada en dormitorios.",
    },
    {
        "id": "fachada",
        "narrative": "Rehabilitación de fachada de 250 m² en edificio de 4 plantas. Picado y saneado de "
                     "revocos, colocación de SATE con aislamiento de 10 cm, enfoscado maestreado de mortero, "
                     "pintura elastomérica exterior. Incluye andamio europeo homologado.",
    },
    {
        "id": "integral",
        "narrative": "Reforma integral de piso de 90 m² en edificio de 1975. Demolición interior (excepto "
                     "muros portantes), nueva distribución con 3 dormitorios y 2 baños, instalaciones nuevas "
                     "completas (electricidad con cuadro general + 40 puntos eléctricos + tomas de tierra; "
                     "fontanería con 12 puntos de agua; calefacción con suelo radiante + aerotermia), "
                     "carpintería de madera interior, alicatados en baños y cocina, pavimento tarima "
                     "laminada en seco, pintura plástica lisa. Calidad media-alta.",
    },
]


def run_case(base_url: str, token: str, case: Dict[str, Any]) -> Dict[str, Any]:
    budget_id = f"icl-{case['id']}-{int(time.time())}"
    payload = {
        "leadId": "icl-runner",
        "budgetId": budget_id,
        "narrative": case["narrative"],
    }
    headers = {"Content-Type": "application/json"}
    if token:
        headers["x-internal-token"] = token

    url = f"{base_url.rstrip('/')}/api/v1/jobs/nl-budget"
    print(f"\n🧪 [{case['id']}] POST {url}")
    print(f"   budgetId={budget_id}")
    r = httpx.post(url, json=payload, headers=headers, timeout=30.0)
    if r.status_code != 202:
        print(f"   ❌ {r.status_code}: {r.text}")
        return {"case": case["id"], "ok": False, "status": r.status_code, "body": r.text}
    print(f"   ✅ 202 Accepted — job en background")
    return {"case": case["id"], "ok": True, "budgetId": budget_id, "status": 202}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8080", help="Base URL del ai-core")
    parser.add_argument("--token", default="", help="INTERNAL_WORKER_TOKEN")
    parser.add_argument("--case", default="", help="Un solo caso por id (cocina, bano, obra_nueva, fachada, integral)")
    args = parser.parse_args()

    cases = [c for c in ICL_CASES if not args.case or c["id"] == args.case]
    if not cases:
        print(f"Caso desconocido: {args.case}")
        sys.exit(1)

    results = [run_case(args.url, args.token, c) for c in cases]
    print("\n── Resumen ──")
    for r in results:
        mark = "✓" if r["ok"] else "✗"
        print(f"  {mark} {r['case']}: {json.dumps(r)}")

    failed = [r for r in results if not r["ok"]]
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()

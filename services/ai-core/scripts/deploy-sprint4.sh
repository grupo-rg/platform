#!/usr/bin/env bash
# Sprint 4 — deploy del ai-core (Service + Job) con las env vars del parser
# TABULAR coord-based + A9 anomaly detection.
#
# Pasos:
#   1. cloudbuild submit (build + push + deploy Service + deploy Job).
#   2. Actualiza env vars Sprint 4 en Service Y Job.
#   3. Verifica health del Service.
#   4. Reporta URL del Service + nombre del Job.
#
# Uso:
#   bash services/ai-core/scripts/deploy-sprint4.sh
#   bash services/ai-core/scripts/deploy-sprint4.sh --no-tabular   # deploy con USE_TABULAR_PARSER=false
#   bash services/ai-core/scripts/deploy-sprint4.sh --build-only   # solo build, no toca env vars
#
# Requisitos:
#   - gcloud autenticado con permisos sobre grupo-rg-a9929.
#   - Estar dentro del repo (cwd = repo root o services/ai-core).
#
# IMPORTANTE: este script NO toca env vars sensibles (FIREBASE_*, GENAI_API,
# QDRANT_*, INTERNAL_WORKER_TOKEN). Solo añade las nuevas de Sprint 4.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-grupo-rg-a9929}"
REGION="${REGION:-europe-southwest1}"
SERVICE_NAME="${SERVICE_NAME:-ai-core}"
JOB_NAME="${JOB_NAME:-ai-core-worker}"

# Sprint 4 env vars — defaults conservadores.
USE_TABULAR_PARSER="${USE_TABULAR_PARSER:-true}"
MAX_LLM_VISION_PAGES="${MAX_LLM_VISION_PAGES:-50}"

# Modo
NO_TABULAR=false
BUILD_ONLY=false
for arg in "$@"; do
    case "$arg" in
        --no-tabular)
            USE_TABULAR_PARSER="false"
            NO_TABULAR=true
            ;;
        --build-only)
            BUILD_ONLY=true
            ;;
        --help|-h)
            grep '^#' "$0" | head -25
            exit 0
            ;;
    esac
done

# Localiza el directorio del script y el repo root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_CORE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${AI_CORE_DIR}/../.." && pwd)"

echo "==============================================================="
echo "Sprint 4 deploy — ai-core"
echo "==============================================================="
echo "PROJECT_ID:           ${PROJECT_ID}"
echo "REGION:               ${REGION}"
echo "SERVICE_NAME:         ${SERVICE_NAME}"
echo "JOB_NAME:             ${JOB_NAME}"
echo "USE_TABULAR_PARSER:   ${USE_TABULAR_PARSER}"
echo "MAX_LLM_VISION_PAGES: ${MAX_LLM_VISION_PAGES}"
echo "MODE:                 $([ "$BUILD_ONLY" = "true" ] && echo 'build-only' || echo 'full deploy')"
echo "==============================================================="
echo ""

# Pre-flight: verificar que estamos autenticados.
if ! gcloud config get-value project 2>/dev/null | grep -q .; then
    echo "[ERROR] gcloud no autenticado. Corré 'gcloud auth login' primero." >&2
    exit 1
fi

CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "${CURRENT_PROJECT}" != "${PROJECT_ID}" ]; then
    echo "[WARN] gcloud project actual es '${CURRENT_PROJECT}', no '${PROJECT_ID}'."
    read -r -p "¿Continuar igual? (yes/NO): " confirm
    if [ "${confirm}" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi
fi

# -----------------------------------------------------------------------
# Paso 1: cloudbuild (build + push + deploy Service + deploy Job)
# -----------------------------------------------------------------------
echo "[1/3] Cloud Build submit (esto puede tardar 8-12 min — incluye descarga BGE)"
cd "${AI_CORE_DIR}"
gcloud builds submit \
    --config "${AI_CORE_DIR}/cloudbuild.yaml" \
    --substitutions="_REGION=${REGION},_SERVICE_NAME=${SERVICE_NAME},_JOB_NAME=${JOB_NAME}" \
    --project="${PROJECT_ID}" \
    "${AI_CORE_DIR}"
cd "${REPO_ROOT}"

if [ "${BUILD_ONLY}" = "true" ]; then
    echo ""
    echo "[OK] Build-only mode — env vars no tocadas."
    exit 0
fi

# -----------------------------------------------------------------------
# Paso 2: env vars Sprint 4 — Service Y Job
# -----------------------------------------------------------------------
echo ""
echo "[2/3] Actualizando env vars Sprint 4 en Service '${SERVICE_NAME}'..."
gcloud run services update "${SERVICE_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --update-env-vars="USE_TABULAR_PARSER=${USE_TABULAR_PARSER},MAX_LLM_VISION_PAGES=${MAX_LLM_VISION_PAGES}" \
    --quiet

echo ""
echo "[2/3] Actualizando env vars Sprint 4 en Job '${JOB_NAME}'..."
gcloud run jobs update "${JOB_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --update-env-vars="USE_TABULAR_PARSER=${USE_TABULAR_PARSER},MAX_LLM_VISION_PAGES=${MAX_LLM_VISION_PAGES}" \
    --quiet

# -----------------------------------------------------------------------
# Paso 3: health check + reporte
# -----------------------------------------------------------------------
echo ""
echo "[3/3] Verificando deploy..."

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format='value(status.url)')

echo "  Service URL: ${SERVICE_URL}"

# Health check (espera hasta 30s al primer arranque cold).
echo "  Probando /health ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "${SERVICE_URL}/health" || echo "000")
if [ "${HTTP_CODE}" = "200" ]; then
    echo "  [OK] /health → 200"
else
    echo "  [WARN] /health → ${HTTP_CODE}. Verificá manualmente: ${SERVICE_URL}/health"
fi

# Verificar env vars del Service
echo ""
echo "  Verificando env vars del Service:"
gcloud run services describe "${SERVICE_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format='value(spec.template.spec.containers[0].env[?(@.name=="USE_TABULAR_PARSER")].value,spec.template.spec.containers[0].env[?(@.name=="MAX_LLM_VISION_PAGES")].value)' \
    | sed 's/^/    /'

# Verificar env vars del Job
echo ""
echo "  Verificando env vars del Job:"
gcloud run jobs describe "${JOB_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format='value(spec.template.spec.template.spec.containers[0].env[?(@.name=="USE_TABULAR_PARSER")].value,spec.template.spec.template.spec.containers[0].env[?(@.name=="MAX_LLM_VISION_PAGES")].value)' \
    | sed 's/^/    /'

echo ""
echo "==============================================================="
echo "[OK] Sprint 4 deploy completado."
echo "==============================================================="
echo ""
echo "Siguiente paso: smoke desde la UI/UX en producción."
echo "  - Frontend espera AI_CORE_URL=${SERVICE_URL}"
echo "  - Job: projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}"
echo ""
echo "Rollback Sprint 4 (si algo falla):"
echo "  bash $0 --no-tabular"
echo ""
echo "Logs útiles:"
echo "  gcloud run services logs read ${SERVICE_NAME} --region=${REGION} --limit=50"
echo "  gcloud run jobs executions list --job=${JOB_NAME} --region=${REGION} --limit=10"

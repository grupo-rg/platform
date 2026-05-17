# ai-core deploy & infra

Operational guide for the rearchitected pipeline-jobs deployment (Service
dispatcher + Cloud Run Jobs worker). Read together with the design plan
at `~/.claude/plans/vmaos-a-resolverlo-de-quiet-narwhal.md`.

## TL;DR

```bash
# One-time (idempotent)
bash services/ai-core/scripts/setup-infrastructure.sh

# Each release
gcloud builds submit \
  --config services/ai-core/cloudbuild.yaml \
  services/ai-core

# Verify end-to-end after deploy
AI_CORE_URL=https://ai-core-XXXX.europe-southwest1.run.app \
INTERNAL_WORKER_TOKEN=$(gcloud run services describe ai-core \
  --region=europe-southwest1 --format='value(spec.template.spec.containers[0].env)' \
  | grep INTERNAL_WORKER_TOKEN | cut -d= -f2) \
bash services/ai-core/scripts/smoke-test-dispatch.sh
```

## Architecture in one paragraph

The HTTP **Service** `ai-core` only dispatches: `POST /api/v1/jobs/dispatch`
creates a `pipeline_jobs/{jobId}` doc in Firestore, calls the Cloud Run
Jobs API to start an execution of the **Job** `ai-core-worker`, and returns
202 immediately (timeout 60s — there's no long work). The **Job** is the
same Docker image with a different `command`: `python -m
src.core.jobs.worker_main`. It reads `JOB_ID` from its env, runs the budget
pipeline (up to 24h), persists checkpoints in `pipeline_jobs/{jobId}/checkpoints/`,
and exits. The UI subscribes to `pipeline_telemetry/{jobId}/events` (SSE,
unchanged) plus `pipeline_jobs/{jobId}` (new, for status/attempts/cancel).

## First-time setup

`scripts/setup-infrastructure.sh` creates / configures:

1. Artifact Registry repo `ai-core` (region `europe-southwest1`).
2. Service account `ai-core-worker-sa@<project>.iam.gserviceaccount.com`
   with `roles/datastore.user`, `roles/logging.logWriter`,
   `roles/monitoring.metricWriter`.
3. Storage bucket `gs://<project>-pipeline-uploads` with a lifecycle rule
   deleting `pipeline_uploads/*` after 7 days, plus
   `roles/storage.objectViewer` for the worker SA.
4. `roles/run.invoker` on the `ai-core-worker` Job for the existing
   `firebase-adminsdk-fbsvc` service account (the one the dispatcher
   Service runs as). This binding only lands if the Job already exists —
   on a fresh project, the first build creates the Job, then re-run
   `setup-infrastructure.sh` to apply the binding.

Idempotent: re-running detects existing resources and only fills gaps.

## Env vars

### Cloud Run **Service** (`ai-core`)

| Var                       | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`     | Firestore project — used by `init_firebase_admin`               |
| `FIREBASE_CLIENT_EMAIL`   | Service account email for Firebase Admin                        |
| `FIREBASE_PRIVATE_KEY`    | PEM with literal `\n` escapes                                   |
| `GOOGLE_GENAI_API_KEY`    | Gemini API key                                                  |
| `INTERNAL_WORKER_TOKEN`   | Shared secret with the Next.js side (Server Action → ai-core)   |
| `QDRANT_URL`, `QDRANT_API_KEY` | Vector DB (existing usage, unchanged)                      |
| `WORKER_JOB_NAME`         | **NEW.** Full resource path of the worker Job. Set by `cloudbuild.yaml` to `projects/<id>/locations/europe-southwest1/jobs/ai-core-worker`. The dispatcher reads it to know what to fire. |

### Cloud Run **Job** (`ai-core-worker`)

Same set of vars as the Service except `WORKER_JOB_NAME` and
`INTERNAL_WORKER_TOKEN` (the Job never receives HTTP requests). Plus:

| Var                              | Default | Purpose                                          |
| -------------------------------- | ------- | ------------------------------------------------ |
| `PIPELINE_HEARTBEAT_SECONDS`     | `30`    | How often the worker bumps `updatedAt`           |
| `PIPELINE_CANCEL_POLL_SECONDS`   | `5`     | How often the worker re-reads `cancellation_requested` |

Cloud Run Jobs ALSO injects automatically:

- `CLOUD_RUN_EXECUTION` (full execution name; logged by the worker)
- `CLOUD_RUN_TASK_INDEX`, `CLOUD_RUN_TASK_ATTEMPT`, `CLOUD_RUN_TASK_COUNT`

Plus our own injection via `--overrides`:

- `JOB_ID` (the `pipeline_jobs/{jobId}` document id — the worker's entire
  reason for existing)

## Setting env vars on a deployed resource

The cloudbuild.yaml deliberately does NOT set sensitive env vars. Set them
once on each resource, then redeploys preserve them:

```bash
# Service
gcloud run services update ai-core \
  --region=europe-southwest1 \
  --update-env-vars=FIREBASE_PROJECT_ID=grupo-rg-a9929,GOOGLE_GENAI_API_KEY=...,...

# Job
gcloud run jobs update ai-core-worker \
  --region=europe-southwest1 \
  --update-env-vars=FIREBASE_PROJECT_ID=grupo-rg-a9929,GOOGLE_GENAI_API_KEY=...,...
```

For `FIREBASE_PRIVATE_KEY`, keep the literal `\n` escapes — the
`init_firebase_admin` helper at `src/core/bootstrap.py` re-expands them
into real newlines at runtime.

## Manual deploy fallback

If Cloud Build is unavailable, you can deploy directly with `gcloud`:

```bash
# 1. Build & push locally
docker build -t europe-southwest1-docker.pkg.dev/grupo-rg-a9929/ai-core/ai-core:dev .
docker push europe-southwest1-docker.pkg.dev/grupo-rg-a9929/ai-core/ai-core:dev

# 2. Deploy Service
gcloud run deploy ai-core \
  --image=europe-southwest1-docker.pkg.dev/grupo-rg-a9929/ai-core/ai-core:dev \
  --region=europe-southwest1 \
  --memory=1Gi --cpu=1 --timeout=60s \
  --service-account=firebase-adminsdk-fbsvc@grupo-rg-a9929.iam.gserviceaccount.com \
  --update-env-vars=WORKER_JOB_NAME=projects/grupo-rg-a9929/locations/europe-southwest1/jobs/ai-core-worker

# 3. Deploy Job
gcloud run jobs deploy ai-core-worker \
  --image=europe-southwest1-docker.pkg.dev/grupo-rg-a9929/ai-core/ai-core:dev \
  --region=europe-southwest1 \
  --memory=2Gi --cpu=2 --task-timeout=3600s \
  --service-account=ai-core-worker-sa@grupo-rg-a9929.iam.gserviceaccount.com \
  --command=python --args=-m,src.core.jobs.worker_main
```

For the Owner's 250+ page PDFs that prompted this rewrite, raise the Job's
task timeout up to its hard maximum:

```bash
gcloud run jobs update ai-core-worker --region=europe-southwest1 \
  --task-timeout=86400s   # 24h
```

## Smoke test after deploy

`scripts/smoke-test-dispatch.sh` exercises the full path end-to-end with a
synthetic 1-page PDF. Run it after every production deploy:

```bash
AI_CORE_URL=https://ai-core-XXXX.europe-southwest1.run.app \
INTERNAL_WORKER_TOKEN=<the token> \
bash services/ai-core/scripts/smoke-test-dispatch.sh
```

Expected outcome: status reaches `completed` within ~2 minutes for the
synthetic PDF. If it stalls at `queued`, the IAM binding (Service →
Job invoker) is the most likely culprit — re-run `setup-infrastructure.sh`.

## Rollback

The dispatcher router lives at new paths (`/api/v1/jobs/dispatch|cancel|retry`).
The legacy endpoints (`/api/v1/jobs/measurements`, `/api/v1/budget/vision-extract`,
`/api/v1/jobs/nl-budget`) are **still alive** during coexistence. To roll
back the Next.js side (P4.b → revert), the env var flag is:

```bash
# In the Next.js Vercel project
NEXT_PUBLIC_USE_PIPELINE_JOBS=false
```

The Python Service serves both routes simultaneously until cutover (week 6
of the plan). Removing legacy endpoints is gated by the regression test
`tests/core/http/test_dispatch_router.py::test_no_background_tasks_in_dispatch_router`.

## When things go wrong

- **Job stays `queued` forever**: IAM. The Service SA is missing
  `roles/run.invoker` on the Job. Re-run `setup-infrastructure.sh`.
- **Job exits 1 immediately after spawn**: env vars missing on the Job.
  `gcloud run jobs describe ai-core-worker --region=europe-southwest1`
  and compare env list to the Service.
- **Job exits 2 immediately**: `JOB_ID` env override wasn't applied —
  check the `--overrides` payload in the dispatcher (only happens if the
  Cloud Run Jobs API rejects the override, e.g., container name mismatch).
- **Status flips to `canceled` unexpectedly**: SIGTERM. Cloud Run Jobs
  sent SIGTERM because the task ran past `--task-timeout`. Raise it (up
  to 86400s) or split the work.
- **Owner's UI stays in `processing` forever**: the OLD BackgroundTasks
  bug. Verify the Next.js side is hitting `/api/v1/jobs/dispatch`, not
  one of the legacy endpoints. If it IS hitting the new endpoint, check
  `pipeline_jobs/{jobId}` directly in Firestore — `status: failed` with
  an error message means the worker recorded the failure correctly and
  the UI's SSE stream isn't picking it up (front-end fix).

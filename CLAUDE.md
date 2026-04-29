# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Next.js dev server on **port 9002** (not 3000). Open http://localhost:9002.
- `npm run build` / `npm start` — production build & serve.
- `npm run lint` — `next lint`.
- `npm run typecheck` — `tsc --noEmit`. **Use this as the real correctness check**: [next.config.js](next.config.js) sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`, so `next build` will succeed even when `tsc` fails.
- `npm run validate` — typecheck + lint together.
- No `npm test` script is defined. Vitest is installed as a dev dep; run ad-hoc with `npx vitest` or `npx vitest run <file>`.
- Data/admin scripts: many one-off `.ts` scripts live in [scripts/](scripts/) and [src/scripts/](src/scripts/) — run them with `npx tsx <path>` (e.g. `npx tsx src/scripts/ingest-price-book-json.ts`). They hit Firestore directly and require the admin-SDK env vars below.

## Required environment

`.env` at the repo root feeds both `dev`, server actions, and the tsx scripts. The non-obvious pieces:

- `NEXT_PUBLIC_FIREBASE_*` — client SDK (initialised in [src/lib/firebase/client.ts](src/lib/firebase/client.ts), browser-only).
- `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` (+ optional `GCLOUD_PROJECT`) — admin SDK, read by [src/backend/shared/infrastructure/firebase/admin-app.ts](src/backend/shared/infrastructure/firebase/admin-app.ts). `FIREBASE_PRIVATE_KEY` must keep literal `\n` escapes — the loader replaces them. If missing, the module falls back to Application Default Credentials.
- `GOOGLE_GENAI_API_KEY` — consumed implicitly by the Genkit `googleAI()` plugin in [src/backend/ai/core/config/genkit.config.ts](src/backend/ai/core/config/genkit.config.ts).
- `AI_CORE_URL` / `PDF_EXTRACTOR_SERVICE_URL` — URL of the sibling Python service ([services/ai-core/](services/ai-core/)). Local default is `http://127.0.0.1:8080`; production is Cloud Run.

## Architecture

### Stack
Next.js 15 App Router · React 18 · TypeScript · Tailwind + ShadCN UI (config in [components.json](components.json)) · Firebase (Auth / Firestore / Storage) · Genkit + Google Gemini · next-intl for i18n. Path alias `@/*` → `src/*`.

### Route layout
All user-facing routes live under `src/app/[locale]/` and are grouped by Next.js route groups:
- `(public)/` — marketing site (home, services, blog, budget request, zones).
- `(auth)/` — login / signup.
- `dashboard/` — authenticated app: budgets, projects, leads, agenda, marketing, analytics, settings, measurements, seo-generator, admin.

Locales and **localised pathnames** are defined in [src/i18n/routing.ts](src/i18n/routing.ts) (`es` default, plus `en`/`ca`/`de`/`nl`). When adding a new route that should be localised, add it to `routing.ts`, not just to the filesystem. The root middleware ([src/middleware.ts](src/middleware.ts)) only applies next-intl to non-`/api` paths.

API routes live under `src/app/api/**`. The budget pipeline uses **Server-Sent Events** — see [src/app/api/budget/stream/route.ts](src/app/api/budget/stream/route.ts), which tails `pipeline_telemetry/{budgetId}/events` via Firestore `onSnapshot`. Heavy mutations are **Server Actions** under [src/actions/](src/actions/) (organised by domain: `budget/`, `project/`, `lead/`, `ai/`, `catalog/`, …). `next.config.js` raises `serverActions.bodySizeLimit` to 512 MB to accept PDF/audio uploads.

### Domain code (clean / hexagonal)
Business modules under [src/backend/](src/backend/) follow a consistent `{domain,application,infrastructure}` split — e.g. [src/backend/budget/](src/backend/budget/) has `domain/budget.ts` (entities), `application/budget-service.ts` (use cases), `infrastructure/budget-repository-firestore.ts` (Firestore adapter). Other modules: `crm`, `project`, `lead`, `catalog`, `material-catalog`, `price-book`, `expense`, `agenda`, `chat`, `marketing`, `analytics`, `security`, `auth`, `user`, `ai-training`. Cross-module primitives (domain events, Firebase admin init, Google Calendar) live in [src/backend/shared/](src/backend/shared/).

When adding behaviour to a backend module, keep the dependency direction **infrastructure → application → domain**. Server actions and API routes should call into `application/` services, not directly into `infrastructure/`.

### AI layer (Genkit)
Everything under [src/backend/ai/](src/backend/ai/). Organised by **audience**, not by type:
- `core/` — shared config ([genkit.config.ts](src/backend/ai/core/config/genkit.config.ts) exports the singleton `ai`, `embeddingModel`, and `gemini25Flash`), shared agents/tools.
- `public/` — agents/flows/tools for the marketing site (triage, commercial chat, attachment analysis, audio transcription, invoice extraction).
- `public-demo/` — demo-budget generation (anonymous visitors).
- `private/` — authenticated contractor flows: the **construction architect** decomposes a project into chapters, `generate-budget-recurse.flow.ts` orchestrates chapter → item resolution, plus estimation / validation / search agents and the measurements pipeline.
- `prompts/` — `.prompt` files loaded via Genkit's `promptDir` (set to `src/backend/ai/prompts`).

The embedding model is `geminiEmbedding001` — Firestore vector fields must be **exactly 768 dimensions**. PDF / measurement extraction that exceeds Genkit's limits is delegated to the Python service at `AI_CORE_URL` (see `services/ai-core/`, a FastAPI app deployed to Cloud Run).

### Frontend state & UI
- `ThemeProvider` (next-themes) supports multiple named themes (`theme-gold`, `theme-stone`, …) — see [src/app/[locale]/layout.tsx](src/app/[locale]/layout.tsx).
- React Query provider, Auth context, and `BudgetWidgetProvider` wrap the app. A floating budget widget is mounted globally via `SmartBudgetWrapper`.
- Two toast systems coexist: Radix `Toaster` (for `useToast`) and `SileoToaster`. Pick the one matching the existing call site rather than introducing a third.
- ShadCN components live in `src/components/ui/`; feature components are organised by domain (`budget/`, `budget-editor/`, `dashboard/`, `prices/`, `projects/`, …).

### Firestore rules
[firestore.rules](firestore.rules) is deliberately restrictive: client writes are allowed **only** to `mail/*` (outbound email queue) and `analytics/*`. Everything else is admin-SDK only — new client-side writes will silently fail until the rules are updated.

### Sibling Python service
[services/ai-core/](services/ai-core/) is a separate Python project (FastAPI + pdfplumber) with its own `venv/`, `requirements.txt`, `Dockerfile`, and `pytest.ini`. It is **not** part of the Node build. Run its tests with `pytest` from inside that directory; the Next.js app only talks to it over HTTP.

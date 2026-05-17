/**
 * Runtime feature flags for the rollout of the Cloud Run Jobs pipeline.
 *
 * Single source of truth so the BudgetWizardChat caller, the
 * BudgetGenerationProgress component, and any analytics that wants to
 * record which path a budget took can read the same answer.
 *
 * Flip via Vercel env: `NEXT_PUBLIC_USE_PIPELINE_JOBS=true`.
 * Truthy values: `"true"`, `"1"`, `"yes"`. Anything else (including
 * undefined) means the legacy BackgroundTasks-based flow is used.
 *
 * Rollout phases (per ~/.claude/plans/vmaos-a-resolverlo-de-quiet-narwhal.md):
 *   - Weeks 1-3: implementation; flag false.
 *   - Week 4 canary: flag true ONLY in the Owner's environment.
 *   - Week 5 cutover: flag true everywhere.
 *   - Week 6 cleanup: legacy endpoints removed; flag becomes a no-op.
 */

const TRUTHY = new Set(['true', '1', 'yes', 'on']);

export function isPipelineJobsEnabled(): boolean {
  const raw = (process.env.NEXT_PUBLIC_USE_PIPELINE_JOBS ?? '').toLowerCase();
  return TRUTHY.has(raw);
}

# Inventario de server actions: autorización (Fase 0-B)

Estado tras la Fase 0-B (rama `worktree-agent-aaff01b9ad0c45278`).
Se cubren **todos** los ficheros cuya primera sentencia es `'use server'` dentro de `src/`:
`src/actions/**`, más los que están fuera de esa carpeta (`src/app/[locale]/dashboard/**/actions.ts`
y `src/backend/material-catalog/actions/search-materials.action.ts`). En total hay 213 exports.

## Por qué

Cada export de un fichero `'use server'` es un endpoint POST público: basta con conocer su id
(cabecera `Next-Action`). Que el componente que lo usa esté detrás del login del dashboard **no**
protege nada. La autorización tiene que estar dentro de la acción.

## Cómo se protege

Helper compartido: `src/actions/_guards.ts`. **No** lleva `'use server'`: si lo llevara, sus
exports serían endpoints públicos. Se apoya en `verifyAuth()` de
`src/backend/auth/auth.middleware.ts`, que no se ha cambiado. Admin = claim `admin:true` o
`role` `admin`/`super-admin`.

| Estilo | Uso | Qué recibe el cliente sin sesión |
|---|---|---|
| `if (!(await checkAdmin())) return unauthorizedResult();` | acciones con contrato `{ success, error }` | `{ success: false, error: 'No autorizado' }`, también en producción |
| `checkAdmin()` + `unauthorizedOkResult()` | contrato `{ ok, error }` (`detectBc3Action`) | `{ ok: false, error: 'No autorizado' }` |
| `await requireAdmin()` / `await requireUser()` | acciones que devuelven datos crudos (arrays, entidades, `null`, `void`) | se lanza `UnauthorizedError('No autorizado')`. **En builds de producción Next.js oculta el mensaje** de los errores lanzados, así que el cliente solo sabe que la llamada falló. Todos los llamadores cliente tienen `try/catch` o `.catch` (ver más abajo) |

Rutas API: `src/app/api/_lib/route-guards.ts`:
- `requireAdminRoute()` → 401 sin sesión, 403 si la sesión no es admin, `null` si está autorizado.
- `requireBearerSecret()` / `requireSecretHeader()` → comparan el secreto con `crypto.timingSafeEqual`
  (sobre hashes SHA-256, para que tampoco se filtre la longitud) y **fallan cerrado** cuando
  la variable de entorno no está definida.

## Clasificación

- **admin**: datos globales del negocio (presupuestos, leads, CRM, obras, gastos, catálogo,
  libro de precios, marketing, analítica, chat del panel, pipeline). Solo se usan desde
  `/dashboard/**`, incluido el wizard privado `BudgetWizardChat`, que solo se renderiza en
  `/dashboard/assistant`. `budget-modal.tsx` lo importa pero no lo renderiza.
- **usuario autenticado**: cualquier sesión válida.
  - `processAudioAction`: lo pide la tarea. Solo lo usa el wizard privado.
  - Lectura de obras: `getAllProjectsAction`, `getProjectAction`, `getProjectExpensesAction`. Así
    lo pide el agente A (rol `encargado` para `/dashboard/projects/**`). El filtrado por obras
    asignadas queda **pendiente**. Hoy cualquier sesión válida ve todas las obras.
  - `wizard-session.actions.ts`, `logCorrectionPairAction`: ya tenían `verifyAuth(false)`.
- **público (C)**: flujos públicos que revisa el agente C. Esta fase **no los ha tocado**.
- **revisar con C**: no se han protegido, por la duda de si alguna página pública los usa (ver
  la lista en el informe y abajo).

### Revisar con C

| Acción | Motivo |
|---|---|
| `attachments/process-attachments` (`processAttachmentsAction`) | Por instrucción no se toca (C). Hoy solo lo usa `BudgetWizardChat`, que es privado. Candidata a `requireAdmin`. |
| `budget/generate-demo-budget`, `budget/generate-public-demo` | Nombre de "demo pública". Hoy solo las usa `BudgetWizardChat` (privado), en una rama `isPublicMode` que no se usa. |
| `budget/process-client-message` | Flujo `publicDemoRequirementsFlow` con límite por lead. Solo lo usa `useBudgetWizard` (privado). |
| `budget/public-feedback` (`savePublicDemoFeedbackAction`) | Lo usa `DemoBudgetViewer`, que hoy no está montado en ninguna página. |
| `lead/get-demo-trace`, `lead/get-lead`, `lead/save-lead-feedback`, `lead/complete-profile` | No tienen llamadores en `src/`. Pertenecen al flujo de lead verificado por OTP. Si son código muerto, conviene **borrarlas**: hoy exponen lectura/escritura de leads por id. |
| `agenda/booking` → `getAdminBookingsAction`; `agenda/config` → `getAvailabilityConfigAction`, `updateAvailabilityConfigAction` | Son **claramente admin** (las usan `dashboard/page.tsx` y `availability-settings.tsx`), pero `agenda/**` es de C. Hay que protegerlas. |

## Tabla

| Fichero (`src/…`) | Export | Clasificación | Guard aplicado |
|---|---|---|---|
| `actions/admin/cancel-pipeline-job.action.ts` | `adminCancelPipelineJobAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/dispatch-budget-generation.action.ts` | `dispatchBudgetGenerationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/admin/force-fail-pipeline-job.action.ts` | `adminForceFailPipelineJobAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/get-ai-training-data.action.ts` | `getAiTrainingDataAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/admin/get-catalog-audit.action.ts` | `getCatalogAuditAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/get-job-metrics.action.ts` | `getJobMetricsAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/get-model-health.action.ts` | `getModelHealthAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/get-pdf-extractor-metrics.action.ts` | `getPdfExtractorMetricsAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/get-pipeline-jobs.action.ts` | `getPipelineJobsAction` | admin | requireAdmin() (lanza) |
| `actions/admin/get-pipeline-jobs.action.ts` | `getPipelineJobDetailAction` | admin | requireAdmin() (lanza) |
| `actions/admin/get-pipeline-jobs.action.ts` | `getPipelineJobFullDetailAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/get-security-audit-logs.action.ts` | `getSecurityAuditLogsAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/admin/model-registry.actions.ts` | `getModelRegistryAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/model-registry.actions.ts` | `testModelAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/model-registry.actions.ts` | `saveModelConfigAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/reconcile-partidas.action.ts` | `reconcilePartidasAction` | admin | verifyAuth(true) (previo) |
| `actions/admin/retry-pipeline-job.action.ts` | `adminRetryPipelineJobAction` | admin | verifyAuth(true) (previo) |
| `actions/agenda/booking.action.ts` | `getAvailableSlotsAction` | público (C) | — |
| `actions/agenda/booking.action.ts` | `createBookingAction` | público (C) | — |
| `actions/agenda/booking.action.ts` | `cancelBookingAction` | público (C) | — |
| `actions/agenda/booking.action.ts` | `createBookingFromLeadAction` | público (C) | — |
| `actions/agenda/booking.action.ts` | `getAdminBookingsAction` | público (C) | — |
| `actions/agenda/config.action.ts` | `getAvailabilityConfigAction` | público (C) | — |
| `actions/agenda/config.action.ts` | `updateAvailabilityConfigAction` | público (C) | — |
| `actions/agenda/confirm-booking-from-chat.action.ts` | `confirmBookingFromChatAction` | público (C) | — |
| `actions/agenda/get-my-bookings.action.ts` | `getMyBookingsAction` | público (C) | — |
| `actions/agenda/get-next-slots.action.ts` | `getNextAvailableSlotsAction` | público (C) | — |
| `actions/agenda/reschedule-booking.action.ts` | `rescheduleBookingAction` | público (C) | — |
| `actions/ai-training/log-correction-pair.action.ts` | `logCorrectionPairAction` | usuario autenticado | verifyAuth(false) (previo) |
| `actions/ai/check-batch-status.action.ts` | `checkBatchJobStatusAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/ai/check-batch-status.action.ts` | `processBatchJobResultAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/ai/generate-renovation.action.ts` | `generateRenovationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/analytics/get-advanced-analytics.action.ts` | `getEVMAnalyticsAction` | admin | requireAdmin() (lanza) |
| `actions/analytics/get-advanced-analytics.action.ts` | `getProviderRankingAction` | admin | requireAdmin() (lanza) |
| `actions/analytics/get-advanced-analytics.action.ts` | `getBudgetAccuracyAction` | admin | requireAdmin() (lanza) |
| `actions/analytics/get-global-analytics.action.ts` | `getGlobalAnalyticsAction` | admin | requireAdmin() (lanza) |
| `actions/analytics/get-project-analytics.action.ts` | `getProjectAnalyticsAction` | admin | requireAdmin() (lanza) |
| `actions/attachments/process-attachments.action.ts` | `processAttachmentsAction` | revisar con C | — |
| `actions/audio/process-audio.action.ts` | `processAudioAction` | usuario autenticado | checkUser() → {error:"No autorizado"} |
| `actions/budget/add-render.action.ts` | `addRenderAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/approve-budget.action.ts` | `approveBudgetAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/assign-budget-client.action.ts` | `assignBudgetClientAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/budget-acceptance.action.ts` | `getBudgetByAcceptanceTokenAction` | público (C) | — |
| `actions/budget/budget-acceptance.action.ts` | `acceptBudgetAction` | público (C) | — |
| `actions/budget/budget-acceptance.action.ts` | `requestBudgetChangesAction` | público (C) | — |
| `actions/budget/convert-to-full.action.ts` | `convertToFullBudgetAction` | admin | verifyAuth(true) (previo) |
| `actions/budget/create-budget-from-measurements.action.ts` | `createBudgetFromMeasurementsAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/create-budget.action.ts` | `createBudgetAction` | público (C) | — |
| `actions/budget/delete-budgets.action.ts` | `deleteBudgetsAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/detect-bc3.action.ts` | `detectBc3Action` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/edit-breakdown-nl.action.ts` | `editBreakdownWithNlAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/extract-measurement-pdf.action.ts` | `extractMeasurementPdfAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/generate-budget-from-specs.action.ts` | `generateBudgetFromSpecsAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/generate-budget.action.ts` | `generateBudgetAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/generate-demo-budget.action.ts` | `generateDemoBudgetAction` | revisar con C | — |
| `actions/budget/generate-public-demo.action.ts` | `generatePublicDemoAction` | revisar con C | — |
| `actions/budget/get-all-budgets.action.ts` | `getAllBudgetsAction` | admin | requireAdmin() (lanza) |
| `actions/budget/get-budget.action.ts` | `getBudgetAction` | admin | requireAdmin() (lanza) |
| `actions/budget/icl-feedback.action.ts` | `saveIclFeedbackAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/moderate-feedback.action.ts` | `moderatePublicFeedbackAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/orchestrate-nlp-budget.action.ts` | `orchestrateNlpToBudgetAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/process-admin-message.action.ts` | `processAdminMessageAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/process-client-message.action.ts` | `processClientMessageAction` | revisar con C | — |
| `actions/budget/public-feedback.action.ts` | `savePublicDemoFeedbackAction` | revisar con C | — |
| `actions/budget/save-admin-correction-trace.action.ts` | `saveAdminCorrectionTraceAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/save-heuristic-correction.action.ts` | `saveHeuristicCorrectionAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/save-training-delta.action.ts` | `saveTrainingDeltaAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/send-budget-to-client.action.ts` | `sendBudgetToClientAction` | admin | verifyAuth(true) (previo) |
| `actions/budget/send-quick-quote.action.ts` | `sendQuickQuoteAction` | admin | verifyAuth(true) (previo) |
| `actions/budget/smart-actions.ts` | `estimatePriceAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/smart-actions.ts` | `generateBreakdownAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/smart-add.action.ts` | `smartAddAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/budget/update-budget.action.ts` | `updateBudgetAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/calibration/record-price-corrections.action.ts` | `recordPriceCorrectionsAction` | admin | verifyAuth(true) (previo) |
| `actions/catalog/save-from-scratch-to-price-book.action.ts` | `saveFromScratchToPriceBookAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/catalog/search-catalog.action.ts` | `searchCatalogAction` | admin | requireAdmin() (lanza) |
| `actions/chat/archive-conversation.action.ts` | `archiveConversationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/create-admin-conversation.action.ts` | `createAdminConversationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/delete-admin-conversation.action.ts` | `deleteAdminConversationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/get-admin-conversations.action.ts` | `getAdminConversationsAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/get-conversation-history.action.ts` | `getConversationHistoryAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/get-conversation.action.ts` | `getConversationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/list-admin-conversations.action.ts` | `listAdminConversationsAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/persist-conversation-requirements.action.ts` | `persistConversationRequirementsAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/process-private-chat.action.ts` | `processPrivateChatAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/process-public-chat.action.ts` | `processPublicChatAction` | público (C) | — |
| `actions/chat/rename-admin-conversation.action.ts` | `renameAdminConversationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/reset-conversation.action.ts` | `resetConversationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/chat/send-message.action.ts` | `sendMessageAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/crm/get-deals-for-kanban.action.ts` | `getDealsForKanbanAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/crm/move-deal.action.ts` | `moveDealStageAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/debug/fix-account.action.ts` | `ensureLeadProfile` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/debug/fix-account.action.ts` | `setAdminClaim` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/document-template/document-template.action.ts` | `listDocumentTemplatesAction` | admin | requireAdminOrFail() (previo) |
| `actions/document-template/document-template.action.ts` | `getDocumentTemplateAction` | admin | requireAdminOrFail() (previo) |
| `actions/document-template/document-template.action.ts` | `createDocumentTemplateAction` | admin | requireAdminOrFail() (previo) |
| `actions/document-template/document-template.action.ts` | `updateDocumentTemplateAction` | admin | requireAdminOrFail() (previo) |
| `actions/document-template/document-template.action.ts` | `duplicateDocumentTemplateAction` | admin | requireAdminOrFail() (previo) |
| `actions/document-template/document-template.action.ts` | `setDefaultDocumentTemplateAction` | admin | requireAdminOrFail() (previo) |
| `actions/document-template/document-template.action.ts` | `deleteDocumentTemplateAction` | admin | requireAdminOrFail() (previo) |
| `actions/document-template/document-template.action.ts` | `seedBuiltinDocumentTemplateAction` | admin | requireAdminOrFail() (previo) |
| `actions/document-template/document-template.action.ts` | `getDocumentTemplatesForAction` | admin | requireAdminOrFail() (previo) |
| `actions/expense/create-expense.action.ts` | `createExpenseAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/expense/get-all-providers.action.ts` | `getAllProvidersAction` | admin | requireAdmin() (lanza) |
| `actions/expense/get-project-expenses.action.ts` | `getProjectExpensesAction` | usuario autenticado | requireUser() (lanza) |
| `actions/expense/get-project-expenses.action.ts` | `getAllExpensesAction` | admin | requireAdmin() (lanza) |
| `actions/expense/reject-expense.action.ts` | `rejectExpenseAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/expense/upload-invoice.action.ts` | `uploadInvoiceAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/expense/validate-expense.action.ts` | `validateExpenseAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/complete-profile.action.ts` | `completeProfileAction` | revisar con C | — |
| `actions/lead/create-admin-lead.action.ts` | `createAdminLeadAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/dashboard.action.ts` | `getLeadsAction` | admin | requireAdmin() (lanza) |
| `actions/lead/dashboard.action.ts` | `getLeadStatsAction` | admin | requireAdmin() (lanza) |
| `actions/lead/dashboard.action.ts` | `getLeadByIdAction` | admin | requireAdmin() (lanza) |
| `actions/lead/delete-lead.action.ts` | `deleteLeadAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/get-admin-lead-detail.action.ts` | `getAdminLeadDetailAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/get-admin-leads.action.ts` | `getAdminLeadsAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/get-demo-trace.action.ts` | `getPublicDemoTraceByLeadIdAction` | revisar con C | — |
| `actions/lead/get-lead-brief.action.ts` | `getLeadBriefAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/get-lead-conversation.action.ts` | `getLeadConversationAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/get-lead.action.ts` | `getLeadAction` | revisar con C | — |
| `actions/lead/get-verified-lead.action.ts` | `getVerifiedLeadAction` | público (C) | — |
| `actions/lead/getLeadPdfConfigAction.ts` | `getLeadPdfConfigAction` | admin | requireAdmin() (lanza) |
| `actions/lead/list-leads-for-selector.action.ts` | `listLeadsForSelectorAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/mark-demo-pdf-downloaded.action.ts` | `markDemoPdfDownloadedAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/request-lead-otp.action.ts` | `requestLeadOtpAction` | público (C) | — |
| `actions/lead/save-lead-feedback.action.ts` | `saveLeadFeedbackAction` | revisar con C | — |
| `actions/lead/saveLeadPdfConfigAction.ts` | `saveLeadPdfConfigAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/lead/verify-lead-otp.action.ts` | `verifyLeadOtpAction` | público (C) | — |
| `actions/marketing-analytics/tracking.action.ts` | `trackPageViewAction` | público (C) | — |
| `actions/marketing-analytics/tracking.action.ts` | `trackEventAction` | público (C) | — |
| `actions/marketing-analytics/tracking.action.ts` | `getABVariantAction` | público (C) | — |
| `actions/marketing/blog-post.action.ts` | `generateAndSaveBlogPostAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/blog-post.action.ts` | `listBlogPostsAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/blog-post.action.ts` | `updateBlogPostAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/blog-post.action.ts` | `deleteBlogPostAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/blog-post.action.ts` | `scheduleBlogPostAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/blog-post.action.ts` | `rescheduleBlogPostAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/blog-post.action.ts` | `retryFailedBlogPostAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/blog-post.action.ts` | `publishBlogPostNowAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/editorial-plan.action.ts` | `generateEditorialPlanAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/editorial-plan.action.ts` | `listProposedBriefsAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/editorial-plan.action.ts` | `listBriefsByPlanAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/editorial-plan.action.ts` | `approveBriefAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/editorial-plan.action.ts` | `rejectBriefAction` | admin | requireAdminOrFail() (previo) |
| `actions/marketing/editorial-plan.action.ts` | `deleteBriefAction` | admin | requireAdminOrFail() (previo) |
| `actions/material-catalog/create-material-price-rule.action.ts` | `createMaterialPriceRuleAction` | admin | requireAdminOrFail() (previo) |
| `actions/material-catalog/delete-catalog.action.ts` | `deleteCatalogByYearAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/material-catalog/delete-material-price-rule.action.ts` | `deleteMaterialPriceRuleAction` | admin | requireAdminOrFail() (previo) |
| `actions/material-catalog/get-ingestion-status.action.ts` | `getIngestionStatusAction` | admin | requireAdmin() (lanza) |
| `actions/material-catalog/get-latest-materials.action.ts` | `getLatestMaterialsAction` | admin | requireAdmin() (lanza) |
| `actions/material-catalog/ingest-catalog.action.ts` | `ingestCatalogAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/material-catalog/list-material-price-rules.action.ts` | `listMaterialPriceRulesAction` | admin | requireAdminOrFail() (previo) |
| `actions/material-catalog/list-materials.action.ts` | `listMaterialsAction` | admin | verifyAuth(true) (previo) |
| `actions/material-catalog/list-materials.action.ts` | `listMaterialCategoriesAction` | admin | verifyAuth(true) (previo) |
| `actions/material-catalog/preview-material-price-rule.action.ts` | `previewMaterialPriceRuleAction` | admin | requireAdminOrFail() (previo) |
| `actions/material-catalog/search-materials.action.ts` | `searchMaterialsAction` | admin | requireAdmin() (lanza) |
| `actions/material-catalog/toggle-material-price-rule.action.ts` | `toggleMaterialPriceRuleAction` | admin | requireAdminOrFail() (previo) |
| `actions/material-catalog/update-material-price-rule.action.ts` | `updateMaterialPriceRuleAction` | admin | requireAdminOrFail() (previo) |
| `actions/pipeline/cancel-pipeline-job.action.ts` | `cancelPipelineJobAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/pipeline/dispatch-pipeline-job.action.ts` | `dispatchPipelineJobAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/pipeline/extract-pdf-metadata.action.ts` | `extractPdfMetadataAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/pipeline/retry-pipeline-job.action.ts` | `retryPipelineJobAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/platform/company-config.action.ts` | `getCompanyConfigAction` | admin | requireAdmin() (lanza) |
| `actions/platform/company-config.action.ts` | `saveCompanyConfigAction` | admin | requireAdmin() (lanza) |
| `actions/price-book/check-job-status.action.ts` | `checkIngestionJobStatus` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/detect-price-book-pages.action.ts` | `detectPriceBookPagesAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/dispatch-price-book-ingest.action.ts` | `dispatchPriceBookIngestAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/dispatch-price-book-ingest.action.ts` | `getPriceBookIngestStatusAction` | admin | requireAdmin() (lanza) |
| `actions/price-book/extract-price-book-preview.action.ts` | `extractPriceBookPreviewAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/get-price-book-breakdown.action.ts` | `getPriceBookBreakdown` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/get-price-book-breakdown.action.ts` | `getCatalogBreakdownForRepair` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/get-price-book-items.action.ts` | `getPriceBookItems` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/ingest-price-book.action.ts` | `ingestPriceBookAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/search-items.action.ts` | `searchPriceBookAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-book/search-price-book.action.ts` | `searchPriceBookAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/price-list/price-list.action.ts` | `listPriceListsAction` | admin | requireAdminOrFail() (previo) |
| `actions/price-list/price-list.action.ts` | `getPriceListAction` | admin | requireAdminOrFail() (previo) |
| `actions/price-list/price-list.action.ts` | `createPriceListAction` | admin | requireAdminOrFail() (previo) |
| `actions/price-list/price-list.action.ts` | `updatePriceListAction` | admin | requireAdminOrFail() (previo) |
| `actions/price-list/price-list.action.ts` | `duplicatePriceListAction` | admin | requireAdminOrFail() (previo) |
| `actions/price-list/price-list.action.ts` | `deletePriceListAction` | admin | requireAdminOrFail() (previo) |
| `actions/price-list/price-list.action.ts` | `getPriceListStarterBlocksAction` | admin | requireAdminOrFail() (previo) |
| `actions/project/create-project.action.ts` | `createProjectAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/project/delete-project.action.ts` | `deleteProjectAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/project/get-all-projects.action.ts` | `getAllProjectsAction` | usuario autenticado | requireUser() (lanza) |
| `actions/project/get-project.action.ts` | `getProjectAction` | usuario autenticado | requireUser() (lanza) |
| `actions/project/manage-project-phases.action.ts` | `addProjectPhaseAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/project/manage-project-phases.action.ts` | `removeProjectPhaseAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/project/manage-project-phases.action.ts` | `reorderProjectPhasesAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/project/update-project-phase.action.ts` | `updateProjectPhaseAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/project/update-project-status.action.ts` | `updateProjectStatusAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/project/update-project.action.ts` | `updateProjectAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `actions/search-price-book.action.ts` | `searchPriceBookAction` | admin | requireAdmin() (lanza) |
| `actions/wizard/wizard-session.actions.ts` | `createWizardSessionAction` | usuario autenticado | verifyAuth(false) (previo) |
| `actions/wizard/wizard-session.actions.ts` | `getWizardSessionAction` | usuario autenticado | verifyAuth(false) (previo) |
| `actions/wizard/wizard-session.actions.ts` | `listWizardSessionsAction` | usuario autenticado | verifyAuth(false) (previo) |
| `actions/wizard/wizard-session.actions.ts` | `appendWizardMessageAction` | usuario autenticado | verifyAuth(false) (previo) |
| `actions/wizard/wizard-session.actions.ts` | `patchWizardSessionAction` | usuario autenticado | verifyAuth(false) (previo) |
| `actions/wizard/wizard-session.actions.ts` | `deleteWizardSessionAction` | usuario autenticado | verifyAuth(false) (previo) |
| `app/[locale]/dashboard/admin/pending-items/actions.ts` | `approvePendingItemAction` | admin | checkAdmin() → {error:"No autorizado"} |
| `app/[locale]/dashboard/admin/pending-items/actions.ts` | `rejectPendingItemAction` | admin | requireAdmin() (lanza) |
| `app/[locale]/dashboard/admin/pending-items/actions.ts` | `getPendingItemsAction` | admin | requireAdmin() (lanza) |
| `app/[locale]/dashboard/admin/prices/actions.ts` | `ingestPriceBook` | admin | checkAdmin() → {error:"No autorizado"} |
| `app/[locale]/dashboard/settings/budget/actions.ts` | `getBudgetConfigAction` | admin | requireAdmin() (lanza) |
| `app/[locale]/dashboard/settings/budget/actions.ts` | `saveBudgetConfigAction` | admin | requireAdmin() (lanza) |
| `app/[locale]/dashboard/settings/budget/calibration-actions.ts` | `getCalibrationFactorsAction` | admin | requireAdmin local (previo) |
| `app/[locale]/dashboard/settings/budget/calibration-actions.ts` | `saveCalibrationGlobalAction` | admin | requireAdmin local (previo) |
| `app/[locale]/dashboard/settings/budget/calibration-actions.ts` | `saveCalibrationChapterAction` | admin | requireAdmin local (previo) |
| `app/[locale]/dashboard/settings/budget/calibration-actions.ts` | `setCalibrationChapterLockAction` | admin | requireAdmin local (previo) |
| `app/[locale]/dashboard/settings/budget/calibration-actions.ts` | `resetCalibrationChapterAction` | admin | requireAdmin local (previo) |
| `app/[locale]/dashboard/settings/budget/calibration-actions.ts` | `saveCalibrationGuardAction` | admin | requireAdmin local (previo) |
| `backend/material-catalog/actions/search-materials.action.ts` | `searchMaterialsAction` | admin | requireAdmin() (lanza) |

## Hallazgos y cambios especiales

- **CRÍTICO, `debug/fix-account` → `setAdminClaim(email, secret)`**: era una server action
  pública con un secreto por defecto escrito en el código (`"grupo-rg-admin-dev-secret"`). Si
  `ADMIN_SECRET` no estaba definido, cualquiera podía hacerse admin. Ahora exige sesión admin
  **y** `ADMIN_SECRET` definido (falla cerrado), y compara el secreto con `timingSafeEqual`. No se
  ha borrado porque la usa el comando `/admin-claim` de `BudgetWizardChat`. El primer admin se
  crea con `scripts/set-admin.js`. `ensureLeadProfile` exige admin.
- **`chat/send-message`**: el remitente sale de la sesión. Con `senderType: 'assistant'` se guarda
  `{type:'assistant', id:'system'}`. Con cualquier otro valor se guarda `{type:'admin', id:<uid de sesión>}`.
  Ya no se acepta `'lead'` y se ignora el `senderId` que manda el cliente.
- **`admin/get-pipeline-jobs`**: `getPipelineJobsAction` y `getPipelineJobDetailAction` no tenían
  guard, aunque el fichero sí lo tenía para `getPipelineJobFullDetailAction`.

## Rutas API

| Ruta | Antes | Ahora |
|---|---|---|
| `GET /api/crm/deals` | abierta | `requireAdminRoute()` |
| `POST /api/crm/deals/move` | abierta | `requireAdminRoute()` |
| `GET`/`PATCH /api/marketing/sequences` | abierta | `requireAdminRoute()` |
| `POST /api/measurements` | abierta | `requireAdminRoute()`, antes de leer el multipart |
| `POST /api/assistant/stream` | abierta | `requireAdminRoute()` (solo la usa el wizard privado) |
| `GET /api/budget/stream` (SSE) | abierta | `requireAdminRoute()`. La consumen `BudgetGenerationProgress`/`BudgetStreamListener` dentro de `BudgetWizardChat` (privado). El `EventSource` same-origin manda la cookie. Ante 401/403 se responde JSON, no `text/event-stream`, y el navegador no reintenta en bucle. Ninguna página pública consume este stream. |
| `GET /api/cron/re-engagement` | si `CRON_SECRET` no existía, abierta; comparación `!==` | `requireBearerSecret('CRON_SECRET')`: tiempo constante, falla cerrado |
| `POST /api/marketing/worker` | si `INTERNAL_WORKER_TOKEN` no existía, abierta | `requireSecretHeader('x-internal-token', 'INTERNAL_WORKER_TOKEN')`: falla cerrado |
| `GET /api/cron/detect-zombie-jobs`, `GET /api/cron/recover-scheduled-blog-posts` | mismo patrón de "fail-open" | `requireBearerSecret('CRON_SECRET')` |
| `POST /api/marketing/blog/publish` | ya fallaba cerrado, pero comparaba con `!==` | `requireSecretHeader()` (tiempo constante) |

Consecuencia: `GoogleCloudTasksAdapter` no enviaba `x-internal-token` a `/api/marketing/worker`. Ahora
lo envía, tanto en Cloud Tasks como en el mock local.
**Antes de desplegar**: hay que tener definidos `CRON_SECRET` (Vercel lo inyecta como
`Authorization: Bearer` en los crons de `vercel.json`) e `INTERNAL_WORKER_TOKEN` en el entorno
web. Si falta alguno, esos endpoints devuelven 401 (fail-closed, a propósito).

## Riesgo pendiente: `serverActions.bodySizeLimit = 512 MB` (`next.config.js`)

No se ha cambiado, porque las subidas de PDF, audio y BC3 van como `FormData` a server actions. El
límite es **global**: cualquier server action, incluidas las públicas del área de C, acepta
cuerpos de hasta 512 MB **antes** de ejecutar el guard. Un anónimo puede mandar payloads enormes
a cualquier id de acción, lo que supone un riesgo de DoS por memoria y ancho de banda.
Mitigaciones propuestas para fases posteriores:
1. Bajar el límite global (p. ej. a 10–25 MB) y mover las subidas grandes a URLs firmadas de
   Storage. Ya hay un flujo `gcsUri` en el libro de precios.
2. O sacar las subidas a Route Handlers que validen la sesión **antes** de leer el cuerpo
   (`/api/measurements` ya lo hace).
3. Límite de tamaño o rate-limit en el edge (Vercel WAF) para las peticiones con cabecera `Next-Action`.

## Componentes cliente

- Las acciones con contrato `{success, error}` devuelven `error: 'No autorizado'`, y los llamadores
  ya muestran `result.error` o lo ignoran.
- En las acciones que lanzan error, se ha añadido `try/catch` donde faltaba, para que la UI no se
  rompa: `BudgetEditorWrapper` (`getLeadPdfConfigAction`), `material-catalog-search`
  (`searchMaterialsAction`), `LatestMaterialsList`, `PriceBookUpdateWizard` (polling de estado),
  `analytics-page-client` (`handleSelectProject`). En `dashboard/projects/page.tsx`,
  `getAllBudgetsAction` (solo admin) pasa a `.catch(() => [])`: un `encargado` ve la lista de
  obras, solo sin presupuestos.
- Las Server Components del dashboard que llaman acciones con `requireAdmin()` lanzan error si no
  hay sesión admin y se muestra el error boundary. Esto es intencionado: el gating de UI por rol
  es del agente A.

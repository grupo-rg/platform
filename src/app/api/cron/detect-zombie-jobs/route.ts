/**
 * Zombie pipeline-job detector — runs every 5 minutes from Vercel Cron.
 *
 * A "zombie" is a job whose canonical Firestore doc claims status =
 * running but whose `updatedAt` is older than 5 min — i.e. the worker
 * heartbeat has stopped without a clean terminal transition. Most of the
 * time this means the worker was OOM-killed before the architectural fix.
 *
 * Behaviour:
 *   1. Query `pipeline_jobs` for status='running' AND updatedAt < now-5min.
 *   2. For each suspect, compare `resolvedPartidaCount` with the last
 *      snapshot in `zombie_alert_state/{jobId}`.
 *   3. If progress *has* changed since last alert: only persist the new
 *      snapshot (the worker is alive but slow — no alert).
 *   4. If progress hasn't changed: send an email alert to the admin and
 *      bump the snapshot's lastAlertedAt.
 *   5. If lastAlertedAt is older than 30 min AND progress still hasn't
 *      moved: propose auto-cancel in the email body. (We don't actually
 *      execute force-fail from the cron — keeping a human in the loop
 *      while the new architecture is still maturing.)
 *
 * Auth: protected by CRON_SECRET bearer (standard Vercel Cron pattern).
 *
 * The detector is idempotent — re-running it within the same window with
 * unchanged progress only re-sends if 5+ min have passed since the last
 * alert, to avoid spamming the admin inbox.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { FieldValue } from 'firebase-admin/firestore';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const AUTO_CANCEL_PROPOSAL_AGE_MS = 30 * 60 * 1000;
/** Don't re-alert on the same zombie more than once every 30 min. */
const RE_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

type Snapshot = {
    resolvedPartidaCount: number;
    updatedAtMs: number;
    lastAlertedAtMs?: number;
    /** Persisted between runs so the "proposes auto-cancel" decision is
     *  based on how long the job has been stuck (not just on the latest
     *  cron run). */
    firstSeenStuckAtMs?: number;
};

function toMs(value: any): number {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return new Date(value).getTime();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    return 0;
}

function authorized(request: NextRequest): boolean {
    const expected = process.env.CRON_SECRET;
    if (!expected) return true; // dev convenience — no secret = no gate
    const auth = request.headers.get('authorization') || '';
    return auth === `Bearer ${expected}`;
}

function adminEmail(): string | null {
    return process.env.ZOMBIE_ALERT_EMAIL
        || process.env.ADMIN_ALERT_EMAIL
        || process.env.RESEND_TO_EMAIL
        || null;
}

function buildZombieEmail(args: {
    jobId: string;
    jobType?: string;
    leadId?: string;
    budgetId?: string;
    startedAt: number;
    updatedAt: number;
    resolvedPartidaCount: number;
    attempts: number;
    proposeAutoCancel: boolean;
}): { subject: string; html: string; text: string } {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:9002';
    const link = `${baseUrl}/dashboard/admin/jobs/${args.jobId}`;
    const ageDuration = formatDistanceToNow(new Date(args.startedAt), { locale: es });
    const idleDuration = formatDistanceToNow(new Date(args.updatedAt), { locale: es });

    const subject = args.proposeAutoCancel
        ? `[ALERTA] Job zombi ${args.jobId.slice(0, 8)} sin actividad >30min — considera force-fail`
        : `[ALERTA] Job zombi ${args.jobId.slice(0, 8)} sin actividad >5min`;

    const proposalBlock = args.proposeAutoCancel ? `
        <div style="margin-top:12px;padding:12px;border-left:3px solid #d97706;background:#fef3c7;color:#7c2d12;">
            <strong>Propuesta:</strong> el job lleva más de 30 minutos sin progreso.
            Considera usar <em>Force-fail (admin)</em> para liberarlo, o cancelar y reintentar.
        </div>
    ` : '';

    const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#111;max-width:620px;line-height:1.55;">
        <h2 style="margin:0 0 8px 0;">Pipeline Job zombi detectado</h2>
        <p style="margin:0 0 12px 0;color:#444;">
            El cron de detección ha encontrado un job sin actividad en los últimos minutos.
        </p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <tr><td style="padding:4px 0;color:#666;width:160px;">Job ID</td><td><code>${args.jobId}</code></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Tipo</td><td>${args.jobType || '—'}</td></tr>
            <tr><td style="padding:4px 0;color:#666;">Lead ID</td><td><code>${args.leadId || '—'}</code></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Budget ID</td><td><code>${args.budgetId || '—'}</code></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Intentos</td><td>${args.attempts}</td></tr>
            <tr><td style="padding:4px 0;color:#666;">Partidas resueltas</td><td>${args.resolvedPartidaCount}</td></tr>
            <tr><td style="padding:4px 0;color:#666;">Inicio</td><td>${new Date(args.startedAt).toISOString()} (hace ${ageDuration})</td></tr>
            <tr><td style="padding:4px 0;color:#666;">Última actividad</td><td>${new Date(args.updatedAt).toISOString()} (hace ${idleDuration})</td></tr>
        </table>
        ${proposalBlock}
        <p style="margin-top:16px;">
            <a href="${link}" style="background:#111;color:#fff;padding:8px 14px;text-decoration:none;border-radius:6px;display:inline-block;">
                Abrir detalle del job →
            </a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
        <p style="color:#888;font-size:11px;">Grupo RG · Cron de detección de zombis</p>
    </div>`;

    const text = [
        `Pipeline Job zombi detectado`,
        ``,
        `Job ID: ${args.jobId}`,
        `Tipo: ${args.jobType || '—'}`,
        `Lead ID: ${args.leadId || '—'}`,
        `Budget ID: ${args.budgetId || '—'}`,
        `Intentos: ${args.attempts}`,
        `Partidas resueltas: ${args.resolvedPartidaCount}`,
        `Inicio: ${new Date(args.startedAt).toISOString()} (hace ${ageDuration})`,
        `Última actividad: ${new Date(args.updatedAt).toISOString()} (hace ${idleDuration})`,
        ``,
        args.proposeAutoCancel
            ? `>30min sin progreso. Considera Force-fail (admin).`
            : ``,
        `Detalle: ${link}`,
    ].filter(Boolean).join('\n');

    return { subject, html, text };
}

export async function GET(request: NextRequest) {
    if (!authorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    const cutoff = new Date(now - STALE_THRESHOLD_MS);

    // Query running jobs whose updatedAt is older than the stale threshold.
    // We rely on Firestore's automatic single-field index on `updatedAt`.
    let suspects: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
        const snap = await adminFirestore
            .collection('pipeline_jobs')
            .where('status', '==', 'running')
            .where('updatedAt', '<', cutoff)
            .limit(50)
            .get();
        suspects = snap.docs;
    } catch (err) {
        // Composite index may not exist yet — fall back to scanning the
        // running set and filtering client-side. Logged so ops can create
        // the index if this path becomes hot.
        console.warn('[detect-zombie-jobs] composite query failed, falling back to scan', err);
        const snap = await adminFirestore
            .collection('pipeline_jobs')
            .where('status', '==', 'running')
            .limit(200)
            .get();
        suspects = snap.docs.filter(d => {
            const u = toMs((d.data() as any).updatedAt);
            return u > 0 && u < cutoff.getTime();
        });
    }

    const recipient = adminEmail();
    const stateCol = adminFirestore.collection('zombie_alert_state');
    let alerted = 0;
    let progressed = 0;
    let cooledDown = 0;
    let emailErrors = 0;

    const results: any[] = [];

    for (const doc of suspects) {
        const jobId = doc.id;
        const data = doc.data() as any;
        const resolvedCount = Array.isArray(data.resolvedPartidaCodes) ? data.resolvedPartidaCodes.length : 0;
        const updatedAtMs = toMs(data.updatedAt);
        const startedAtMs = toMs(data.startedAt) || toMs(data.createdAt) || updatedAtMs;

        const stateRef = stateCol.doc(jobId);
        const stateSnap = await stateRef.get();
        const previous: Snapshot | null = stateSnap.exists ? (stateSnap.data() as Snapshot) : null;

        const isProgress = previous && previous.resolvedPartidaCount !== resolvedCount;

        if (isProgress) {
            // Worker IS making progress, just slowly. Refresh snapshot, do
            // not alert. firstSeenStuckAt is reset so the 30-min auto-cancel
            // clock restarts.
            await stateRef.set({
                resolvedPartidaCount: resolvedCount,
                updatedAtMs,
                firstSeenStuckAtMs: now,
            } satisfies Snapshot);
            progressed++;
            results.push({ jobId, action: 'progress_seen', resolvedCount });
            continue;
        }

        const firstSeenStuckAtMs = previous?.firstSeenStuckAtMs ?? now;
        const stuckAgeMs = now - firstSeenStuckAtMs;

        if (previous?.lastAlertedAtMs && (now - previous.lastAlertedAtMs) < RE_ALERT_COOLDOWN_MS) {
            cooledDown++;
            results.push({ jobId, action: 'cooled_down' });
            continue;
        }

        const proposeAutoCancel = stuckAgeMs > AUTO_CANCEL_PROPOSAL_AGE_MS;

        if (recipient) {
            const email = buildZombieEmail({
                jobId,
                jobType: data.jobType,
                leadId: data.leadId,
                budgetId: data.budgetId,
                startedAt: startedAtMs,
                updatedAt: updatedAtMs,
                resolvedPartidaCount: resolvedCount,
                attempts: data.attempts ?? 0,
                proposeAutoCancel,
            });
            try {
                const result = await ResendEmailService.send({
                    to: recipient,
                    subject: email.subject,
                    html: email.html,
                    text: email.text,
                    tags: [
                        { name: 'category', value: 'ops_alert' },
                        { name: 'kind', value: 'pipeline_zombie' },
                        { name: 'job_id', value: jobId },
                    ],
                });
                if (result.error) {
                    emailErrors++;
                    console.warn('[detect-zombie-jobs] email failed', { jobId, error: result.error });
                }
            } catch (err) {
                emailErrors++;
                console.error('[detect-zombie-jobs] email exception', err);
            }
        } else {
            console.warn('[detect-zombie-jobs] no admin email configured — alert NOT sent');
        }

        await stateRef.set({
            resolvedPartidaCount: resolvedCount,
            updatedAtMs,
            lastAlertedAtMs: now,
            firstSeenStuckAtMs,
        } satisfies Snapshot);
        alerted++;
        results.push({ jobId, action: 'alerted', proposeAutoCancel, stuckMin: Math.round(stuckAgeMs / 60000) });
    }

    // Garbage-collect snapshots for jobs that are no longer running (so the
    // collection doesn't grow unbounded over months).
    try {
        const allState = await stateCol.limit(500).get();
        const cleanups: Promise<any>[] = [];
        for (const s of allState.docs) {
            if (!suspects.find(d => d.id === s.id)) {
                // Only delete state docs older than 24h to keep evidence around for
                // diagnostics after a recovered zombi.
                const last = (s.data() as Snapshot).updatedAtMs || 0;
                if (now - last > 24 * 60 * 60 * 1000) {
                    cleanups.push(s.ref.delete());
                }
            }
        }
        if (cleanups.length > 0) {
            await Promise.allSettled(cleanups);
        }
    } catch (err) {
        console.warn('[detect-zombie-jobs] gc skipped', err);
    }

    return NextResponse.json({
        ok: true,
        checked: suspects.length,
        alerted,
        progressed,
        cooledDown,
        emailErrors,
        recipient: recipient ? recipient.replace(/(^.{2}).*(@.*$)/, '$1***$2') : null,
        timestamp: new Date(now).toISOString(),
        results,
    });
}

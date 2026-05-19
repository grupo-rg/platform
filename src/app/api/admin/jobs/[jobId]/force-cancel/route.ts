/**
 * POST /api/admin/jobs/{jobId}/force-cancel
 *
 * Proxies a cooperative cancel to the ai-core dispatcher and returns the
 * updated JobView from Firestore. Admin-only.
 *
 *   curl -X POST -b session=<admin-session-cookie> \
 *        https://constructoresenmallorca.com/api/admin/jobs/<jobId>/force-cancel
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    callDispatcher,
    loadJobView,
    requireAdmin,
} from '../../_shared';

export async function POST(
    _request: NextRequest,
    context: { params: Promise<{ jobId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { jobId } = await context.params;
    if (!jobId) return NextResponse.json({ error: 'missing_job_id' }, { status: 400 });

    const dispatch = await callDispatcher(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`);
    if (!dispatch.ok) {
        return NextResponse.json(
            { error: dispatch.error, downstream_status: dispatch.status },
            { status: dispatch.status === 404 ? 404 : 502 },
        );
    }

    const view = await loadJobView(jobId);
    return NextResponse.json({
        ok: true,
        job: view,
        dispatcher: dispatch.body,
    });
}

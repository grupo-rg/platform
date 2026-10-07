import { NextRequest, NextResponse } from 'next/server';
import { ProgressSequenceUseCase } from '@/backend/marketing/application/progress-sequence.usecase';
import { FirebaseSequenceRepository } from '@/backend/marketing/infrastructure/persistence/firebase.sequence.repository';
import { FirebaseEnrollmentRepository } from '@/backend/marketing/infrastructure/persistence/firebase.enrollment.repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { ResendEmailProvider } from '@/backend/marketing/infrastructure/messaging/resend-email.provider';
import { requireSecretHeader } from '@/app/api/_lib/route-guards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/marketing/worker
 * Body: { enrollmentId: string }
 * Invocado por Google Cloud Tasks (o por el mock local) para avanzar un
 * enrollment en su secuencia. Protegido por la cabecera `x-internal-token`
 * = INTERNAL_WORKER_TOKEN (tiempo constante). Fail-closed: si la variable no
 * está definida, el endpoint deniega (el mock local también debe enviarla).
 */
export async function POST(req: NextRequest) {
    const denied = requireSecretHeader(req, 'x-internal-token', 'INTERNAL_WORKER_TOKEN');
    if (denied) return denied;

    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const enrollmentId = body?.enrollmentId;
    if (!enrollmentId) {
        return NextResponse.json({ error: 'enrollmentId required' }, { status: 400 });
    }

    try {
        const useCase = new ProgressSequenceUseCase(
            new FirebaseSequenceRepository(),
            new FirebaseEnrollmentRepository(),
            new FirestoreLeadRepository(),
            new ResendEmailProvider(),
        );
        await useCase.execute(enrollmentId);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error('[api/marketing/worker][POST]', e);
        return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
    }
}

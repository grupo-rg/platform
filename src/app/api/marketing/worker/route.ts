import { NextRequest, NextResponse } from 'next/server';
import { ProgressSequenceUseCase } from '@/backend/marketing/application/progress-sequence.usecase';
import { FirebaseSequenceRepository } from '@/backend/marketing/infrastructure/persistence/firebase.sequence.repository';
import { FirebaseEnrollmentRepository } from '@/backend/marketing/infrastructure/persistence/firebase.enrollment.repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { ResendEmailProvider } from '@/backend/marketing/infrastructure/messaging/resend-email.provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/marketing/worker
 * Body: { enrollmentId: string }
 * Invocado por Google Cloud Tasks (o por el mock local) para avanzar un
 * enrollment en su secuencia. Protegido por INTERNAL_WORKER_TOKEN si está
 * configurado.
 */
export async function POST(req: NextRequest) {
    const expected = process.env.INTERNAL_WORKER_TOKEN;
    if (expected) {
        const provided = req.headers.get('x-internal-token') || '';
        if (provided !== expected) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

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

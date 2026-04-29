import { NextRequest, NextResponse } from 'next/server';
import { FirebaseSequenceRepository } from '@/backend/marketing/infrastructure/persistence/firebase.sequence.repository';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/marketing/sequences
 * Lista todas las secuencias (activas e inactivas).
 */
export async function GET() {
    try {
        initFirebaseAdminApp();
        const db = getFirestore();
        const collection = process.env.NEXT_PUBLIC_USE_TEST_DB === 'true' ? 'test_marketing_sequences' : 'marketing_sequences';
        const snap = await db.collection(collection).get();
        const sequences = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return NextResponse.json({ sequences });
    } catch (e: any) {
        console.error('[api/marketing/sequences][GET]', e);
        return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
    }
}

/**
 * PATCH /api/marketing/sequences
 * Body: { id: string, active: boolean }
 */
export async function PATCH(req: NextRequest) {
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const { id, active } = body || {};
    if (!id || typeof active !== 'boolean') {
        return NextResponse.json({ error: 'id and active are required' }, { status: 400 });
    }

    try {
        const repo = new FirebaseSequenceRepository();
        const seq = await repo.findById(id);
        if (!seq) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        seq.active = active;
        await repo.save(seq);
        return NextResponse.json({ ok: true, id, active });
    } catch (e: any) {
        console.error('[api/marketing/sequences][PATCH]', e);
        return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
    }
}

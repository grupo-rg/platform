import { NextRequest, NextResponse } from 'next/server';
import { FirebaseDealRepository } from '@/backend/crm/infrastructure/persistence/firebase.deal.repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crm/deals?stage=NEW_LEAD
 * Si no se pasa stage, devuelve todos los deals.
 */
export async function GET(req: NextRequest) {
    try {
        const repo = new FirebaseDealRepository();
        const stage = req.nextUrl.searchParams.get('stage');
        const deals = stage ? await repo.findAllByStage(stage) : await repo.findAll();
        return NextResponse.json({
            deals: deals.map(d => ({
                id: d.id,
                leadId: d.leadId,
                stage: d.stage,
                estimatedValue: d.estimatedValue,
                createdAt: d.createdAt.toISOString?.() ?? d.createdAt,
                updatedAt: d.updatedAt.toISOString?.() ?? d.updatedAt,
                metadata: d.metadata,
            })),
        });
    } catch (e: any) {
        console.error('[api/crm/deals][GET]', e);
        return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
    }
}

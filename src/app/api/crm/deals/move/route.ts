import { NextRequest, NextResponse } from 'next/server';
import { FirebaseDealRepository } from '@/backend/crm/infrastructure/persistence/firebase.deal.repository';
import { PipelineStage } from '@/backend/crm/domain/deal';

export const dynamic = 'force-dynamic';

/**
 * POST /api/crm/deals/move
 * Body: { dealId: string, toStage: PipelineStage }
 */
export async function POST(req: NextRequest) {
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const { dealId, toStage } = body || {};
    if (!dealId || !toStage) {
        return NextResponse.json({ error: 'dealId and toStage are required' }, { status: 400 });
    }
    if (!Object.values(PipelineStage).includes(toStage)) {
        return NextResponse.json({ error: `Unknown stage: ${toStage}` }, { status: 400 });
    }

    try {
        const repo = new FirebaseDealRepository();
        const deal = await repo.findById(dealId);
        if (!deal) {
            return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
        }
        deal.moveToStage(toStage as PipelineStage);
        await repo.save(deal);
        return NextResponse.json({ ok: true, deal: { id: deal.id, stage: deal.stage, updatedAt: deal.updatedAt } });
    } catch (e: any) {
        console.error('[api/crm/deals/move][POST]', e);
        return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
    }
}

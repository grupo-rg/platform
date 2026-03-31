import { notFound } from 'next/navigation';
import { FirestoreAiTrainingRepository } from '@/backend/ai-training/infrastructure/firestore-ai-training-repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { BudgetEditorWrapper } from '@/components/budget-editor/BudgetEditorWrapper';
import { Budget } from '@/backend/budget/domain/budget';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { CommunityFeedbackPanel } from '@/components/budget-editor/CommunityFeedbackPanel';

interface TraceViewerPageProps {
    params: Promise<{
        traceId: string;
    }>;
}

export default async function TraceViewerPage({ params }: TraceViewerPageProps) {
    const { traceId } = await params;
    const cleanTraceId = decodeURIComponent(traceId);

    const aiTrainingRepo = new FirestoreAiTrainingRepository();
    let trace;

    try {
        trace = await aiTrainingRepo.findById(cleanTraceId);
    } catch (e) {
        console.error("Error fetching trace:", e);
    }

    if (!trace) {
        notFound();
    }

    const leadRepo = new FirestoreLeadRepository();
    const lead = await leadRepo.findById(trace.leadId);

    const activeJson = trace.finalHumanJson || trace.baselineJson;

    const chapters = activeJson.chapters || [];
    const costBreakdown = activeJson.costBreakdown || {
        materialExecutionPrice: 0,
        overheadExpenses: 0,
        industrialBenefit: 0,
        tax: 0,
        globalAdjustment: 0,
        total: 0
    };
    const totalEstimated = activeJson.totalEstimated || 0;

    // Always fallback to original baseline for metadata that is not meant to be modified
    const telemetry = activeJson.telemetry || trace.baselineJson?.telemetry || {};
    const config = activeJson.config || trace.baselineJson?.config || undefined;

    const proxyBudgetTarget: Budget = {
        id: traceId,
        leadId: trace.leadId,
        clientSnapshot: lead?.personalInfo || { name: 'Demo User', email: '', phone: '' },
        specs: {
            interventionType: 'renovation',
            propertyType: 'flat',
            totalArea: 0,
            qualityLevel: 'medium'
        } as any,
        status: 'draft',
        createdAt: trace.createdAt || new Date(),
        updatedAt: new Date(),
        version: 1,
        type: 'renovation',
        chapters: chapters,
        costBreakdown: costBreakdown,
        totalEstimated: totalEstimated,
        telemetry: telemetry,
        config: config,
        source: 'wizard'
    };

    // Deep clone to strip *any* class prototypes (like Firestore Timestamps or hidden models)
    // before crossing the Server -> Client Component boundary.
    const safeProxyBudget = JSON.parse(JSON.stringify(proxyBudgetTarget));

    const traceDataForViewer = {
        originalPrompt: trace.originalPrompt || '',
        telemetry: telemetry
    };

    const safeTraceData = JSON.parse(JSON.stringify(traceDataForViewer));

    // Fetch Public Demo Feedbacks pending moderation for this specific trace
    initFirebaseAdminApp();
    const db = getFirestore();
    const feedbackSnap = await db.collection('training_heuristics')
        .where('budgetId', '==', cleanTraceId)
        .where('status', '==', 'pending_review')
        .get();

    const feedbacks = feedbackSnap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            itemId: data.itemId,
            description: data.description,
            proposedPrice: data.proposedPrice,
            vote: data.vote,
            reason: data.reason,
            timestamp: data.timestamp?.toDate()?.toISOString() || null
        };
    });

    return (
        <div className="h-screen w-full bg-background flex flex-col relative">
            <div className="absolute top-4 left-4 z-50">
                <Link href="/dashboard/admin/traces" as="style">
                    <Button variant="outline" size="sm" className="bg-[#121212] hover:bg-white/10 shadow-xl border-white/10">
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Volver a Trazas
                    </Button>
                </Link>
            </div>

            <BudgetEditorWrapper
                budget={safeProxyBudget}
                isAdmin={true}
                traceData={safeTraceData}
            />

            <CommunityFeedbackPanel 
                feedbacks={feedbacks} 
                traceId={cleanTraceId}
            />
        </div>
    );
}

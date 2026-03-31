import { EventEmitter } from 'events';

// Singleton event emitter for budget generation
class BudgetGenerationEmitter extends EventEmitter { }
export const budgetGenerationEmitter = new BudgetGenerationEmitter();

export type GenerationEvent = {
  type: 'subtasks_extracted' | 'item_resolving' | 'item_resolved' | 'validation_start' | 'complete' | 'error' |
  'chapter_start' | 'decomposition_start' | 'vector_search' | 'restructuring';
  leadId: string; // To scope events to a specific user
  data: any;
  timestamp: number;
};

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';

export async function emitGenerationEvent(leadId: string, type: GenerationEvent['type'], data: any) {
  const event = {
    type,
    leadId,
    data,
    timestamp: Date.now()
  };

  // 1. Local Emit (Legacy/Logging)
  budgetGenerationEmitter.emit(`event:${leadId}`, event);

  // 2. Firestore Write (Bus)
  try {
    // Fire and forget, or await? Given serverless, best to await if critical.
    // Use a subcollection 'generation_events' to avoid cluttering main doc
    // Strip undefined values for Firestore compatibility
    const cleanEvent = JSON.parse(JSON.stringify(event));

    await adminFirestore
      .collection('leads')
      .doc(leadId)
      .collection('generation_events')
      .add({
        ...cleanEvent,
        createdAt: new Date() // Server timestamp
      });
  } catch (error) {
    console.warn(`[BudgetEmitter] Failed to persist event ${type} for lead ${leadId}`, error);
  }
}

export async function clearGenerationEvents(leadId: string) {
  try {
    const eventsRef = adminFirestore.collection('leads').doc(leadId).collection('generation_events');
    const snapshot = await eventsRef.get();
    
    if (snapshot.empty) return;

    const batch = adminFirestore.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (e) {
    console.warn(`[BudgetEmitter] Failed to clear generation events for ${leadId}`, e);
  }
}

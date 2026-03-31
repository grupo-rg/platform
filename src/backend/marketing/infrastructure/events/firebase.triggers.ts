// This file acts as the entry point for the Firebase Functions connecting Firestore triggers to the DDD Use Cases

export const onLeadCreatedTrigger = async (snap: any, context: any) => {
    const leadData = snap.data();
    const leadId = context.params.leadId;
    
    console.log(`[Marketing Listener] Nuevo Lead detectado: ${leadId}. Evaluando asignación a Secuencias A/B...`);
    
    const role = leadData.profile?.role || 'admin';
    const variantProbability = Math.random();
    const variant = variantProbability > 0.5 ? 'A' : 'B';

    // Mock dependecy resolution:
    // const enrollUseCase = container.resolve(EnrollLeadInSequenceUseCase);
    
    try {
        console.log(`-> lead ${leadId} asignado a secuencia de Rol: ${role} en Variante: ${variant}`);
        // await enrollUseCase.execute(leadId, `vsl_sequence_${role}`, variant);
    } catch (e) {
        console.error("Fallo al inscribir al Lead", e);
    }
};

export const onPipelineStageChangedTrigger = async (change: any, context: any) => {
    const dealBefore = change.before.data();
    const dealAfter = change.after.data();

    // Check if stage mutated
    if (dealBefore.stage !== dealAfter.stage) {
        console.log(`[CRM Listener] Oportunidad ${context.params.dealId} cambió de fase: ${dealBefore.stage} -> ${dealAfter.stage}`);
        
        // Business logic hook: if a demo is scheduled, we should freeze the marketing sequence to avoid spam
        if (dealAfter.stage === 'SALES_CALL_SCHEDULED') {
            console.log(`-> Pausando secuencia de nutrición agresiva para lead ${dealAfter.leadId}`);
            // const cancelSequenceUseCase = container.resolve(CancelSequenceUseCase);
            // await cancelSequenceUseCase.execute(dealAfter.leadId);
        }
    }
};

'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { privateWizardAgent } from '@/backend/ai/private/agents/private-wizard.agent';

export async function processPrivateChatAction(
    message: string,
    history: any[],
    base64Files?: string[],
    userId?: string
) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        if (!userId) {
            throw new Error('User ID is required for private wizard');
        }

        const imagesBase64 = base64Files?.filter(b64 => !b64.startsWith('JVBER'));
        const documentBase64 = base64Files?.find(b64 => b64.startsWith('JVBER'));

        // Pass everything to the privateWizardAgent.
        // It handles PDF processing via tools, and conversational gathering for NLP-to-Budget.
        const result = await privateWizardAgent({
            userMessage: message,
            history,
            imagesBase64: imagesBase64?.length ? imagesBase64 : undefined,
            documentBase64,
            userId,
        });

        // The agent will set 'isReadyForGeneration: true' in updatedRequirements
        // when it has gathered enough context to orchestrate the budget.
        const isReady = !!result.updatedRequirements?.isReadyForGeneration;

        return {
            success: true,
            response: result.reply,
            // We pass isComplete if the agent says it's ready for generation
            // OR if a budget was already completed via the PDF tool
            isComplete: isReady || !!result.updatedRequirements?.completedBudgetId,
            updatedRequirements: result.updatedRequirements || {}
        };

    } catch (error) {
        console.error('Error processing private client message:', error);
        return { success: false, error: 'Failed to process message' };
    }
}

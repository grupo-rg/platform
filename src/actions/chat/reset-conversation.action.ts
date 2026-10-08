'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';
import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { FirestoreMessageRepository } from '@/backend/chat/infrastructure/firestore-message-repository';
// import { getAuthenticatedUser } from '@/lib/auth/get-authenticated-user';

export async function resetConversationAction(leadId: string) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        // const user = await getAuthenticatedUser();
        // if (!user) return { success: false, error: "Unauthorized" };

        // Ensure the user is resetting their own conversation (or is admin, but let's stick to simple ownership)
        // if (user.uid !== leadId) {
        // If they are admin they might resetting another lead's, but for wizard it's usually self.
        // Let's allow if user.uid matches leadId.
        // If current user is admin, we might need extra check, but for now strict ownership is safer.
        // }

        const conversationRepo = new FirestoreConversationRepository();
        const messageRepo = new FirestoreMessageRepository();

        // Find active conversation for this lead
        const conversations = await conversationRepo.findByLeadId(leadId);

        if (conversations.length === 0) {
            return { success: true, message: "No conversation to delete" };
        }

        // Deleting all conversations for this lead (usually just one active)
        for (const conversation of conversations) {
            // Delete messages first
            await messageRepo.deleteByConversationId(conversation.id);
            // Delete conversation
            await conversationRepo.delete(conversation.id);
        }

        return { success: true };

    } catch (error: any) {
        console.error("[ResetConversation] Error:", error);
        return { success: false, error: error.message };
    }
}

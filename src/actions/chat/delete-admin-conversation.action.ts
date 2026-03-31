'use server';

import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';

export async function deleteAdminConversationAction(conversationId: string) {
    try {
        // You could also add a layer of security here to verify if the conversation
        // belongs to the admin. For now, we trust the dashboard.
        const conversationRepo = new FirestoreConversationRepository();

        // This will only delete the conversation document. If we wanted to, we could
        // delete messages belonging to it too, but Firebase handles document deletions.
        // Doing a recursive delete of subcollections is possible but unnecessary if we
        // just ignore deleted conversation IDs.
        await conversationRepo.delete(conversationId);

        return { success: true };
    } catch (error: any) {
        console.error("Error deleting conversation:", error);
        return { success: false, error: error.message };
    }
}

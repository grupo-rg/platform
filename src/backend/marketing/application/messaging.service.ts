export interface MessagingService {
    sendEmail(leadId: string, templateId: string, variables: Record<string, string>): Promise<void>;
    sendWhatsApp(phone: string, templateId: string, variables: Record<string, string>): Promise<void>;
}

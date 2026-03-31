import { Lead } from '../../domain/marketing/leads/entity/lead';
import { LeadEmail } from '../../domain/marketing/leads/value_objects/lead_email';
import { ILeadRepository } from '../../domain/marketing/leads/repository/i_lead_repository';

export interface CaptureWizardLeadCommand {
    email: string;
    source: string;
    companyProfile?: Record<string, string>;
}

export class CaptureWizardLeadUseCase {
    constructor(private leadRepository: ILeadRepository) { }

    public async execute(command: CaptureWizardLeadCommand): Promise<string> {
        const leadEmail = LeadEmail.create(command.email);

        // Check if lead already exists
        const existingLead = await this.leadRepository.findByEmail(leadEmail.value);

        if (existingLead) {
            if (command.companyProfile) {
                existingLead.addCompanyProfile(command.companyProfile);
                await this.leadRepository.save(existingLead);
            }
            return existingLead.id;
        }

        // Create a new lead
        const newLead = Lead.create({
            id: crypto.randomUUID(),
            email: leadEmail,
            source: command.source,
            companyProfile: command.companyProfile
        });

        await this.leadRepository.save(newLead);
        return newLead.id;
    }
}

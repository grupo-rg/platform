import { Lead } from '../entity/lead';

export interface ILeadRepository {
    save(lead: Lead): Promise<void>;
    findById(id: string): Promise<Lead | null>;
    findByEmail(email: string): Promise<Lead | null>;
}

import { Lead } from './lead';

export interface LeadRepository {
    save(lead: Lead): Promise<void>;
    findById(id: string): Promise<Lead | null>;
    findByEmail(email: string): Promise<Lead | null>;
    findAll(limit: number, offset: number): Promise<Lead[]>;
    countByStatus(): Promise<{ verified: number; unverified: number; profiled: number }>;
    delete(id: string): Promise<void>;
}
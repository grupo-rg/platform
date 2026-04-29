import { Deal } from "./deal";

export interface DealRepository {
    save(deal: Deal): Promise<void>;
    findById(id: string): Promise<Deal | null>;
    /** Devuelve el deal más reciente del lead (latest). */
    findByLeadId(leadId: string): Promise<Deal | null>;
    /** Devuelve TODOS los deals del lead, ordenados por createdAt desc. */
    findAllByLeadId(leadId: string): Promise<Deal[]>;
    findAllByStage(stage: string): Promise<Deal[]>;
    findAll(): Promise<Deal[]>;
}

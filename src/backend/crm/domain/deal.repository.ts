import { Deal } from "./deal";

export interface DealRepository {
    save(deal: Deal): Promise<void>;
    findById(id: string): Promise<Deal | null>;
    findByLeadId(leadId: string): Promise<Deal | null>;
    findAllByStage(stage: string): Promise<Deal[]>;
    findAll(): Promise<Deal[]>;
}

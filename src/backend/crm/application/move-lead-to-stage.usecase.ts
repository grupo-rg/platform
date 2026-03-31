import { DealRepository } from "../domain/deal.repository";
import { PipelineStage } from "../domain/deal";

export class MoveLeadToStageUseCase {
    constructor(private readonly dealRepository: DealRepository) {}

    async execute(leadId: string, newStage: PipelineStage): Promise<void> {
        let deal = await this.dealRepository.findByLeadId(leadId);
        
        if (!deal) {
            throw new Error(`Deal not found for lead: ${leadId}`);
        }

        deal.moveToStage(newStage);
        
        // Here we could publish Domain Events like: 
        // EventBus.publish(new PipelineStageChangedEvent(deal.id, newStage))
        
        await this.dealRepository.save(deal);
    }
}

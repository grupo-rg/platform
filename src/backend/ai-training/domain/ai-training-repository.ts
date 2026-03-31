import { AiTrainingData } from "./ai-training-data";

export interface AiTrainingRepository {
    save(data: AiTrainingData): Promise<void>;
    findById(id: string): Promise<AiTrainingData | null>;
    findByLeadId(leadId: string): Promise<AiTrainingData[]>;
    // Useful method to eventually pull the data for Vertex AI JSONL generation
    findAllWithEdits(): Promise<AiTrainingData[]>;
    findAll(): Promise<AiTrainingData[]>;
}

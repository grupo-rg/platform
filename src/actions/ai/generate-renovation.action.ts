'use server';

import { generateRenderFlow } from '@/backend/ai/private-core/flows/renovation/generate-render.flow';

interface GenerateRenovationParams {
    imageBuffer: string; // Base64 input from client
    style: string;
    roomType: string;
    budgetId: string;
    additionalRequirements?: string;
    aspectRatio?: string;
}

export async function generateRenovationAction({
    imageBuffer,
    style,
    roomType,
    budgetId,
    additionalRequirements,
    aspectRatio
}: GenerateRenovationParams) {
    try {
        // 1. Call AI Flow
        const result = await generateRenderFlow({
            imageBuffer,
            style,
            roomType,
            additionalRequirements,
            aspectRatio: aspectRatio || "16:9"
        });

        if (!result.generatedImage) {
            return { success: false, error: "Failed to generate image" };
        }

        // 2. Return Base64 and Prompt to Client
        return {
            success: true,
            base64: result.generatedImage,
            appliedPrompt: result.appliedPrompt
        };

    } catch (error) {
        console.error("Error in generateRenovationAction:", error);
        return { success: false, error: "Internal Server Error" };
    }
}

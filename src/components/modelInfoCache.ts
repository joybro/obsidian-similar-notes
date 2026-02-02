import { HuggingFaceClient } from "@/adapter/huggingface";
import { OllamaClient } from "@/adapter/ollama";
import type { CachedModelInfo } from "@/application/SettingsService";

/**
 * Fetch and cache model info from the appropriate API based on provider
 */
export async function fetchAndCacheModelInfo(
    provider: "builtin" | "ollama" | "openai" | "gemini",
    modelId: string,
    ollamaUrl?: string
): Promise<CachedModelInfo | undefined> {
    if (provider === "builtin") {
        const client = new HuggingFaceClient();
        const info = await client.getModelInfo(modelId);

        if (info) {
            return {
                modelId,
                parameterCount: info.parameterCount,
                parameterSize: info.parameterSize,
            };
        }
    } else if (provider === "ollama") {
        const url = ollamaUrl || "http://localhost:11434";
        const client = new OllamaClient(url);
        const info = await client.getModelInfo(modelId);

        if (info) {
            return {
                modelId,
                parameterSize: info.parameterSize,
                embeddingLength: info.embeddingLength,
                quantizationLevel: info.quantizationLevel,
            };
        }
    } else if (provider === "openai") {
        // OpenAI doesn't provide a model info API, but we know dimensions for official models
        const knownModels: Record<string, { embeddingLength: number }> = {
            "text-embedding-3-small": { embeddingLength: 1536 },
            "text-embedding-3-large": { embeddingLength: 3072 },
            "text-embedding-ada-002": { embeddingLength: 1536 },
        };

        const knownInfo = knownModels[modelId];
        if (knownInfo) {
            return {
                modelId,
                embeddingLength: knownInfo.embeddingLength,
            };
        }

        // For unknown/custom models, just return the model ID
        return { modelId };
    } else if (provider === "gemini") {
        // Gemini embedding models have known dimensions
        const knownModels: Record<string, { embeddingLength: number }> = {
            "gemini-embedding-001": { embeddingLength: 3072 },
        };

        const knownInfo = knownModels[modelId];
        if (knownInfo) {
            return {
                modelId,
                embeddingLength: knownInfo.embeddingLength,
            };
        }

        // For unknown/custom models, just return the model ID
        return { modelId };
    }

    return undefined;
}

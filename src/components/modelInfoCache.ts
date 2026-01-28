import { HuggingFaceClient } from "@/adapter/huggingface";
import { OllamaClient } from "@/adapter/ollama";
import type { CachedModelInfo } from "@/application/SettingsService";

/**
 * Fetch and cache model info from the appropriate API based on provider
 */
export async function fetchAndCacheModelInfo(
    provider: "builtin" | "ollama" | "openai",
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
        // OpenAI doesn't provide a model info API
        return { modelId };
    }

    return undefined;
}

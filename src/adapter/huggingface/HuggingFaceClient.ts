import log from "loglevel";
import { requestUrl } from "obsidian";

export interface HuggingFaceModelInfo {
    parameterCount?: number;      // Total parameter count
    parameterSize?: string;       // Human-readable size (e.g., "22.7M")
    modelType?: string;           // e.g., "bert"
}

interface HuggingFaceApiResponse {
    safetensors?: {
        parameters?: Record<string, number>;
        total?: number;
    };
    config?: {
        model_type?: string;
        architectures?: string[];
    };
}

function formatParameterCount(count: number): string {
    if (count >= 1_000_000_000) {
        return `${(count / 1_000_000_000).toFixed(1)}B`;
    }
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1)}K`;
    }
    return `${count}`;
}

export class HuggingFaceClient {
    private baseUrl = "https://huggingface.co/api/models";

    async getModelInfo(modelId: string): Promise<HuggingFaceModelInfo | null> {
        try {
            // Use Obsidian's requestUrl to avoid CORS issues
            const response = await requestUrl({
                url: `${this.baseUrl}/${modelId}`,
                method: "GET",
            });

            if (response.status !== 200) {
                log.warn(`Failed to get model info for ${modelId}: status ${response.status}`);
                return null;
            }

            const data: HuggingFaceApiResponse = response.json;

            const parameterCount = data.safetensors?.total;
            const parameterSize = parameterCount
                ? formatParameterCount(parameterCount)
                : undefined;
            const modelType = data.config?.model_type;

            log.debug(`Fetched model info for ${modelId}:`, { parameterCount, parameterSize, modelType });

            return {
                parameterCount,
                parameterSize,
                modelType
            };
        } catch (error) {
            log.error(`Failed to get model info for ${modelId}`, error);
            return null;
        }
    }
}

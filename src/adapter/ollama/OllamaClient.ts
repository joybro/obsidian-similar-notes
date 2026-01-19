import log from "loglevel";

export interface OllamaModel {
    name: string;
    model: string;
    size: number;
    digest: string;
    details: {
        parent_model: string;
        format: string;
        family: string;
        families: string[];
        parameter_size: string;
        quantization_level: string;
    };
    expires_at: string;
    size_vram: number;
}

export interface OllamaModelsResponse {
    models: OllamaModel[];
}

export interface OllamaEmbeddingRequest {
    model: string;
    prompt: string;
}

export interface OllamaEmbeddingResponse {
    embedding: number[];
}

export interface OllamaModelInfo {
    parameterSize: string;      // e.g., "566.70M"
    quantizationLevel: string;  // e.g., "F16"
    family: string;             // e.g., "bert"
    embeddingLength?: number;   // e.g., 1024
    contextLength?: number;     // e.g., 8192
}

export interface OllamaModelWithEmbeddingInfo {
    name: string;
    isEmbeddingModel: boolean;
}

// Known embedding model families
const EMBEDDING_MODEL_FAMILIES = ['bert', 'nomic-bert'];

/**
 * Check if a model is an embedding model based on family or name
 */
function isEmbeddingModel(model: OllamaModel): boolean {
    const family = model.details?.family?.toLowerCase() || '';
    const name = model.name.toLowerCase();

    // Check by family
    if (EMBEDDING_MODEL_FAMILIES.some(f => family.includes(f))) {
        return true;
    }

    // Check by name (e.g., nomic-embed-text, mxbai-embed-large)
    if (name.includes('embed')) {
        return true;
    }

    return false;
}

export class OllamaClient {
    private baseUrl: string;

    constructor(baseUrl = "http://localhost:11434") {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Fetch available models from Ollama server
     */
    async getModels(): Promise<OllamaModel[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.statusText}`);
            }
            
            const data: OllamaModelsResponse = await response.json();
            
            if (!data.models || !Array.isArray(data.models)) {
                log.warn("Ollama API returned invalid models data", data);
                return [];
            }
            
            return data.models;
        } catch (error) {
            log.error("Failed to fetch Ollama models", error);
            throw error;
        }
    }

    /**
     * Get model names only (convenience method)
     */
    async getModelNames(): Promise<string[]> {
        const models = await this.getModels();
        return models.map(model => model.name);
    }

    /**
     * Get models with embedding model classification
     */
    async getModelsWithEmbeddingInfo(): Promise<OllamaModelWithEmbeddingInfo[]> {
        const models = await this.getModels();
        return models.map(model => ({
            name: model.name,
            isEmbeddingModel: isEmbeddingModel(model)
        }));
    }

    /**
     * Generate embeddings for the given text
     */
    async generateEmbedding(model: string, text: string): Promise<number[]> {
        try {
            // Debug logging: track text length and request details
            const textLength = text.length;
            const textByteSize = new Blob([text]).size;
            log.debug(`[Ollama] Generating embedding - text length: ${textLength} chars, ${textByteSize} bytes`);

            const requestBody = JSON.stringify({
                model,
                prompt: text
            } as OllamaEmbeddingRequest);
            const requestSize = new Blob([requestBody]).size;
            log.debug(`[Ollama] Request payload size: ${requestSize} bytes`);

            const startTime = Date.now();
            const response = await fetch(`${this.baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: requestBody
            });
            const elapsed = Date.now() - startTime;

            if (!response.ok) {
                const errorText = await response.text();
                log.error(`[Ollama] Embedding failed after ${elapsed}ms - status: ${response.status}, text length: ${textLength}, request size: ${requestSize} bytes`);
                throw new Error(`Failed to generate embedding: ${response.statusText}. ${errorText}`);
            }

            log.debug(`[Ollama] Embedding successful in ${elapsed}ms`);
            const data: OllamaEmbeddingResponse = await response.json();

            if (!data.embedding || !Array.isArray(data.embedding)) {
                throw new Error("Invalid embedding response from Ollama");
            }

            return data.embedding;
        } catch (error) {
            log.error("Failed to generate embedding", error);
            throw error;
        }
    }

    /**
     * Get detailed information about a specific model
     */
    async getModelInfo(modelName: string): Promise<OllamaModelInfo | null> {
        try {
            const response = await fetch(`${this.baseUrl}/api/show`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: modelName })
            });

            if (!response.ok) {
                log.warn(`Failed to get model info for ${modelName}: ${response.statusText}`);
                return null;
            }

            const data = await response.json();

            const details = data.details || {};
            const modelInfo = data.model_info || {};

            // Find embedding length from model_info (varies by architecture)
            const embeddingLength =
                modelInfo['bert.embedding_length'] ||
                modelInfo['nomic_bert.embedding_length'] ||
                modelInfo['llama.embedding_length'] ||
                undefined;

            // Find context length from model_info
            const contextLength =
                modelInfo['bert.context_length'] ||
                modelInfo['nomic_bert.context_length'] ||
                modelInfo['llama.context_length'] ||
                undefined;

            return {
                parameterSize: details.parameter_size || 'unknown',
                quantizationLevel: details.quantization_level || 'unknown',
                family: details.family || 'unknown',
                embeddingLength,
                contextLength
            };
        } catch (error) {
            log.error(`Failed to get model info for ${modelName}`, error);
            return null;
        }
    }

    /**
     * Test connection to Ollama server by checking if API is accessible
     */
    async testConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            return response.ok;
        } catch (error) {
            log.error("Failed to connect to Ollama server", error);
            return false;
        }
    }

    /**
     * Test if a specific model is available and can generate embeddings
     */
    async testModel(modelName: string): Promise<boolean> {
        try {
            // Try to generate a simple embedding
            await this.generateEmbedding(modelName, "test");
            return true;
        } catch (error) {
            log.error(`Failed to test model ${modelName}`, error);
            return false;
        }
    }

    /**
     * Update the base URL
     */
    setBaseUrl(url: string): void {
        this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    }

    /**
     * Get the current base URL
     */
    getBaseUrl(): string {
        return this.baseUrl;
    }
}
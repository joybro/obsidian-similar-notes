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

export class OllamaClient {
    private baseUrl: string;

    constructor(baseUrl: string = "http://localhost:11434") {
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
     * Generate embeddings for the given text
     */
    async generateEmbedding(model: string, text: string): Promise<number[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    prompt: text
                } as OllamaEmbeddingRequest)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to generate embedding: ${response.statusText}. ${errorText}`);
            }
            
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
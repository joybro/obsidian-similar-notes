import { requestUrl } from "obsidian";
import log from "loglevel";

export interface OpenAIModel {
    id: string;
    object: string;
    created: number;
    owned_by: string;
}

export interface OpenAIModelsResponse {
    object: string;
    data: OpenAIModel[];
}

export interface OpenAIEmbeddingRequest {
    model: string;
    input: string | string[];
    encoding_format?: "float";
}

export interface OpenAIEmbeddingData {
    object: string;
    index: number;
    embedding: number[];
}

export interface OpenAIEmbeddingResponse {
    object: string;
    data: OpenAIEmbeddingData[];
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}

export class OpenAIClient {
    private baseUrl: string;
    private apiKey: string;

    constructor(baseUrl: string, apiKey = "") {
        this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
        this.apiKey = apiKey;
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (this.apiKey) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    /**
     * Fetch available models from OpenAI-compatible server
     */
    async getModels(): Promise<OpenAIModel[]> {
        try {
            const response = await requestUrl
            ({
                url: `${this.baseUrl}/models`,
                method: "GET",
                headers: this.getHeaders(),
                throw: false 
            });

            if (response.status >= 400) {
                log.warn(`Failed to fetch models: ${response.status} ${response.text}`);
                return [];
            }

            const data = response.json as OpenAIModelsResponse;
            
            if (!data.data || !Array.isArray(data.data)) {
                log.warn("OpenAI API returned invalid models data", data);
                return [];
            }

            return data.data;
        } catch (error) {
            log.error("Failed to fetch OpenAI models", error);
            return [];
        }
    }

    /**
     * Get model names only
     */
    async getModelNames(): Promise<string[]> {
        const models = await this.getModels();
        return models.map((model) => model.id);
    }

    /**
     * Generate embeddings for the given text
     */
    async generateEmbedding(model: string, text: string): Promise<number[]> {
        try {
            const requestBody: OpenAIEmbeddingRequest = {
                model,
                input: text,
            };

            const response = await requestUrl({
                url: `${this.baseUrl}/embeddings`,
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify(requestBody),
                throw: false
            });

            if (response.status >= 400) {
                throw new Error(
                    `Failed to generate embedding: ${response.status}. ${response.text}`
                );
            }

            const data = response.json as OpenAIEmbeddingResponse;

            if (!data.data || data.data.length === 0 || !data.data[0].embedding) {
                throw new Error("Invalid embedding response from OpenAI server");
            }

            return data.data[0].embedding;
        } catch (error) {
            log.error("Failed to generate embedding with OpenAI", error);
            throw error;
        }
    }

    async generateEmbeddings(model: string, texts: string[]): Promise<number[][]> {
         try {
            const requestBody: OpenAIEmbeddingRequest = {
                model,
                input: texts,
            };

            const response = await requestUrl({
                url: `${this.baseUrl}/embeddings`,
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify(requestBody),
                throw: false
            });

            if (response.status >= 400) {
                 throw new Error(
                    `Failed to generate embeddings: ${response.status}. ${response.text}`
                );
            }

             const data = response.json as OpenAIEmbeddingResponse;

            if (!data.data || !Array.isArray(data.data)) {
                 throw new Error("Invalid embedding response from OpenAI server");
            }
            
            // Sort by index to ensure order matches input
            return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);

        } catch (error) {
             log.error("Failed to generate embeddings with OpenAI", error);
            throw error;
        }
    }

    /**
     * Test connection to server
     */
    async testConnection(): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: `${this.baseUrl}/models`,
                method: "GET",
                headers: this.getHeaders(),
                throw: false
            });
            return response.status < 400;
        } catch (error) {
            log.error("Failed to connect to OpenAI server", error);
            return false;
        }
    }

     /**
     * Test if a specific model works
     */
    async testModel(model: string): Promise<boolean> {
        try {
            await this.generateEmbedding(model, "test");
            return true;
        } catch (error) {
             log.error(`Failed to test model ${model}`, error);
            return false;
        }
    }
    
    setBaseUrl(url: string) {
         this.baseUrl = url.replace(/\/$/, "");
    }
    
    setApiKey(apiKey: string) {
        this.apiKey = apiKey;
    }
}

import log from "loglevel";
import { requestUrl } from "obsidian";

export interface OpenAIEmbeddingRequest {
    model: string;
    input: string | string[];
}

export interface OpenAIEmbeddingData {
    object: "embedding";
    index: number;
    embedding: number[];
}

export interface OpenAIUsage {
    prompt_tokens: number;
    total_tokens: number;
}

export interface OpenAIEmbeddingResponse {
    object: "list";
    data: OpenAIEmbeddingData[];
    model: string;
    usage?: OpenAIUsage;
}

export interface OpenAIEmbeddingResult {
    embedding: number[];
    usage?: OpenAIUsage;
}

export interface OpenAIBatchEmbeddingResult {
    embeddings: number[][];
    usage?: OpenAIUsage;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAIClient {
    private baseUrl: string;
    private apiKey?: string;

    constructor(baseUrl: string = DEFAULT_BASE_URL, apiKey?: string) {
        this.baseUrl = this.normalizeUrl(baseUrl);
        this.apiKey = apiKey;
    }

    /**
     * Normalize URL by removing trailing slash
     */
    private normalizeUrl(url: string): string {
        return url.endsWith("/") ? url.slice(0, -1) : url;
    }

    /**
     * Build headers for API requests
     */
    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        if (this.apiKey) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        return headers;
    }

    /**
     * Generate embedding for a single text
     */
    async embedText(model: string, text: string): Promise<OpenAIEmbeddingResult> {
        try {
            const textLength = text.length;
            log.debug(`[OpenAI] Generating embedding - text length: ${textLength} chars`);

            const startTime = Date.now();
            const response = await requestUrl({
                url: `${this.baseUrl}/embeddings`,
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify({
                    model,
                    input: text,
                } as OpenAIEmbeddingRequest),
                throw: false,
            });
            const elapsed = Date.now() - startTime;

            if (response.status >= 400) {
                log.error(`[OpenAI] Embedding failed after ${elapsed}ms - status: ${response.status}`);
                throw new Error(`Failed to generate embedding: ${response.status}. ${response.text}`);
            }

            log.debug(`[OpenAI] Embedding successful in ${elapsed}ms`);
            const data: OpenAIEmbeddingResponse = response.json;

            if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
                throw new Error("Invalid embedding response from OpenAI: missing data array");
            }

            const embeddingData = data.data[0];
            if (!embeddingData.embedding || !Array.isArray(embeddingData.embedding)) {
                throw new Error("Invalid embedding response from OpenAI: missing embedding");
            }

            return {
                embedding: embeddingData.embedding,
                usage: data.usage,
            };
        } catch (error) {
            log.error("Failed to generate embedding with OpenAI:", error);
            throw error;
        }
    }

    /**
     * Generate embeddings for multiple texts in batch
     */
    async embedTexts(model: string, texts: string[]): Promise<OpenAIBatchEmbeddingResult> {
        if (texts.length === 0) {
            return { embeddings: [] };
        }

        try {
            log.debug(`[OpenAI] Generating batch embeddings - ${texts.length} texts`);

            const startTime = Date.now();
            const response = await requestUrl({
                url: `${this.baseUrl}/embeddings`,
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify({
                    model,
                    input: texts,
                } as OpenAIEmbeddingRequest),
                throw: false,
            });
            const elapsed = Date.now() - startTime;

            if (response.status >= 400) {
                log.error(`[OpenAI] Batch embedding failed after ${elapsed}ms - status: ${response.status}`);
                throw new Error(`Failed to generate embeddings: ${response.status}. ${response.text}`);
            }

            log.debug(`[OpenAI] Batch embedding successful in ${elapsed}ms`);
            const data: OpenAIEmbeddingResponse = response.json;

            if (!data.data || !Array.isArray(data.data)) {
                throw new Error("Invalid embedding response from OpenAI: missing data array");
            }

            // Sort by index to ensure correct order
            const sortedData = [...data.data].sort((a, b) => a.index - b.index);
            const embeddings = sortedData.map((d) => d.embedding);

            return {
                embeddings,
                usage: data.usage,
            };
        } catch (error) {
            log.error("Failed to generate batch embeddings with OpenAI:", error);
            throw error;
        }
    }

    /**
     * Test connection to the OpenAI-compatible server with a specific model
     */
    async testConnection(model: string): Promise<boolean> {
        try {
            await this.embedText(model, "test");
            return true;
        } catch (error) {
            log.error("Failed to test OpenAI connection:", error);
            return false;
        }
    }

    /**
     * Update the base URL
     */
    setBaseUrl(url: string): void {
        this.baseUrl = this.normalizeUrl(url);
    }

    /**
     * Get the current base URL
     */
    getBaseUrl(): string {
        return this.baseUrl;
    }

    /**
     * Update the API key
     */
    setApiKey(apiKey: string | undefined): void {
        this.apiKey = apiKey;
    }

    /**
     * Check if API key is set
     */
    hasApiKey(): boolean {
        return !!this.apiKey;
    }
}

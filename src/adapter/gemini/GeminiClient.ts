import log from "loglevel";
import { requestUrl } from "obsidian";

export interface GeminiEmbedRequest {
    content: {
        parts: Array<{ text: string }>;
    };
    taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" | "CLASSIFICATION" | "CLUSTERING";
}

export interface GeminiBatchEmbedRequest {
    requests: Array<{
        model: string;
        content: {
            parts: Array<{ text: string }>;
        };
        taskType?: string;
    }>;
}

export interface GeminiEmbedResponse {
    embedding: {
        values: number[];
    };
}

export interface GeminiBatchEmbedResponse {
    embeddings: Array<{
        values: number[];
    }>;
}

export interface GeminiEmbeddingResult {
    embedding: number[];
}

export interface GeminiBatchEmbeddingResult {
    embeddings: number[][];
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiClient {
    private baseUrl: string;
    private apiKey?: string;

    constructor(apiKey?: string, baseUrl: string = DEFAULT_BASE_URL) {
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
            headers["x-goog-api-key"] = this.apiKey;
        }

        return headers;
    }

    /**
     * Generate embedding for a single text
     */
    async embedText(model: string, text: string): Promise<GeminiEmbeddingResult> {
        try {
            const textLength = text.length;
            log.debug(`[Gemini] Generating embedding - text length: ${textLength} chars`);

            const startTime = Date.now();
            const response = await requestUrl({
                url: `${this.baseUrl}/models/${model}:embedContent`,
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify({
                    content: {
                        parts: [{ text }],
                    },
                    taskType: "RETRIEVAL_DOCUMENT",
                } as GeminiEmbedRequest),
                throw: false,
            });
            const elapsed = Date.now() - startTime;

            if (response.status >= 400) {
                log.error(`[Gemini] Embedding failed after ${elapsed}ms - status: ${response.status}`);
                throw new Error(`Failed to generate embedding: ${response.status}. ${response.text}`);
            }

            log.debug(`[Gemini] Embedding successful in ${elapsed}ms`);
            const data: GeminiEmbedResponse = response.json;

            if (!data.embedding || !Array.isArray(data.embedding.values)) {
                throw new Error("Invalid embedding response from Gemini: missing embedding values");
            }

            return {
                embedding: data.embedding.values,
            };
        } catch (error) {
            log.error("Failed to generate embedding with Gemini:", error);
            throw error;
        }
    }

    /**
     * Generate embeddings for multiple texts in batch
     */
    async embedTexts(model: string, texts: string[]): Promise<GeminiBatchEmbeddingResult> {
        if (texts.length === 0) {
            return { embeddings: [] };
        }

        try {
            log.debug(`[Gemini] Generating batch embeddings - ${texts.length} texts`);

            const startTime = Date.now();
            const response = await requestUrl({
                url: `${this.baseUrl}/models/${model}:batchEmbedContents`,
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify({
                    requests: texts.map((text) => ({
                        model: `models/${model}`,
                        content: {
                            parts: [{ text }],
                        },
                        taskType: "RETRIEVAL_DOCUMENT",
                    })),
                } as GeminiBatchEmbedRequest),
                throw: false,
            });
            const elapsed = Date.now() - startTime;

            if (response.status >= 400) {
                log.error(`[Gemini] Batch embedding failed after ${elapsed}ms - status: ${response.status}`);
                throw new Error(`Failed to generate embeddings: ${response.status}. ${response.text}`);
            }

            log.debug(`[Gemini] Batch embedding successful in ${elapsed}ms`);
            const data: GeminiBatchEmbedResponse = response.json;

            if (!data.embeddings || !Array.isArray(data.embeddings)) {
                throw new Error("Invalid embedding response from Gemini: missing embeddings array");
            }

            const embeddings = data.embeddings.map((e) => e.values);

            return {
                embeddings,
            };
        } catch (error) {
            log.error("Failed to generate batch embeddings with Gemini:", error);
            throw error;
        }
    }

    /**
     * Test connection to the Gemini API with a specific model
     */
    async testConnection(model: string): Promise<boolean> {
        try {
            await this.embedText(model, "test");
            return true;
        } catch (error) {
            log.error("Failed to test Gemini connection:", error);
            return false;
        }
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

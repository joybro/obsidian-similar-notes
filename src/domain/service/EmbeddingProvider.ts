import { type Observable } from "rxjs";

export interface ModelInfo {
    vectorSize: number;
    maxTokens: number;
}

export interface EmbeddingProvider {
    /**
     * Load the embedding model
     */
    loadModel(modelId: string, config?: any): Promise<ModelInfo>;

    /**
     * Unload the current model and clean up resources
     */
    unloadModel(): Promise<void>;

    /**
     * Embed a single text
     */
    embedText(text: string): Promise<number[]>;

    /**
     * Embed multiple texts in batch
     */
    embedTexts(texts: string[]): Promise<number[][]>;

    /**
     * Count tokens in text
     */
    countTokens(text: string): Promise<number>;

    /**
     * Get the vector size of the current model
     */
    getVectorSize(): number;

    /**
     * Get the maximum tokens the model can handle
     */
    getMaxTokens(): number;

    /**
     * Get observable for model busy status
     */
    getModelBusy$(): Observable<boolean>;

    /**
     * Get observable for download progress (0-100)
     */
    getDownloadProgress$(): Observable<number>;

    /**
     * Check if model is currently loaded
     */
    isModelLoaded(): boolean;

    /**
     * Get the current model ID
     */
    getCurrentModelId(): string | null;

    /**
     * Dispose and clean up all resources
     */
    dispose(): void;
}
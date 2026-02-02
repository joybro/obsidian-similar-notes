import type { CachedModelInfo, SimilarNotesSettings } from "@/application/SettingsService";

/**
 * Builds a human-readable description of the current model configuration
 */
export function buildCurrentModelDescription(
    settings: SimilarNotesSettings,
    cachedInfo?: CachedModelInfo
): string {
    const { modelProvider } = settings;
    const modelId =
        modelProvider === "builtin" ? settings.modelId
            : modelProvider === "ollama" ? settings.ollamaModel
                : modelProvider === "openai" ? settings.openaiModel
                    : settings.geminiModel;

    if (!modelId && modelProvider !== "builtin") {
        if (modelProvider === "openai") return "OpenAI: Not configured";
        if (modelProvider === "gemini") return "Gemini: Not configured";
        return "Not configured";
    }

    const hasValidCache = cachedInfo && cachedInfo.modelId === modelId;
    const parts: string[] = [];

    if (hasValidCache) {
        if (cachedInfo.parameterSize) parts.push(cachedInfo.parameterSize);
        if (cachedInfo.quantizationLevel) parts.push(cachedInfo.quantizationLevel);
        if (cachedInfo.embeddingLength) parts.push(`${cachedInfo.embeddingLength}-dim`);
    }

    if (modelProvider === "builtin") {
        parts.push(settings.useGPU ? "GPU" : "CPU");
        return `Built-in: ${modelId} (${parts.join(", ")})`;
    }

    const prefixMap: Record<string, string> = {
        ollama: "Ollama",
        openai: "OpenAI",
        gemini: "Gemini",
    };
    const prefix = prefixMap[modelProvider] || modelProvider;
    return parts.length > 0 ? `${prefix}: ${modelId} (${parts.join(", ")})` : `${prefix}: ${modelId}`;
}

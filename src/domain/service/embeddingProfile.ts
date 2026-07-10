import type { EmbeddingModelSettings } from "@/application/SettingsService";

export function getEffectiveModelId(settings: EmbeddingModelSettings): string {
    if (settings.modelProvider === "builtin") {
        return settings.modelId;
    }
    if (settings.modelProvider === "ollama") {
        return settings.ollamaModel ?? "";
    }
    if (settings.modelProvider === "openai") {
        return settings.openaiModel ?? "text-embedding-3-small";
    }
    return settings.geminiModel ?? "gemini-embedding-001";
}

/** Runtime equality includes credentials and execution mode but is never logged. */
export function embeddingProfilesEqual(
    left: EmbeddingModelSettings,
    right: EmbeddingModelSettings
): boolean {
    if (left.modelProvider !== right.modelProvider) {
        return false;
    }
    if (getEffectiveModelId(left) !== getEffectiveModelId(right)) {
        return false;
    }

    if (left.modelProvider === "builtin") {
        return left.useGPU === right.useGPU;
    }
    if (left.modelProvider === "ollama") {
        return (
            (left.ollamaUrl ?? "http://localhost:11434") ===
            (right.ollamaUrl ?? "http://localhost:11434")
        );
    }
    if (left.modelProvider === "openai") {
        return (
            (left.openaiUrl ?? "https://api.openai.com/v1") ===
                (right.openaiUrl ?? "https://api.openai.com/v1") &&
            left.openaiApiKey === right.openaiApiKey &&
            (left.openaiMaxTokens ?? 8191) ===
                (right.openaiMaxTokens ?? 8191)
        );
    }
    return left.geminiApiKey === right.geminiApiKey;
}

/**
 * Persistable index identity. Credentials and GPU mode are intentionally absent:
 * changing either reloads the provider but does not invalidate existing vectors.
 */
export function getEmbeddingIndexFingerprint(
    settings: EmbeddingModelSettings
): string {
    const base = [settings.modelProvider, getEffectiveModelId(settings)];
    if (settings.modelProvider === "ollama") {
        base.push(settings.ollamaUrl ?? "http://localhost:11434");
    } else if (settings.modelProvider === "openai") {
        base.push(
            settings.openaiUrl ?? "https://api.openai.com/v1",
            String(settings.openaiMaxTokens ?? 8191)
        );
    }
    return base.join(":");
}

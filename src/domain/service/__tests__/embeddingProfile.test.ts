import type { EmbeddingModelSettings } from "@/application/SettingsService";
import { describe, expect, test } from "vitest";
import {
    embeddingProfilesEqual,
    getEffectiveModelId,
    getEmbeddingIndexFingerprint,
} from "../embeddingProfile";

describe("embedding profile identity", () => {
    const profile: EmbeddingModelSettings = {
        modelProvider: "openai",
        modelId: "unused",
        openaiUrl: "https://example.test/v1",
        openaiApiKey: "secret-a",
        openaiModel: "code-model",
        openaiMaxTokens: 4096,
        useGPU: false,
    };

    test("uses the provider-specific effective model ID", () => {
        expect(getEffectiveModelId(profile)).toBe("code-model");
    });

    test("runtime equality includes credentials", () => {
        expect(
            embeddingProfilesEqual(profile, {
                ...profile,
                openaiApiKey: "secret-b",
            })
        ).toBe(false);
    });

    test("runtime equality ignores fields owned by inactive providers", () => {
        const builtin: EmbeddingModelSettings = {
            modelProvider: "builtin",
            modelId: "local-model",
            useGPU: false,
            openaiApiKey: "old-note-key",
        };
        expect(
            embeddingProfilesEqual(builtin, {
                ...builtin,
                openaiApiKey: "different-unused-key",
            })
        ).toBe(true);
    });

    test("index identity excludes credentials and GPU execution mode", () => {
        expect(
            getEmbeddingIndexFingerprint(profile)
        ).toBe(
            getEmbeddingIndexFingerprint({
                ...profile,
                openaiApiKey: "secret-b",
                useGPU: true,
            })
        );
    });

    test("index identity changes with the embedding model", () => {
        expect(getEmbeddingIndexFingerprint(profile)).not.toBe(
            getEmbeddingIndexFingerprint({
                ...profile,
                openaiModel: "other-model",
            })
        );
    });
});

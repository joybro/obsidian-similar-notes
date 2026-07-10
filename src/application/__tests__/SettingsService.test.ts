import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
    Platform: { isMobileApp: false },
}));

import {
    SettingsService,
    snapshotNoteModelSettings,
} from "../SettingsService";
import { shouldExcludeFile } from "@/utils/folderExclusion";

describe("SettingsService defaults (spec item 4)", () => {
    it("defaults semanticLinkTrigger to ';;' when there is no saved data", async () => {
        const plugin = {
            loadData: vi.fn().mockResolvedValue(undefined),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        const svc = new SettingsService(plugin as never);
        await svc.load();
        expect(svc.get().semanticLinkTrigger).toBe(";;");
    });

    it("keeps Code Mode opt-in and leaves its model unset by default", async () => {
        const plugin = {
            loadData: vi.fn().mockResolvedValue(undefined),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        const svc = new SettingsService(plugin as never);

        await svc.load();

        expect(svc.get().codeModeEnabled).toBe(false);
        expect(svc.get().codeModel).toBeUndefined();
    });

    it("preserves legacy flat note-model settings", async () => {
        const plugin = {
            loadData: vi.fn().mockResolvedValue({
                modelProvider: "ollama",
                modelId: "legacy-builtin-model",
                ollamaUrl: "http://embedding-host:11434",
                ollamaModel: "nomic-embed-text",
                useGPU: false,
            }),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        const svc = new SettingsService(plugin as never);

        await svc.load();

        expect(svc.get()).toMatchObject({
            modelProvider: "ollama",
            modelId: "legacy-builtin-model",
            ollamaUrl: "http://embedding-host:11434",
            ollamaModel: "nomic-embed-text",
            useGPU: false,
            codeModeEnabled: false,
        });
        expect(svc.get().codeModel).toBeUndefined();
    });

    it("deep-merges a persisted nested code model with model defaults", async () => {
        const plugin = {
            loadData: vi.fn().mockResolvedValue({
                codeModeEnabled: true,
                codeModel: {
                    modelProvider: "openai",
                    openaiModel: "code-embedding-model",
                },
            }),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        const svc = new SettingsService(plugin as never);

        await svc.load();

        expect(svc.get().codeModel).toEqual({
            modelProvider: "openai",
            modelId: "sentence-transformers/all-MiniLM-L6-v2",
            openaiModel: "code-embedding-model",
            useGPU: true,
            cachedModelInfo: undefined,
        });
    });

    it("snapshots the current note model without sharing cached model state", async () => {
        const plugin = {
            loadData: vi.fn().mockResolvedValue({
                modelProvider: "openai",
                modelId: "legacy-builtin-model",
                openaiUrl: "https://openrouter.ai/api/v1",
                openaiApiKey: "test-key",
                openaiModel: "text-embedding-3-small",
                useGPU: false,
                cachedModelInfo: {
                    modelId: "text-embedding-3-small",
                    embeddingLength: 1536,
                },
            }),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        const svc = new SettingsService(plugin as never);
        await svc.load();

        const snapshot = snapshotNoteModelSettings(svc.get());

        expect(snapshot).toMatchObject({
            modelProvider: "openai",
            openaiUrl: "https://openrouter.ai/api/v1",
            openaiModel: "text-embedding-3-small",
            useGPU: false,
        });
        const cachedModelInfo = snapshot.cachedModelInfo;
        expect(cachedModelInfo).toBeDefined();
        if (!cachedModelInfo) throw new Error("Expected cached model info");
        cachedModelInfo.embeddingLength = 768;
        expect(svc.get().cachedModelInfo?.embeddingLength).toBe(1536);
    });

    // Excalidraw notes are ~all binary drawing data (base64 compressed JSON),
    // which can't be embedded and isn't meaningful to index. New installs
    // exclude the default Excalidraw/ folder out of the box (#46).
    it("excludes the Excalidraw/ folder by default", async () => {
        const plugin = {
            loadData: vi.fn().mockResolvedValue(undefined),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        const svc = new SettingsService(plugin as never);
        await svc.load();
        const patterns = svc.get().excludeFolderPatterns;
        expect(
            shouldExcludeFile("Excalidraw/Monzo Web Crawler.md", patterns)
        ).toBe(true);
        // A normal note is still indexed.
        expect(shouldExcludeFile("Notes/Daily.md", patterns)).toBe(false);
    });
});

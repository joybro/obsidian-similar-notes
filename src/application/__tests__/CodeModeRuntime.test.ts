import type {
    EmbeddingModelSettings,
    SettingsService,
    SimilarNotesSettings,
} from "@/application/SettingsService";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import { FencedCodeBlockExtractor } from "@/infrastructure/FencedCodeBlockExtractor";
import type { App } from "obsidian";
import { describe, expect, test, vi } from "vitest";
import { CodeModeRuntime } from "../CodeModeRuntime";
import type { SimilarNoteCoordinator } from "../SimilarNoteCoordinator";

vi.mock("@/domain/service/EmbeddingService", () => ({
    EmbeddingService: class MockEmbeddingService {},
}));

function makeSettings(
    overrides: Partial<SimilarNotesSettings> = {}
): SimilarNotesSettings {
    return {
        modelProvider: "builtin",
        modelId: "notes-model",
        useGPU: false,
        codeModeEnabled: false,
        similarityMode: "notes",
        codeIndexVersion: 1,
        includeFrontmatter: false,
        showSourceChunk: false,
        excludeFolderPatterns: [],
        excludeRegexPatterns: [],
        regexpTestInputText: "",
        noteDisplayMode: "smart",
        showAtBottom: true,
        sidebarResultCount: 10,
        bottomResultCount: 5,
        minSimilarityThreshold: 0,
        indexingDelaySeconds: 1,
        semanticLinkTrigger: ";;",
        ...overrides,
    };
}

function makeRuntime(initial: SimilarNotesSettings) {
    let settings = initial;
    const rebuildNotes = vi.fn().mockResolvedValue(undefined);
    const settingsService = {
        get: vi.fn(() => settings),
        update: vi.fn(async (changes: Partial<SimilarNotesSettings>) => {
            settings = { ...settings, ...changes };
        }),
    } as unknown as SettingsService;
    const coordinator = {
        setCodeSimilarNoteFinder: vi.fn(),
        runSearchTransition: vi.fn(
            async (_mode: string, operation: () => Promise<unknown>) =>
                operation()
        ),
        runSearchOperation: vi.fn(
            async (_mode: string, operation: () => Promise<unknown>) =>
                operation()
        ),
    } as unknown as SimilarNoteCoordinator;
    const runtime = new CodeModeRuntime({
        app: { vault: {} } as unknown as App,
        settingsService,
        noteRepository: {} as NoteRepository,
        notesModelService: {} as EmbeddingService,
        similarNoteCoordinator: coordinator,
        extractor: new FencedCodeBlockExtractor(),
        rebuildNotesForModeToggle: rebuildNotes,
    });
    return { runtime, settingsService, rebuildNotes, getSettings: () => settings };
}

describe("CodeModeRuntime reindex decisions", () => {
    const builtinCodeModel: EmbeddingModelSettings = {
        modelProvider: "builtin",
        modelId: "code-model",
        useGPU: false,
    };

    test("enabling rebuilds Notes and starts a fresh Code index", async () => {
        const { runtime, rebuildNotes, getSettings } = makeRuntime(makeSettings());
        const initialize = vi
            .spyOn(runtime as never, "initializeUnlocked")
            .mockResolvedValue(undefined);

        await runtime.applyChanges(true, builtinCodeModel);

        expect(rebuildNotes).toHaveBeenCalledOnce();
        expect(initialize).toHaveBeenCalledWith(false);
        expect(getSettings().codeModeEnabled).toBe(true);
    });

    test("credential-only changes reload existing Code vectors", async () => {
        const previous: EmbeddingModelSettings = {
            modelProvider: "openai",
            modelId: "unused",
            openaiUrl: "https://example.test/v1",
            openaiApiKey: "old",
            openaiModel: "code-model",
            useGPU: false,
        };
        const { runtime, rebuildNotes } = makeRuntime(
            makeSettings({ codeModeEnabled: true, codeModel: previous })
        );
        const initialize = vi
            .spyOn(runtime as never, "initializeUnlocked")
            .mockResolvedValue(undefined);

        await runtime.applyChanges(true, { ...previous, openaiApiKey: "new" });

        expect(rebuildNotes).not.toHaveBeenCalled();
        expect(initialize).toHaveBeenCalledWith(true);
    });

    test("changing the Code model rebuilds only the Code index", async () => {
        const { runtime, rebuildNotes } = makeRuntime(
            makeSettings({
                codeModeEnabled: true,
                codeModel: builtinCodeModel,
            })
        );
        const initialize = vi
            .spyOn(runtime as never, "initializeUnlocked")
            .mockResolvedValue(undefined);

        await runtime.applyChanges(true, {
            ...builtinCodeModel,
            modelId: "new-code-model",
        });

        expect(rebuildNotes).not.toHaveBeenCalled();
        expect(initialize).toHaveBeenCalledWith(false);
    });

    test("disabling removes Code mode and restores Notes corpus", async () => {
        const { runtime, rebuildNotes, getSettings } = makeRuntime(
            makeSettings({
                codeModeEnabled: true,
                similarityMode: "code",
                codeModel: builtinCodeModel,
            })
        );

        await runtime.applyChanges(false, builtinCodeModel);

        expect(rebuildNotes).toHaveBeenCalledOnce();
        expect(getSettings().codeModeEnabled).toBe(false);
        expect(getSettings().similarityMode).toBe("notes");
    });

    test("failed Code initialization restores the previous settings", async () => {
        const initial = makeSettings();
        const { runtime, getSettings } = makeRuntime(initial);
        vi.spyOn(runtime as never, "initializeUnlocked").mockRejectedValueOnce(
            new Error("invalid model")
        );

        await expect(
            runtime.applyChanges(true, builtinCodeModel)
        ).rejects.toThrow("invalid model");

        expect(getSettings().codeModeEnabled).toBe(false);
        expect(getSettings().codeModel).toBeUndefined();
    });

    test("a shared Code model detaches when Notes settings diverge", async () => {
        const initial = makeSettings({
            codeModeEnabled: true,
            codeModel: {
                modelProvider: "builtin",
                modelId: "notes-model",
                useGPU: false,
            },
        });
        const { runtime, settingsService } = makeRuntime(initial);
        const notesModelService = {
            switchProvider: vi.fn().mockResolvedValue(undefined),
        };
        Object.assign(runtime as object, {
            sharesNotesModelService: true,
            indexingService: {
                stopLoop: vi.fn(),
                waitUntilIdle: vi.fn().mockResolvedValue(undefined),
                startLoop: vi.fn(),
            },
        });
        Object.assign(runtime["options"], { notesModelService });
        await settingsService.update({ modelId: "new-notes-model" });
        const initialize = vi
            .spyOn(runtime as never, "initializeUnlocked")
            .mockResolvedValue(undefined);

        await runtime.switchNotesModel({
            modelProvider: "builtin",
            modelId: "new-notes-model",
            useGPU: false,
        });

        expect(notesModelService.switchProvider).toHaveBeenCalledOnce();
        expect(initialize).toHaveBeenCalledWith(true);
    });

    test("a failed shared-model detach does not switch the Notes model", async () => {
        const initial = makeSettings({
            codeModeEnabled: true,
            codeModel: {
                modelProvider: "builtin",
                modelId: "notes-model",
                useGPU: false,
            },
        });
        const { runtime, settingsService } = makeRuntime(initial);
        const notesModelService = {
            switchProvider: vi.fn().mockResolvedValue(undefined),
        };
        Object.assign(runtime as object, { sharesNotesModelService: true });
        Object.assign(runtime["options"], { notesModelService });
        await settingsService.update({ modelId: "new-notes-model" });
        const initialize = vi
            .spyOn(runtime as never, "initializeUnlocked")
            .mockRejectedValueOnce(new Error("old Code model unavailable"))
            .mockResolvedValueOnce(undefined);

        await expect(
            runtime.switchNotesModel({
                modelProvider: "builtin",
                modelId: "new-notes-model",
                useGPU: false,
            })
        ).rejects.toThrow("old Code model unavailable");

        expect(initialize).toHaveBeenNthCalledWith(1, true);
        expect(initialize).toHaveBeenNthCalledWith(2, true, true);
        expect(notesModelService.switchProvider).not.toHaveBeenCalled();
    });

    test("teardown drains indexing and closes Code metadata stores", async () => {
        const { runtime } = makeRuntime(
            makeSettings({ codeModeEnabled: true })
        );
        const steps: string[] = [];
        const syncStep = (name: string) =>
            vi.fn(() => {
                steps.push(name);
            });
        const asyncStep = (name: string) =>
            vi.fn(async () => {
                steps.push(name);
            });
        const chunkRepository = {
            init: asyncStep("repository:init"),
            dispose: asyncStep("repository:dispose"),
        };
        const indexedNotesMTimeStore = {
            clear: asyncStep("mtimes:clear"),
            close: syncStep("mtimes:close"),
        };
        const erroredNoteStore = {
            clear: asyncStep("errors:clear"),
            close: syncStep("errors:close"),
        };
        const modelService = {
            getVectorSize: vi.fn(() => 384),
            disposeWhenIdle: asyncStep("model:dispose"),
        };

        Object.assign(runtime["options"].app as object, {
            appId: "vault-id",
        });
        Object.assign(runtime as object, {
            indexingService: {
                stopLoop: syncStep("indexing:stop"),
                waitUntilIdle: asyncStep("indexing:drain"),
            },
            changeQueue: { cleanup: syncStep("queue:cleanup") },
            chunkRepository,
            indexedNotesMTimeStore,
            erroredNoteStore,
            modelService,
            sharesNotesModelService: false,
        });

        await runtime.dispose(true);

        expect(chunkRepository.init).toHaveBeenCalledWith(
            384,
            "vault-id",
            false
        );
        expect(steps).toEqual([
            "indexing:stop",
            "indexing:drain",
            "queue:cleanup",
            "repository:init",
            "mtimes:clear",
            "errors:clear",
            "mtimes:close",
            "errors:close",
            "repository:dispose",
            "model:dispose",
        ]);
    });
});

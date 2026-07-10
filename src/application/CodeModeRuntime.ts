import { OramaNoteChunkRepository } from "@/adapter/orama/OramaNoteChunkRepository";
import {
    CURRENT_CODE_INDEX_VERSION,
    snapshotNoteModelSettings,
    type EmbeddingModelSettings,
    type SettingsService,
} from "@/application/SettingsService";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import { EmbeddingService } from "@/domain/service/EmbeddingService";
import {
    embeddingProfilesEqual,
    getEmbeddingIndexFingerprint,
} from "@/domain/service/embeddingProfile";
import { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import {
    type TextSearch,
    TextSearchService,
} from "@/domain/service/TextSearchService";
import { ErroredNoteStore } from "@/infrastructure/ErroredNoteStore";
import { FencedCodeBlockExtractor } from "@/infrastructure/FencedCodeBlockExtractor";
import { FencedCodeNoteChunkingService } from "@/infrastructure/FencedCodeNoteChunkingService";
import { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import { LinePreservingCodeChunkingService } from "@/infrastructure/LinePreservingCodeChunkingService";
import { NoteChangeQueue } from "@/services/noteChangeQueue";
import log from "loglevel";
import { Notice, Platform, type App } from "obsidian";
import { NoteIndexingService } from "./NoteIndexingService";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";

interface CodeModeRuntimeOptions {
    app: App;
    settingsService: SettingsService;
    noteRepository: NoteRepository;
    notesModelService: EmbeddingService;
    similarNoteCoordinator: SimilarNoteCoordinator;
    extractor: FencedCodeBlockExtractor;
    rebuildNotesForModeToggle: () => Promise<void>;
}

export interface CodeModeStatus {
    indexedNotes: number;
    chunks: number;
    erroredNotes: number;
}

/** Owns every optional Code index resource and its independent lifecycle. */
export class CodeModeRuntime {
    private chunkRepository?: OramaNoteChunkRepository;
    private changeQueue?: NoteChangeQueue;
    private modelService?: EmbeddingService;
    private similarNoteFinder?: SimilarNoteFinder;
    private textSearchService?: TextSearchService;
    private readonly coordinatedTextSearchService: TextSearch;
    private indexingService?: NoteIndexingService;
    private indexedNotesMTimeStore?: IndexedNoteMTimeStore;
    private erroredNoteStore?: ErroredNoteStore;
    private sharesNotesModelService = false;

    constructor(private readonly options: CodeModeRuntimeOptions) {
        this.coordinatedTextSearchService = {
            checkTokenLimit: (text) =>
                this.runTextSearch((service) =>
                    service.checkTokenLimit(text)
                ),
            findSimilarNotesFromText: (text, limit) =>
                this.runTextSearch((service) =>
                    service.findSimilarNotesFromText(text, limit)
                ),
        };
    }

    getSearchService(): TextSearch | undefined {
        return this.textSearchService ? this.coordinatedTextSearchService : undefined;
    }

    private async runTextSearch<T>(
        operation: (service: TextSearchService) => Promise<T>
    ): Promise<T> {
        return await this.options.similarNoteCoordinator.runSearchOperation(
            "code",
            async () => {
                if (!this.textSearchService) {
                    throw new Error("Code index is not ready");
                }
                return await operation(this.textSearchService);
            }
        );
    }

    async getStatus(): Promise<CodeModeStatus> {
        let chunks = 0;
        if (this.chunkRepository) {
            try {
                chunks = await this.chunkRepository.count();
            } catch {
                // Runtime may still be loading; surface zero until it is ready.
            }
        }
        return {
            indexedNotes: this.indexedNotesMTimeStore?.getCurrentIndexedNoteCount() ?? 0,
            chunks,
            erroredNotes: this.erroredNoteStore?.getCurrentErroredCount() ?? 0,
        };
    }

    async applyChanges(
        enabled: boolean,
        codeModel: EmbeddingModelSettings
    ): Promise<void> {
        const apply = async () =>
            this.options.similarNoteCoordinator.runSearchTransition(
                "code",
                async () => this.applyChangesUnlocked(enabled, codeModel)
            );
        if (
            this.options.settingsService.get().codeModeEnabled !== enabled
        ) {
            await this.options.similarNoteCoordinator.runSearchTransition(
                "notes",
                apply
            );
        } else {
            await apply();
        }
    }

    private async applyChangesUnlocked(
        enabled: boolean,
        codeModel: EmbeddingModelSettings
    ): Promise<void> {
        const previous = this.options.settingsService.get();
        const previousSettings = {
            ...previous,
            codeModel: previous.codeModel
                ? { ...previous.codeModel }
                : undefined,
        };
        const previousCodeModel = previous.codeModel
            ? { ...previous.codeModel }
            : snapshotNoteModelSettings(previous);
        const modeChanged = previous.codeModeEnabled !== enabled;
        const indexChanged =
            getEmbeddingIndexFingerprint(previousCodeModel) !==
            getEmbeddingIndexFingerprint(codeModel);

        try {
            await this.options.settingsService.update({
                codeModeEnabled: enabled,
                codeModel: { ...codeModel },
                similarityMode: enabled ? previous.similarityMode : "notes",
            });

            if (enabled) {
                await this.initializeUnlocked(!modeChanged && !indexChanged);
            } else {
                await this.teardown(true);
            }
            if (modeChanged) {
                await this.options.rebuildNotesForModeToggle();
            }
        } catch (error) {
            await this.options.settingsService.update(previousSettings);
            try {
                if (previousSettings.codeModeEnabled) {
                    await this.initializeUnlocked(false);
                } else {
                    await this.teardown(true);
                }
                if (modeChanged) {
                    await this.options.rebuildNotesForModeToggle();
                }
            } catch (rollbackError) {
                log.error(
                    "Failed to restore Code Mode after apply failure",
                    rollbackError
                );
            }
            throw error;
        }
    }

    async initialize(loadExistingData: boolean): Promise<void> {
        await this.options.similarNoteCoordinator.runSearchTransition(
            "code",
            async () => this.initializeUnlocked(loadExistingData)
        );
    }

    private async initializeUnlocked(
        loadExistingData: boolean,
        forceNotesModel = false
    ): Promise<void> {
        await this.teardown(false);

        const settings = this.options.settingsService.get();
        let codeModel = settings.codeModel;
        if (!codeModel) {
            codeModel = snapshotNoteModelSettings(settings);
            await this.options.settingsService.update({ codeModel });
        }
        const codeIndexFingerprint = [
            CURRENT_CODE_INDEX_VERSION,
            getEmbeddingIndexFingerprint(codeModel),
        ].join(":");
        const shouldLoadExistingData =
            loadExistingData &&
            settings.codeIndexFingerprint === codeIndexFingerprint;

        this.sharesNotesModelService =
            forceNotesModel || embeddingProfilesEqual(settings, codeModel);
        if (this.sharesNotesModelService) {
            this.modelService = this.options.notesModelService;
        } else {
            this.warnAboutTwoBuiltinModels(settings, codeModel);
            this.modelService = new EmbeddingService(
                this.options.settingsService,
                async () => this.disableCodeGPU()
            );
            await this.modelService.switchProvider(codeModel);
        }

        const modelService = this.modelService;
        if (!modelService) {
            throw new Error("Code embedding model failed to initialize");
        }

        this.chunkRepository = new OramaNoteChunkRepository(
            this.options.app.vault,
            "code"
        );
        this.indexedNotesMTimeStore = new IndexedNoteMTimeStore("code");
        this.erroredNoteStore = new ErroredNoteStore("code");

        // @ts-expect-error - appId exists at runtime but not in type definitions
        const vaultId = this.options.app.appId as string;
        await Promise.all([
            this.indexedNotesMTimeStore.init(vaultId),
            this.erroredNoteStore.init(vaultId),
        ]);
        if (!shouldLoadExistingData) {
            await Promise.all([
                this.indexedNotesMTimeStore.clear(),
                this.erroredNoteStore.clear(),
            ]);
        }

        const chunkingService = new FencedCodeNoteChunkingService(
            this.options.extractor,
            new LinePreservingCodeChunkingService(modelService)
        );
        await chunkingService.init();
        await this.chunkRepository.init(
            modelService.getVectorSize(),
            vaultId,
            shouldLoadExistingData
        );

        this.similarNoteFinder = new SimilarNoteFinder(
            this.chunkRepository,
            chunkingService,
            modelService
        );
        this.textSearchService = new TextSearchService(
            this.chunkRepository,
            modelService
        );
        this.options.similarNoteCoordinator.setCodeSimilarNoteFinder(
            this.similarNoteFinder
        );

        this.changeQueue = new NoteChangeQueue(
            this.options.app.vault,
            this.indexedNotesMTimeStore,
            this.options.settingsService,
            this.erroredNoteStore
        );
        await this.changeQueue.initialize();
        if (!shouldLoadExistingData) {
            await this.changeQueue.enqueueAllNotes();
        }

        this.indexingService = new NoteIndexingService(
            this.options.noteRepository,
            this.chunkRepository,
            this.changeQueue,
            chunkingService,
            modelService,
            this.options.similarNoteCoordinator,
            this.options.settingsService,
            this.options.app,
            this.erroredNoteStore,
            "code"
        );
        this.indexingService.startLoop();
        await this.options.settingsService.update({
            codeIndexVersion: CURRENT_CODE_INDEX_VERSION,
            codeIndexFingerprint,
        });
    }

    async switchNotesModel(settings: EmbeddingModelSettings): Promise<void> {
        await this.options.similarNoteCoordinator.runSearchTransition(
            "code",
            async () => {
                if (!this.sharesNotesModelService) {
                    await this.options.notesModelService.switchProvider(settings);
                    return;
                }

                const current = this.options.settingsService.get();
                const codeModel =
                    current.codeModel ?? snapshotNoteModelSettings(current);
                if (!embeddingProfilesEqual(current, codeModel)) {
                    try {
                        await this.initializeUnlocked(true);
                    } catch (error) {
                        try {
                            await this.initializeUnlocked(true, true);
                        } catch (restoreError) {
                            log.error(
                                "Failed to restore shared Code runtime",
                                restoreError
                            );
                        }
                        throw error;
                    }
                    await this.options.notesModelService.switchProvider(settings);
                    return;
                }

                this.indexingService?.stopLoop();
                await this.indexingService?.waitUntilIdle();
                let switchError: unknown;
                try {
                    await this.options.notesModelService.switchProvider(settings);
                } catch (error) {
                    switchError = error;
                }

                if (current.codeModeEnabled) {
                    this.indexingService?.startLoop();
                }
                if (switchError) {
                    throw switchError;
                }
            }
        );
    }

    async reindex(): Promise<void> {
        if (this.options.settingsService.get().codeModeEnabled) {
            await this.initialize(false);
        }
    }

    async retryErrored(): Promise<void> {
        await this.changeQueue?.retryErrored();
    }

    async applyExclusionPatterns(): Promise<void> {
        await this.changeQueue?.applyExclusionPatterns();
    }

    setLogLevel(level: log.LogLevelDesc): void {
        if (this.modelService && !this.sharesNotesModelService) {
            this.modelService.setLogLevel(level);
        }
        this.chunkRepository?.setLogLevel(level);
    }

    async dispose(clearIndex = false): Promise<void> {
        await this.options.similarNoteCoordinator.runSearchTransition(
            "code",
            async () => this.teardown(clearIndex)
        );
    }

    private async teardown(clearIndex: boolean): Promise<void> {
        this.indexingService?.stopLoop();
        await this.indexingService?.waitUntilIdle();
        this.changeQueue?.cleanup();

        if (clearIndex && this.chunkRepository && this.modelService) {
            // @ts-expect-error - appId exists at runtime but not in type definitions
            const vaultId = this.options.app.appId as string;
            await this.chunkRepository.init(
                this.modelService.getVectorSize(),
                vaultId,
                false
            );
            await Promise.all([
                this.indexedNotesMTimeStore?.clear(),
                this.erroredNoteStore?.clear(),
            ]);
        }

        this.indexedNotesMTimeStore?.close();
        this.erroredNoteStore?.close();
        await this.chunkRepository?.dispose();
        if (this.modelService && !this.sharesNotesModelService) {
            await this.modelService.disposeWhenIdle();
        }

        this.options.similarNoteCoordinator.setCodeSimilarNoteFinder(undefined);
        this.chunkRepository = undefined;
        this.changeQueue = undefined;
        this.modelService = undefined;
        this.similarNoteFinder = undefined;
        this.textSearchService = undefined;
        this.indexingService = undefined;
        this.indexedNotesMTimeStore = undefined;
        this.erroredNoteStore = undefined;
        this.sharesNotesModelService = false;
    }

    private async disableCodeGPU(): Promise<void> {
        const settings = this.options.settingsService.get();
        const codeModel = settings.codeModel
            ? { ...settings.codeModel }
            : snapshotNoteModelSettings(settings);
        await this.options.settingsService.update({
            codeModel: { ...codeModel, useGPU: false },
        });
    }

    private warnAboutTwoBuiltinModels(
        notesModel: EmbeddingModelSettings,
        codeModel: EmbeddingModelSettings
    ): void {
        if (
            Platform.isMobileApp &&
            notesModel.modelProvider === "builtin" &&
            codeModel.modelProvider === "builtin"
        ) {
            new Notice(
                "Code Mode is loading a second built-in model. This may exceed mobile memory; a remote Code model is recommended.",
                8000
            );
        }
    }
}

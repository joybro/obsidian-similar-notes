import type { SettingsService } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { ErroredNoteStore } from "@/infrastructure/ErroredNoteStore";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import { collectEnvironmentInfo, formatEnvironmentInfoAsMarkdown } from "@/utils/environmentInfo";
import log from "loglevel";
import {
    apiVersion,
    Notice,
    PluginSettingTab,
    requireApiVersion,
    type Setting,
    type SettingDefinitionItem,
} from "obsidian";
import type MainPlugin from "../main";
import { ModelSettingsSection } from "./ModelSettingsSection";
import { IndexSettingsSection } from "./IndexSettingsSection";
import { renderSettingGroups, type SettingRow, type SettingRowGroup } from "./settingDefinitions";
import { logRejection } from "@/utils/logRejection";

const GITHUB_ISSUES_URL = "https://github.com/joybro/obsidian-similar-notes/issues";

export class SimilarNotesSettingTab extends PluginSettingTab {
    private indexedNoteCount = 0;
    private indexedChunkCount = 0;
    private subscription: { unsubscribe: () => void } | null = null;
    private erroredSubscription: { unsubscribe: () => void } | null = null;
    private mTimeStore?: IndexedNoteMTimeStore;
    private erroredStore?: ErroredNoteStore;
    private modelService?: EmbeddingService;
    private noteChunkRepository?: NoteChunkRepository;
    private modelSettingsSection?: ModelSettingsSection;
    private indexSettingsSection?: IndexSettingsSection;

    constructor(
        private plugin: MainPlugin,
        private settingsService: SettingsService,
        mTimeStore?: IndexedNoteMTimeStore
    ) {
        super(plugin.app, plugin);

        // If mTimeStore is provided during construction, set it up now
        if (mTimeStore) {
            this.setMTimeStore(mTimeStore);
        }
    }

    /**
     * Set the IndexedNoteMTimeStore and update subscriptions.
     * This allows the IndexedNoteMTimeStore to be initialized after the tab is created.
     */
    setMTimeStore(mTimeStore: IndexedNoteMTimeStore): void {
        // Clean up existing subscription if any
        if (this.subscription) {
            this.subscription.unsubscribe();
        }

        this.mTimeStore = mTimeStore;

        // Get the initial count
        this.indexedNoteCount = this.mTimeStore.getCurrentIndexedNoteCount();

        // Subscribe to count changes
        this.subscription = this.mTimeStore
            .getIndexedNoteCount$()
            .subscribe((count) => {
                logRejection(this.onIndexedNoteCountChange(count), "update index stats");
            });
    }

    private async onIndexedNoteCountChange(count: number): Promise<void> {
        this.indexedNoteCount = count;
        // Update chunk count when note count changes
        if (this.noteChunkRepository) {
            try {
                this.indexedChunkCount = await this.noteChunkRepository.count();
            } catch (error) {
                log.error("Failed to update chunk count", error);
            }
        }
        // Update stats without full redraw if possible
        if (this.containerEl.isShown()) {
            if (this.indexSettingsSection) {
                this.indexSettingsSection.updateStats({
                    indexedNoteCount: this.indexedNoteCount,
                    indexedChunkCount: this.indexedChunkCount
                });
            } else {
                this.rerender();
            }
        }
    }

    /**
     * Set the ErroredNoteStore and refresh stats when the errored count changes.
     */
    setErroredStore(erroredStore: ErroredNoteStore): void {
        if (this.erroredSubscription) {
            this.erroredSubscription.unsubscribe();
        }
        this.erroredStore = erroredStore;
        this.erroredSubscription = erroredStore
            .getErroredCount$()
            .subscribe(() => {
                if (this.containerEl.isShown() && this.indexSettingsSection) {
                    this.indexSettingsSection.updateStats({
                        indexedNoteCount: this.indexedNoteCount,
                        indexedChunkCount: this.indexedChunkCount,
                    });
                }
            });
    }

    /**
     * Set the NoteChunkRepository to get chunk count.
     * This allows the NoteChunkRepository to be initialized after the tab is created.
     */
    async setNoteChunkRepository(noteChunkRepository: NoteChunkRepository): Promise<void> {
        this.noteChunkRepository = noteChunkRepository;

        // Get the initial chunk count
        if (this.noteChunkRepository) {
            try {
                this.indexedChunkCount = await this.noteChunkRepository.count();
                // Update stats without full redraw if possible
                if (this.containerEl.isShown()) {
                    if (this.indexSettingsSection) {
                        this.indexSettingsSection.updateStats({
                            indexedNoteCount: this.indexedNoteCount,
                            indexedChunkCount: this.indexedChunkCount
                        });
                    } else {
                        this.rerender();
                    }
                }
            } catch (error) {
                log.error("Failed to get chunk count", error);
            }
        }
    }

    /**
     * Set the EmbeddingService and update subscriptions.
     * This allows the EmbeddingService to be initialized after the tab is created.
     */
    setModelService(modelService: EmbeddingService): void {
        this.modelService = modelService;
        
        // Setup model service in the model settings section if it exists
        if (this.modelSettingsSection) {
            this.modelSettingsSection.setupModelService(modelService);
        }
    }

    onClose() {
        // Clean up subscription when the settings tab is closed
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }
        if (this.erroredSubscription) {
            this.erroredSubscription.unsubscribe();
            this.erroredSubscription = null;
        }
        
        // Clean up model settings section
        if (this.modelSettingsSection) {
            this.modelSettingsSection.destroy();
        }
    }

    /**
     * The tab's structure for Obsidian 1.13+: rendered by Obsidian and indexed
     * by its settings search (docs/settings-search-spec.md). Below 1.13 this
     * returns [] (the base class never calls it there), and display() renders
     * the same definitions imperatively.
     */
    getSettingDefinitions(): SettingDefinitionItem[] {
        if (!requireApiVersion("1.13.0")) return [];
        return this.buildSettingDefinitions();
    }

    /** Fallback for Obsidian 1.11 and 1.12: the same definitions, rendered imperatively. */
    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        renderSettingGroups(containerEl, this.buildSettingDefinitions());
    }

    /**
     * Re-render the whole tab after a structure change (provider switch,
     * applied model, usage reset): update() when Obsidian renders the
     * definitions, display() when it does not (spec rule 4).
     */
    private rerender(): void {
        if (requireApiVersion("1.13.0")) {
            this.update();
        } else if (this.containerEl.isShown()) {
            this.display();
        }
    }

    /** Every group and row of the tab, in screen order. */
    buildSettingDefinitions(): SettingRowGroup[] {
        // Sections read the late-bound services through getters, so building
        // definitions for search indexing before they exist is safe.
        const services = {
            modelService: () => this.modelService,
            mTimeStore: () => this.mTimeStore,
            erroredStore: () => this.erroredStore,
            noteChunkRepository: () => this.noteChunkRepository,
        };
        if (!this.modelSettingsSection) {
            this.modelSettingsSection = new ModelSettingsSection({
                plugin: this.plugin,
                settingsService: this.settingsService,
                get modelService() {
                    return services.modelService();
                },
                app: this.app,
                rerender: () => this.rerender(),
            });
        }
        if (!this.indexSettingsSection) {
            this.indexSettingsSection = new IndexSettingsSection({
                plugin: this.plugin,
                settingsService: this.settingsService,
                app: this.app,
                get mTimeStore() {
                    return services.mTimeStore();
                },
                get erroredStore() {
                    return services.erroredStore();
                },
                get noteChunkRepository() {
                    return services.noteChunkRepository();
                },
            });
        }

        return [
            ...this.modelSettingsSection.getDefinitionGroups(),
            ...this.indexSettingsSection.getDefinitionGroups(() => ({
                indexedNoteCount: this.indexedNoteCount,
                indexedChunkCount: this.indexedChunkCount,
            })),
            { type: "group", heading: "Display", items: this.getDisplaySettingBuilders() },
            { type: "group", heading: "Debug and support", items: this.getDebugSettingBuilders() },
        ];
    }

    private getDisplaySettingBuilders(): SettingRow[] {
        const settings = this.settingsService.get();

        return [
            // Show at bottom
            { name: "Show similar notes at the bottom of notes", render: (setting: Setting) => {
                setting
                    .setName("Show similar notes at the bottom of notes")
                    .setDesc("Display similar notes section at the bottom of each note")
                    .addToggle((toggle) => {
                        toggle.setValue(settings.showAtBottom).onChange((value) => {
                            logRejection(this.settingsService.update({ showAtBottom: value }), "save setting");
                        });
                    });
            } },
            // Note display mode
            { name: "Note display mode", render: (setting: Setting) => {
                setting
                    .setName("Note display mode")
                    .setDesc("Choose how note names are displayed in the results")
                    .addDropdown((dropdown) => {
                        dropdown
                            .addOption("title", "Title only")
                            .addOption("path", "Full path")
                            .addOption("smart", "Smart (path when duplicates exist)")
                            .setValue(settings.noteDisplayMode)
                            .onChange(async (value: "title" | "path" | "smart") => {
                                await this.settingsService.update({
                                    noteDisplayMode: value,
                                });
                            });
                    });
            } },
            // Semantic link trigger
            { name: "Semantic link trigger", render: (setting: Setting) => {
                setting
                    .setName("Semantic link trigger")
                    .setDesc(
                        "Type this prefix in the editor to get semantic note suggestions and insert a [[link]]. Leave empty to disable. Cannot start with '['."
                    )
                    .addText((text) => {
                        text
                            .setValue(settings.semanticLinkTrigger)
                            .setPlaceholder(";;")
                            .onChange(async (value) => {
                                const trigger = value.trim();
                                // Reject '[' prefixes so the trigger can never
                                // re-collide with Obsidian's built-in [[ suggester.
                                if (trigger.startsWith("[")) return;
                                await this.settingsService.update({
                                    semanticLinkTrigger: trigger,
                                });
                            });
                        text.inputEl.addClass("similar-notes-input-w80");
                    });
            } },
            // Show source chunk
            { name: "Show source chunk in results", render: (setting: Setting) => {
                setting
                    .setName("Show source chunk in results")
                    .setDesc(
                        "If enabled, the source chunk (the part of your current note used for similarity search) will be shown in the results"
                    )
                    .addToggle((toggle) => {
                        toggle
                            .setValue(settings.showSourceChunk)
                            .onChange(async (value) => {
                                await this.settingsService.update({
                                    showSourceChunk: value,
                                });
                            });
                    });
            } },
            // Sidebar result count
            { name: "Number of results in sidebar", render: (setting: Setting) => {
                setting
                    .setName("Number of results in sidebar")
                    .setDesc("Maximum number of similar notes to display in the sidebar (1-50)")
                    .addText((text) => {
                        text
                            .setValue(String(settings.sidebarResultCount))
                            .onChange(async (value) => {
                                const num = parseInt(value, 10);
                                if (!isNaN(num) && num >= 1 && num <= 50) {
                                    await this.settingsService.update({
                                        sidebarResultCount: num,
                                    });
                                }
                            });
                        text.inputEl.type = "number";
                        text.inputEl.min = "1";
                        text.inputEl.max = "50";
                        text.inputEl.addClass("similar-notes-input-w60");
                    });
            } },
            // Bottom result count
            { name: "Number of results at bottom", render: (setting: Setting) => {
                setting
                    .setName("Number of results at bottom")
                    .setDesc("Maximum number of similar notes to display at the bottom of notes (1-20)")
                    .addText((text) => {
                        text
                            .setValue(String(settings.bottomResultCount))
                            .onChange(async (value) => {
                                const num = parseInt(value, 10);
                                if (!isNaN(num) && num >= 1 && num <= 20) {
                                    await this.settingsService.update({
                                        bottomResultCount: num,
                                    });
                                }
                            });
                        text.inputEl.type = "number";
                        text.inputEl.min = "1";
                        text.inputEl.max = "20";
                        text.inputEl.addClass("similar-notes-input-w60");
                    });
            } },
            // Minimum similarity threshold
            { name: "Minimum similarity", render: (setting: Setting) => {
                setting
                    .setName("Minimum similarity")
                    .setDesc(
                        "Hide results below this cosine similarity (0.00 – 1.00). 0 keeps every result."
                    )
                    .addText((text) => {
                        text
                            .setValue(settings.minSimilarityThreshold.toFixed(2))
                            .onChange(async (value) => {
                                const num = parseFloat(value);
                                if (!isNaN(num) && num >= 0 && num <= 1) {
                                    await this.settingsService.update({
                                        minSimilarityThreshold: num,
                                    });
                                }
                            });
                        text.inputEl.type = "number";
                        text.inputEl.min = "0";
                        text.inputEl.max = "1";
                        text.inputEl.step = "0.05";
                        text.inputEl.addClass("similar-notes-input-w70");
                    });
            } },
        ];
    }

    private getDebugSettingBuilders(): SettingRow[] {
        return [
            // Log level
            { name: "Log level", render: (setting: Setting) => {
                setting
                    .setName("Log level")
                    .setDesc("Set the logging level for debugging purposes")
                    .addDropdown((dropdown) => {
                        dropdown
                            .addOption(log.levels.TRACE.toString(), "TRACE")
                            .addOption(log.levels.DEBUG.toString(), "DEBUG")
                            .addOption(log.levels.INFO.toString(), "INFO")
                            .addOption(log.levels.WARN.toString(), "WARN")
                            .addOption(log.levels.ERROR.toString(), "ERROR")
                            .addOption(log.levels.SILENT.toString(), "SILENT")
                            .setValue(log.getLevel().toString())
                            .onChange((value) => {
                                this.plugin.setLogLevel(
                                    Number(value) as log.LogLevelDesc
                                );
                            });
                    });
            } },
            // Copy environment info
            { name: "Copy environment info", render: (setting: Setting) => {
                setting
                    .setName("Copy environment info")
                    .setDesc("Copy your environment and settings info to clipboard for bug reports")
                    .addButton((button) => {
                        button.setButtonText("Copy to clipboard").onClick(() => {
                            // Read settings fresh at click time. Capturing the
                            // render-time `settings` snapshot made the report lag
                            // one or two changes behind (it reflected the model /
                            // options as of the last settings-tab render), which
                            // silently corrupted users' bug reports.
                            const settings = this.settingsService.get();
                            const envInfo = collectEnvironmentInfo(
                                apiVersion,
                                this.plugin.manifest.version,
                                settings
                            );
                            const markdown = formatEnvironmentInfoAsMarkdown(envInfo);
                            navigator.clipboard.writeText(markdown).then(
                                () => new Notice("Environment info copied to clipboard"),
                                (error: unknown) =>
                                    log.error("Failed to copy environment info:", error)
                            );
                        });
                    });
            } },
            // Report a bug
            { name: "Report a bug", render: (setting: Setting) => {
                setting
                    .setName("Report a bug")
                    .setDesc("Open GitHub issues page to report bugs or request features")
                    .addButton((button) => {
                        button.setButtonText("Open").onClick(() => {
                            window.open(GITHUB_ISSUES_URL, "_blank");
                        });
                    });
            } },
        ];
    }

}

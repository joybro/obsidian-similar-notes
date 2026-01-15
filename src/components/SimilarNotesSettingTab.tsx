import type { SettingsService } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import { collectEnvironmentInfo, formatEnvironmentInfoAsMarkdown } from "@/utils/environmentInfo";
import log from "loglevel";
import { apiVersion, Notice, PluginSettingTab, Setting } from "obsidian";
import type MainPlugin from "../main";
import { ModelSettingsSection } from "./ModelSettingsSection";
import { IndexSettingsSection } from "./IndexSettingsSection";

const GITHUB_ISSUES_URL = "https://github.com/joybro/obsidian-similar-notes/issues";

export class SimilarNotesSettingTab extends PluginSettingTab {
    private indexedNoteCount = 0;
    private indexedChunkCount = 0;
    private subscription: { unsubscribe: () => void } | null = null;
    private mTimeStore?: IndexedNoteMTimeStore;
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
            .subscribe(async (count) => {
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
                        this.display();
                    }
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
                        this.display();
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
        
        // Clean up model settings section
        if (this.modelSettingsSection) {
            this.modelSettingsSection.destroy();
        }
    }

    display(): void {
        const settings = this.settingsService.get();
        const { containerEl } = this;
        containerEl.empty();

        // Initialize and render model settings section
        if (!this.modelSettingsSection) {
            this.modelSettingsSection = new ModelSettingsSection({
                containerEl,
                plugin: this.plugin,
                settingsService: this.settingsService,
                modelService: this.modelService,
                app: this.app
            });
        }
        this.modelSettingsSection.render();

        // Initialize and render index settings section
        if (!this.indexSettingsSection) {
            this.indexSettingsSection = new IndexSettingsSection({
                containerEl,
                plugin: this.plugin,
                settingsService: this.settingsService,
                app: this.app,
                mTimeStore: this.mTimeStore,
                noteChunkRepository: this.noteChunkRepository
            });
        }
        this.indexSettingsSection.render({
            indexedNoteCount: this.indexedNoteCount,
            indexedChunkCount: this.indexedChunkCount
        });

        // Add spacing between Index and Display sections
        containerEl.createDiv("setting-item-separator");

        new Setting(containerEl).setName("Display").setHeading();

        new Setting(containerEl)
            .setName("Show similar notes at the bottom of notes")
            .setDesc("Display similar notes section at the bottom of each note")
            .addToggle((toggle) => {
                toggle.setValue(settings.showAtBottom).onChange((value) => {
                    this.settingsService.update({ showAtBottom: value });
                });
            });

        new Setting(containerEl)
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

        new Setting(containerEl)
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

        new Setting(containerEl)
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
                text.inputEl.style.width = "60px";
            });

        new Setting(containerEl)
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
                text.inputEl.style.width = "60px";
            });

        // Add spacing between Display and Debug & Support sections
        containerEl.createDiv("setting-item-separator");

        new Setting(containerEl).setName("Debug & Support").setHeading();

        new Setting(containerEl)
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

        new Setting(containerEl)
            .setName("Copy environment info")
            .setDesc("Copy your environment and settings info to clipboard for bug reports")
            .addButton((button) => {
                button.setButtonText("Copy to Clipboard").onClick(() => {
                    const envInfo = collectEnvironmentInfo(
                        apiVersion,
                        this.plugin.manifest.version,
                        settings
                    );
                    const markdown = formatEnvironmentInfoAsMarkdown(envInfo);
                    navigator.clipboard.writeText(markdown);
                    new Notice("Environment info copied to clipboard");
                });
            });

        new Setting(containerEl)
            .setName("Report a bug")
            .setDesc("Open GitHub issues page to report bugs or request features")
            .addButton((button) => {
                button.setButtonText("Open").onClick(() => {
                    window.open(GITHUB_ISSUES_URL, "_blank");
                });
            });
    }

}

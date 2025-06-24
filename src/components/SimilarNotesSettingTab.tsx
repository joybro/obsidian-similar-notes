import type { SettingsService } from "@/application/SettingsService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import log from "loglevel";
import { PluginSettingTab, Setting } from "obsidian";
import type MainPlugin from "../main";
import { LoadModelModal } from "./LoadModelModal";

export class SimilarNotesSettingTab extends PluginSettingTab {
    private indexedNoteCount: number = 0;
    private subscription: { unsubscribe: () => void } | null = null;
    private mTimeStore?: IndexedNoteMTimeStore;

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
                this.indexedNoteCount = count;
                // Redraw the settings tab if it's active
                if (this.containerEl.isShown()) {
                    this.display();
                }
            });
    }

    onClose() {
        // Clean up subscription when the settings tab is closed
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }
    }

    display(): void {
        const settings = this.settingsService.get();
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Auto-save interval")
            .setDesc("How often to save changes to disk (in minutes)")
            .addText((text) => {
                text.setValue(settings.autoSaveInterval.toString()).onChange(
                    async (value) => {
                        await this.settingsService.update({
                            autoSaveInterval: Number.parseInt(value, 10),
                        });
                    }
                );
            });

        new Setting(containerEl).setName("Model").setHeading();

        new Setting(containerEl)
            .setName("Current Model")
            .setDesc(settings.modelId);

        const recommendedModels = [
            "sentence-transformers/all-MiniLM-L6-v2",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        ];

        let selectedModel = settings.modelId;

        new Setting(containerEl)
            .setName("Recommended Models")
            .setDesc("Select from recommended embedding models")
            .addDropdown((dropdown) => {
                for (const model of recommendedModels) {
                    dropdown.addOption(model, model);
                }
                dropdown.setValue(settings.modelId);
                dropdown.onChange(async (value) => {
                    selectedModel = value;
                });
            })
            .addButton((button) => {
                button.setButtonText("Load").onClick(async () => {
                    new LoadModelModal(
                        this.app,
                        async () => {
                            await this.settingsService.update({
                                modelId: selectedModel,
                            });
                            this.plugin.changeModel(selectedModel);
                        },
                        () => {}
                    ).open();
                });
            });

        let customModel = "";

        new Setting(containerEl)
            .setName("Custom Model")
            .setDesc("Enter a custom model ID from Hugging Face")
            .addText((text) => {
                text.onChange(async (value) => {
                    customModel = value;
                });
            })
            .addButton((button) => {
                button.setButtonText("Load").onClick(async () => {
                    if (customModel.length === 0) {
                        return;
                    }
                    new LoadModelModal(
                        this.app,
                        async () => {
                            await this.settingsService.update({
                                modelId: customModel,
                            });
                            this.plugin.changeModel(customModel);
                        },
                        () => {}
                    ).open();
                });
            });

        new Setting(containerEl)
            .setName("Use GPU Acceleration")
            .setDesc("If enabled, WebGPU will be used for model inference. Disable if you experience issues with GPU acceleration.")
            .addToggle((toggle) => {
                toggle
                    .setValue(settings.useGPU)
                    .onChange(async (value) => {
                        await this.settingsService.update({
                            useGPU: value,
                        });
                        // Only reload model with new GPU setting without reindexing
                        this.plugin.reloadModel();
                    });
            });

        new Setting(containerEl).setName("Index").setHeading();

        new Setting(containerEl)
            .setName("Include frontmatter in indexing and search")
            .setDesc(
                "If enabled, the frontmatter of each note will be included in the similarity index and search."
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(settings.includeFrontmatter)
                    .onChange(async (value) => {
                        await this.settingsService.update({
                            includeFrontmatter: value,
                        });
                    });
            });

        new Setting(containerEl)
            .setName("Indexed Notes")
            .setDesc(
                `Number of notes currently in the similarity index: ${this.indexedNoteCount}`
            );

        new Setting(containerEl)
            .setName("Reindex notes")
            .setDesc("Rebuild the similarity index for all notes")
            .addButton((button) => {
                button.setButtonText("Reindex").onClick(async () => {
                    await this.plugin.reindexNotes();
                });
            });

        new Setting(containerEl).setName("Debug").setHeading();

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
            .setName("Log Level")
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
    }
}

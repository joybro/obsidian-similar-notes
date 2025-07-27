import { OllamaClient } from "@/adapter/ollama";
import type { SettingsService } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import log from "loglevel";
import { Notice, PluginSettingTab, Setting } from "obsidian";
import type MainPlugin from "../main";
import { LoadModelModal } from "./LoadModelModal";

export class SimilarNotesSettingTab extends PluginSettingTab {
    private indexedNoteCount: number = 0;
    private subscription: { unsubscribe: () => void } | null = null;
    private mTimeStore?: IndexedNoteMTimeStore;
    private modelService?: EmbeddingService;
    private downloadProgressSubscription?: { unsubscribe: () => void };
    private currentDownloadProgress: number = 100;

    // Temporary state for model changes (not saved until Apply is clicked)
    private tempModelProvider?: "builtin" | "ollama";
    private tempModelId?: string;
    private tempOllamaUrl?: string;
    private tempOllamaModel?: string;
    private tempUseGPU?: boolean;

    // Apply button reference for direct updates
    private applyButton?: any;

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

    /**
     * Set the EmbeddingService and update subscriptions.
     * This allows the EmbeddingService to be initialized after the tab is created.
     */
    setModelService(modelService: EmbeddingService): void {
        // Clean up existing subscription if any
        if (this.downloadProgressSubscription) {
            this.downloadProgressSubscription.unsubscribe();
        }

        this.modelService = modelService;

        // Subscribe to download progress changes
        this.downloadProgressSubscription = this.modelService
            .getDownloadProgress$()
            .subscribe((progress) => {
                const previousProgress = this.currentDownloadProgress;
                this.currentDownloadProgress = progress;
                // Redraw the settings tab if it's active and progress changed
                if (this.containerEl.isShown() && previousProgress !== progress) {
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
        if (this.downloadProgressSubscription) {
            this.downloadProgressSubscription.unsubscribe();
            this.downloadProgressSubscription = undefined;
        }
    }

    display(): void {
        const settings = this.settingsService.get();
        const { containerEl } = this;
        containerEl.empty();

        // Initialize temporary state from current settings
        this.tempModelProvider =
            this.tempModelProvider ?? settings.modelProvider;
        this.tempModelId = this.tempModelId ?? settings.modelId;
        this.tempOllamaUrl = this.tempOllamaUrl ?? settings.ollamaUrl;
        this.tempOllamaModel = this.tempOllamaModel ?? settings.ollamaModel;
        this.tempUseGPU = this.tempUseGPU ?? settings.useGPU;

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

        // Current model display
        const gpuStatus =
            settings.modelProvider === "builtin" && settings.useGPU
                ? " (GPU)"
                : "";
        let currentModelDesc =
            settings.modelProvider === "builtin"
                ? `Built-in: ${settings.modelId}${gpuStatus}`
                : settings.modelProvider === "ollama"
                ? `Ollama: ${settings.ollamaModel || "Not configured"}`
                : "Not configured";

        // Add download progress if downloading
        if (
            this.currentDownloadProgress < 100 &&
            settings.modelProvider === "builtin"
        ) {
            currentModelDesc += ` - Downloading: ${Math.floor(
                this.currentDownloadProgress
            )}%`;
        }

        new Setting(containerEl)
            .setName("Current model")
            .setDesc(currentModelDesc);

        // Model Provider Selection
        new Setting(containerEl)
            .setName("Model provider")
            .setDesc("Choose between built-in models or Ollama")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("builtin", "Built-in Models")
                    .addOption("ollama", "Ollama")
                    .setValue(this.tempModelProvider || "builtin")
                    .onChange((value: "builtin" | "ollama") => {
                        this.tempModelProvider = value;
                        // Redraw settings to show/hide provider-specific options
                        this.display();
                    });
            });

        // Provider-specific settings
        if (this.tempModelProvider === "builtin") {
            // Built-in model settings

            const recommendedModels = [
                "sentence-transformers/all-MiniLM-L6-v2",
                "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
            ];

            new Setting(containerEl)
                .setName("Recommended models")
                .setDesc("Select from recommended embedding models")
                .addDropdown((dropdown) => {
                    for (const model of recommendedModels) {
                        dropdown.addOption(model, model);
                    }
                    dropdown.setValue(this.tempModelId || settings.modelId);
                    dropdown.onChange((value) => {
                        this.tempModelId = value;
                        this.display(); // Redraw to update Apply button state
                    });
                });

            new Setting(containerEl)
                .setName("Custom model")
                .setDesc("Enter a custom model ID from Hugging Face")
                .addText((text) => {
                    text.setValue(this.tempModelId || "").onChange((value) => {
                        this.tempModelId = value;
                        // Don't redraw for text input to avoid losing focus
                        this.updateApplyButtonState(settings);
                    });
                });

            new Setting(containerEl)
                .setName("Use GPU acceleration")
                .setDesc(
                    "If enabled, WebGPU will be used for model inference. Disable if you experience issues with GPU acceleration."
                )
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.tempUseGPU ?? settings.useGPU)
                        .onChange((value) => {
                            this.tempUseGPU = value;
                            // Delay redraw to allow toggle animation to complete
                            setTimeout(() => {
                                this.display(); // Redraw to update Apply button state
                            }, 150);
                        });
                });
        } else if (this.tempModelProvider === "ollama") {
            // Ollama settings
            const ollamaUrl =
                this.tempOllamaUrl ||
                settings.ollamaUrl ||
                "http://localhost:11434";
            const ollamaClient = new OllamaClient(ollamaUrl);

            // State for Ollama models
            let ollamaModels: string[] = [];
            let modelLoadError: string | null = null;

            // Function to fetch Ollama models
            const fetchOllamaModels = async () => {
                modelLoadError = null;

                try {
                    ollamaModels = await ollamaClient.getModelNames();
                } catch (error) {
                    modelLoadError =
                        error instanceof Error
                            ? error.message
                            : "Failed to fetch models";
                    ollamaModels = [];
                }
            };

            new Setting(containerEl)
                .setName("Ollama server URL")
                .setDesc(
                    "URL of your Ollama server (default: http://localhost:11434)"
                )
                .addText((text) => {
                    text.setPlaceholder("http://localhost:11434")
                        .setValue(ollamaUrl)
                        .onChange((value) => {
                            this.tempOllamaUrl = value;
                            // Update client URL and refresh the page
                            ollamaClient.setBaseUrl(value);
                            this.display();
                        });
                });

            // Create the model dropdown setting
            const modelSetting = new Setting(containerEl)
                .setName("Ollama model")
                .setDesc("Select an Ollama model for embeddings");

            let dropdownComponent: any;
            modelSetting.addDropdown((dropdown) => {
                dropdownComponent = dropdown;
                dropdown.addOption("", "Loading models...");
                dropdown.setValue(this.tempOllamaModel || "");
                dropdown.onChange((value) => {
                    this.tempOllamaModel = value;
                    this.display(); // Redraw to update Apply button state
                });
            });

            // Add refresh button
            modelSetting.addButton((button) => {
                button
                    .setButtonText("Refresh")
                    .setTooltip("Refresh model list")
                    .onClick(async () => {
                        await fetchOllamaModels();
                        this.display(); // Redraw to update dropdown
                    });
            });

            // Fetch models on load
            fetchOllamaModels().then(() => {
                // Update dropdown with fetched models
                dropdownComponent.selectEl.empty();

                if (modelLoadError) {
                    dropdownComponent.addOption("", `Error: ${modelLoadError}`);
                } else if (ollamaModels.length === 0) {
                    dropdownComponent.addOption("", "No models found");
                } else {
                    dropdownComponent.addOption("", "Select a model");
                    ollamaModels.forEach((model) => {
                        dropdownComponent.addOption(model, model);
                    });

                    // Set current value if it exists in the list
                    if (
                        this.tempOllamaModel &&
                        ollamaModels.includes(this.tempOllamaModel)
                    ) {
                        dropdownComponent.setValue(this.tempOllamaModel);
                    }
                }
            });

            // Test connection button
            new Setting(containerEl)
                .setName("Test connection")
                .setDesc(
                    "Test the connection to Ollama server and selected model"
                )
                .addButton((button) => {
                    button.setButtonText("Test").onClick(async () => {
                        const model = this.tempOllamaModel;
                        if (!model) {
                            new Notice("Please select a model first");
                            return;
                        }

                        new Notice(
                            `Testing connection to ${ollamaUrl} with model ${model}...`
                        );

                        try {
                            const success = await ollamaClient.testModel(model);
                            if (success) {
                                new Notice(
                                    "Connection successful! Model is ready for embeddings."
                                );
                            } else {
                                new Notice(
                                    `Connection failed: Model test failed`
                                );
                            }
                        } catch (error) {
                            new Notice(`Connection failed: ${error}`);
                        }
                    });
                });
        }

        // Model Apply Button
        const hasChanges = this.hasModelChanges(settings);
        const buttonText =
            this.tempModelProvider === "builtin"
                ? "Load & Apply"
                : "Apply Changes";
        const buttonDesc = hasChanges
            ? "Apply the selected model configuration. This will rebuild the similarity index."
            : "No changes to apply. Modify settings above to enable this button.";

        new Setting(containerEl)
            .setName("Apply model changes")
            .setDesc(buttonDesc)
            .addButton((button) => {
                this.applyButton = button; // Store reference for updates
                button
                    .setButtonText(buttonText)
                    .setDisabled(!hasChanges)
                    .onClick(async () => {
                        if (hasChanges) {
                            await this.applyModelChanges(settings);
                        }
                    });

                if (hasChanges) {
                    button.setCta();
                }
            });

        new Setting(containerEl).setName("Index").setHeading();

        new Setting(containerEl)
            .setName("Indexed notes")
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

        // Function to process test input - called whenever regex patterns or input text changes
        const processTestInput = () => {
            const inputText = testInputTextArea?.value || "";
            let outputText = inputText;

            try {
                const currentSettings = this.settingsService.get();
                const patterns = currentSettings.excludeRegexPatterns;

                for (const pattern of patterns) {
                    const regex = new RegExp(pattern, "gm");
                    outputText = outputText.replace(regex, "");
                }
                testOutputTextArea.value = outputText;
            } catch (e) {
                testOutputTextArea.value = `Error processing RegExp: ${e.message}`;
            }
        };

        // Add UI for regex pattern settings
        new Setting(containerEl)
            .setName("Exclude content from indexing")
            .setDesc(
                "Enter regular expressions to exclude content from indexing (one per line). Note: Only applies to newly modified notes. Use Reindex to apply to all notes."
            )
            .addTextArea((text) => {
                text.inputEl.rows = 5;
                text.inputEl.cols = 40;
                text.setValue(settings.excludeRegexPatterns.join("\n"));
                // Store error status of each line
                const errorMessages: Map<number, string> = new Map();

                // Style for highlighting invalid patterns
                const errorLineClass = "similar-notes-regexp-error";

                // Apply error styles if needed
                const applyErrorStyles = () => {
                    const textArea = text.inputEl;
                    const lines = textArea.value.split("\n");

                    // Reset all previous error styles
                    textArea.removeClass(errorLineClass);
                    textArea.title = "";

                    // If there are errors, apply error styles
                    if (errorMessages.size > 0) {
                        textArea.addClass(errorLineClass);

                        // Create tooltip with error messages
                        const tooltipMessages = Array.from(
                            errorMessages.entries()
                        )
                            .map(
                                ([line, message]) =>
                                    `Line ${line + 1}: ${message}`
                            )
                            .join("\n");
                        textArea.title = tooltipMessages;
                    }
                };

                text.onChange(async (value) => {
                    // Clear previous errors
                    errorMessages.clear();

                    // Process and validate each line
                    const lines = value.split("\n");
                    const validPatterns: string[] = [];

                    // Check each pattern for validity
                    lines.forEach((pattern, index) => {
                        // Skip empty lines
                        if (pattern.trim().length === 0) return;

                        // Validate the pattern
                        try {
                            new RegExp(pattern);
                            validPatterns.push(pattern);
                        } catch (e) {
                            // Store error message for this line
                            errorMessages.set(index, e.message);
                        }
                    });

                    // Apply error styles
                    applyErrorStyles();

                    // Save only valid patterns
                    await this.settingsService.update({
                        excludeRegexPatterns: validPatterns,
                    });

                    // Update test output when patterns change
                    processTestInput();
                });
            });

        // Add RegExp tester UI
        const regExpTesterContainer = containerEl.createDiv(
            "similar-notes-regexp-tester"
        );
        regExpTesterContainer.addClass("setting-item");

        const regExpTesterHeader =
            regExpTesterContainer.createDiv("setting-item-info");
        const regExpTesterDescription = regExpTesterHeader.createDiv(
            "setting-item-description"
        );
        regExpTesterDescription.setText(
            "Test your regular expressions against sample text"
        );

        const regExpTesterContent = regExpTesterContainer.createDiv(
            "setting-item-control similar-notes-regexp-tester-content"
        );

        const testInputContainer = regExpTesterContent.createDiv(
            "similar-notes-test-input-container"
        );
        const testOutputContainer = regExpTesterContent.createDiv(
            "similar-notes-test-output-container"
        );

        const testInputLabel = testInputContainer.createDiv(
            "similar-notes-test-label"
        );
        testInputLabel.setText("Input text:");
        const testOutputLabel = testOutputContainer.createDiv(
            "similar-notes-test-label"
        );
        testOutputLabel.setText("Result (content that will be indexed):");

        const testInputTextArea = testInputContainer.createEl("textarea");
        testInputTextArea.rows = 8;
        testInputTextArea.cols = 30;
        testInputTextArea.placeholder =
            "Enter text to test against your regular expressions";
        testInputTextArea.value = settings.regexpTestInputText || "";

        const testOutputTextArea = testOutputContainer.createEl("textarea");
        testOutputTextArea.rows = 8;
        testOutputTextArea.cols = 30;
        testOutputTextArea.readOnly = true;
        testOutputTextArea.placeholder = "Filtered content will appear here";

        // Update test output and save input text when it changes
        testInputTextArea.addEventListener("input", () => {
            // Save the test input text to settings
            this.settingsService.update({
                regexpTestInputText: testInputTextArea.value,
            });

            // Process the input to update the output
            processTestInput();
        });

        // Initialize output when settings tab opens
        setTimeout(() => processTestInput(), 0);

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

        new Setting(containerEl).setName("Debug").setHeading();

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
    }

    private hasModelChanges(settings: any): boolean {
        return (
            this.tempModelProvider !== settings.modelProvider ||
            (this.tempModelProvider === "builtin" &&
                this.tempModelId &&
                this.tempModelId !== settings.modelId) ||
            (this.tempModelProvider === "ollama" &&
                (this.tempOllamaUrl !== settings.ollamaUrl ||
                    this.tempOllamaModel !== settings.ollamaModel)) ||
            (this.tempModelProvider === "builtin" &&
                this.tempUseGPU !== settings.useGPU)
        );
    }

    private async applyModelChanges(settings: any): Promise<void> {
        if (this.tempModelProvider === "builtin") {
            // Built-in model - use LoadModelModal
            const modelId = this.tempModelId || settings.modelId;
            const builtinMessage =
                "The model will be downloaded from Hugging Face (this might take a while) and all your notes will be reindexed. Do you want to continue?";

            new LoadModelModal(
                this.app,
                builtinMessage,
                async () => {
                    await this.settingsService.update({
                        modelProvider: this.tempModelProvider,
                        modelId: modelId,
                        useGPU: this.tempUseGPU ?? settings.useGPU,
                    });
                    this.plugin.changeModel(modelId);
                    // Clear temporary state after successful apply
                    this.clearTempState();
                    this.display();
                },
                () => {} // Cancel callback
            ).open();
        } else if (this.tempModelProvider === "ollama") {
            // Ollama model - show confirmation modal
            const ollamaMessage =
                "Your embedding model will be changed and all notes will be reindexed. Do you want to continue?";

            new LoadModelModal(
                this.app,
                ollamaMessage,
                async () => {
                    await this.settingsService.update({
                        modelProvider: this.tempModelProvider,
                        ollamaUrl: this.tempOllamaUrl,
                        ollamaModel: this.tempOllamaModel,
                    });
                    // Trigger model change with new settings
                    this.plugin.changeModel(this.tempOllamaModel || "");
                    // Clear temporary state after successful apply
                    this.clearTempState();
                    this.display();
                },
                () => {} // Cancel callback
            ).open();
        }
    }

    private clearTempState(): void {
        this.tempModelProvider = undefined;
        this.tempModelId = undefined;
        this.tempOllamaUrl = undefined;
        this.tempOllamaModel = undefined;
        this.tempUseGPU = undefined;
    }

    private updateApplyButtonState(settings: any): void {
        if (!this.applyButton) return;

        const hasChanges = this.hasModelChanges(settings);
        const buttonText =
            this.tempModelProvider === "builtin"
                ? "Load & Apply"
                : "Apply Changes";

        this.applyButton.setButtonText(buttonText).setDisabled(!hasChanges);

        // Update CTA styling
        if (hasChanges) {
            this.applyButton.setCta();
        } else {
            this.applyButton.removeCta();
        }
    }
}

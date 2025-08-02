import { OllamaClient } from "@/adapter/ollama";
import type { SettingsService } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import { matchesGlobPattern, isValidGlobPattern, shouldExcludeFile } from "@/utils/folderExclusion";
import log from "loglevel";
import { Notice, PluginSettingTab, Setting } from "obsidian";
import type MainPlugin from "../main";
import { LoadModelModal } from "./LoadModelModal";

export class SimilarNotesSettingTab extends PluginSettingTab {
    private indexedNoteCount: number = 0;
    private indexedChunkCount: number = 0;
    private databaseSize: number = 0;
    private subscription: { unsubscribe: () => void } | null = null;
    private mTimeStore?: IndexedNoteMTimeStore;
    private modelService?: EmbeddingService;
    private noteChunkRepository?: NoteChunkRepository;
    private downloadProgressSubscription?: { unsubscribe: () => void };
    private modelErrorSubscription?: { unsubscribe: () => void };
    private currentDownloadProgress: number = 100;
    private currentModelError: string | null = null;

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
            .subscribe(async (count) => {
                this.indexedNoteCount = count;
                // Update chunk count and database size when note count changes
                if (this.noteChunkRepository) {
                    try {
                        this.indexedChunkCount = await this.noteChunkRepository.count();
                        await this.updateDatabaseSize();
                    } catch (error) {
                        log.error("Failed to update chunk count", error);
                    }
                }
                // Redraw the settings tab if it's active
                if (this.containerEl.isShown()) {
                    this.display();
                }
            });
    }

    /**
     * Set the NoteChunkRepository to get chunk count and database info.
     * This allows the NoteChunkRepository to be initialized after the tab is created.
     */
    async setNoteChunkRepository(noteChunkRepository: NoteChunkRepository): Promise<void> {
        this.noteChunkRepository = noteChunkRepository;
        
        // Get the initial chunk count
        if (this.noteChunkRepository) {
            try {
                this.indexedChunkCount = await this.noteChunkRepository.count();
                // Update the database size
                await this.updateDatabaseSize();
                // Redraw the settings tab if it's active
                if (this.containerEl.isShown()) {
                    this.display();
                }
            } catch (error) {
                log.error("Failed to get chunk count", error);
            }
        }
    }

    /**
     * Update the database size by checking the file size on disk
     */
    private async updateDatabaseSize(): Promise<void> {
        try {
            const pluginDataDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
            const dbPath = `${pluginDataDir}/similar-notes.json`;
            
            if (await this.plugin.app.vault.adapter.exists(dbPath)) {
                const stat = await this.plugin.app.vault.adapter.stat(dbPath);
                if (stat) {
                    this.databaseSize = stat.size;
                }
            }
        } catch (error) {
            log.error("Failed to get database size", error);
        }
    }

    /**
     * Set the EmbeddingService and update subscriptions.
     * This allows the EmbeddingService to be initialized after the tab is created.
     */
    setModelService(modelService: EmbeddingService): void {
        // Clean up existing subscriptions if any
        if (this.downloadProgressSubscription) {
            this.downloadProgressSubscription.unsubscribe();
        }
        if (this.modelErrorSubscription) {
            this.modelErrorSubscription.unsubscribe();
        }

        this.modelService = modelService;

        // Subscribe to download progress changes
        this.downloadProgressSubscription = this.modelService
            .getDownloadProgress$()
            .subscribe((progress) => {
                const previousProgress = this.currentDownloadProgress;
                this.currentDownloadProgress = progress;
                // Redraw the settings tab if it's active and progress changed
                if (
                    this.containerEl.isShown() &&
                    previousProgress !== progress
                ) {
                    this.display();
                }
            });

        // Subscribe to model error changes
        this.modelErrorSubscription = this.modelService
            .getModelError$()
            .subscribe((error) => {
                const previousError = this.currentModelError;
                this.currentModelError = error;
                // Redraw the settings tab if it's active and error changed
                if (this.containerEl.isShown() && previousError !== error) {
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
        if (this.modelErrorSubscription) {
            this.modelErrorSubscription.unsubscribe();
            this.modelErrorSubscription = undefined;
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

        // Add error status if there's an error
        if (this.currentModelError) {
            currentModelDesc += ` - Failed: ${this.currentModelError}`;
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

        const formatBytes = (bytes: number): string => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        // Index statistics with excluded files count
        const indexStatsSetting = new Setting(containerEl)
            .setName("Index statistics");

        // Function to update index statistics  
        const updateVaultStats = () => {
            const allFiles = this.app.vault.getMarkdownFiles();
            
            // Calculate actually excluded files: total files - indexed files
            const actuallyExcludedCount = allFiles.length - this.indexedNoteCount;
            
            // Clear and rebuild the description with proper structure
            indexStatsSetting.descEl.empty();
            
            const statsContainer = indexStatsSetting.descEl.createDiv("similar-notes-stats-container");
            
            const indexedStat = statsContainer.createDiv("similar-notes-stat-item");
            indexedStat.setText(`• Indexed: ${this.indexedNoteCount} notes (${this.indexedChunkCount} chunks)`);
            
            const excludedStat = statsContainer.createDiv("similar-notes-stat-item");
            excludedStat.setText(`• Excluded: ${actuallyExcludedCount} files`);
            
            const dbSizeStat = statsContainer.createDiv("similar-notes-stat-item");
            dbSizeStat.setText(`• Database size: ${formatBytes(this.databaseSize)}`);
        };

        // Initial update
        setTimeout(() => updateVaultStats(), 0);

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

        let updateExcludedFilesList: () => void;

        // Add UI for folder exclusion patterns
        new Setting(containerEl)
            .setName("Exclude folders from indexing")
            .setDesc(
                "Enter glob patterns to exclude folders/files from indexing (one per line). Note: Only applies to newly modified notes. Use Reindex to apply to all notes."
            )
            .addTextArea((text) => {
                text.inputEl.rows = 5;
                text.inputEl.cols = 40;
                text.setValue(settings.excludeFolderPatterns.join("\n"));
                text.setPlaceholder("Templates/\nArchive/\n*.tmp\n**/drafts/*");

                // Store error status
                let hasError = false;

                // Style for highlighting invalid patterns
                const errorClass = "similar-notes-regexp-error";

                text.onChange(async (value) => {
                    // Reset error state
                    hasError = false;
                    text.inputEl.removeClass(errorClass);

                    // Process each line as a pattern
                    const patterns = value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0);

                    // Validate patterns
                    const validPatterns: string[] = [];
                    for (const pattern of patterns) {
                        if (isValidGlobPattern(pattern)) {
                            validPatterns.push(pattern);
                        } else {
                            hasError = true;
                        }
                    }

                    // Apply error styling if needed
                    if (hasError) {
                        text.inputEl.addClass(errorClass);
                    }

                    // Only save valid patterns
                    await this.settingsService.update({
                        excludeFolderPatterns: validPatterns,
                    });
                    
                    // Update excluded files list (but not index stats - those reflect current index state)
                    updateExcludedFilesList();
                });
            });

        // Add excluded files preview
        const excludedFilesSetting = new Setting(containerEl)
            .setDesc("");
        
        const excludedFilesDescription = excludedFilesSetting.descEl;
        const excludedFilesList = excludedFilesSetting.controlEl.createDiv(
            "similar-notes-excluded-files-list"
        );
        
        // Function to update excluded files list
        updateExcludedFilesList = () => {
            const allFiles = this.app.vault.getMarkdownFiles();
            const currentSettings = this.settingsService.get();
            const patterns = currentSettings.excludeFolderPatterns;
            
            const excludedFiles = allFiles.filter(file => 
                shouldExcludeFile(file.path, patterns)
            );
            
            excludedFilesDescription.innerHTML = `
                <div>Excluded files:</div>
                <div style="font-size: var(--font-ui-smaller); color: var(--text-muted);">${excludedFiles.length} files total</div>
            `;
            
            // Clear and populate list
            excludedFilesList.empty();
            
            if (excludedFiles.length === 0) {
                const emptyMessage = excludedFilesList.createDiv(
                    "similar-notes-excluded-empty"
                );
                emptyMessage.setText("No files excluded");
            } else {
                // Show up to 5 files with scroll
                excludedFiles.slice(0, Math.min(100, excludedFiles.length)).forEach(file => {
                    const fileItem = excludedFilesList.createDiv(
                        "similar-notes-excluded-file-item"
                    );
                    fileItem.setText(file.path);
                    fileItem.title = file.path; // Show full path on hover
                });
            }
        };
        
        // Update list when settings change
        setTimeout(() => updateExcludedFilesList(), 0);

        // Add "Apply exclusion patterns" button
        new Setting(containerEl)
            .setName("Apply exclusion patterns")
            .setDesc("Synchronize the index with current exclusion patterns without full reindexing")
            .addButton((button) => {
                button
                    .setButtonText("Apply Patterns")
                    .setTooltip("Apply current exclusion patterns to synchronize the index")
                    .onClick(async () => {
                        const preview = this.plugin.previewExclusionApplication();
                        
                        if (preview.removed === 0 && preview.added === 0) {
                            new Notice("No changes needed - index is already synchronized with current patterns");
                            return;
                        }

                        // Show confirmation modal
                        let message = "Apply exclusion patterns?\n\n";
                        if (preview.removed > 0 && preview.added > 0) {
                            message += `This will remove ${preview.removed} files and add ${preview.added} files to the similarity index.`;
                        } else if (preview.removed > 0) {
                            message += `This will remove ${preview.removed} files from the similarity index.`;
                        } else {
                            message += `This will add ${preview.added} files to the similarity index.`;
                        }
                        message += "\n\nDo you want to continue?";

                        new LoadModelModal(
                            this.app,
                            message,
                            async () => {
                                try {
                                    new Notice("Applying exclusion patterns...");
                                    const result = await this.plugin.applyExclusionPatterns();
                                    
                                    let successMessage = "✓ Exclusion patterns applied";
                                    if (result.removed > 0 && result.added > 0) {
                                        successMessage += ` - ${result.removed} files queued for removal, ${result.added} files queued for indexing`;
                                    } else if (result.removed > 0) {
                                        successMessage += ` - ${result.removed} files queued for removal`;
                                    } else if (result.added > 0) {
                                        successMessage += ` - ${result.added} files queued for indexing`;
                                    }
                                    
                                    new Notice(successMessage);
                                    
                                    // Update excluded files list and index stats (actual index state changed)
                                    updateExcludedFilesList();
                                    updateVaultStats();
                                } catch (error) {
                                    log.error("Failed to apply exclusion patterns:", error);
                                    new Notice(`Failed to apply exclusion patterns: ${error.message}`);
                                }
                            },
                            () => {} // Cancel callback
                        ).open();
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

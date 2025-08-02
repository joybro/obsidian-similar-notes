import type { SettingsService } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import { matchesGlobPattern, isValidGlobPattern, shouldExcludeFile } from "@/utils/folderExclusion";
import log from "loglevel";
import { Notice, PluginSettingTab, Setting } from "obsidian";
import type MainPlugin from "../main";
import { LoadModelModal } from "./LoadModelModal";
import { ModelSettingsSection } from "./ModelSettingsSection";

export class SimilarNotesSettingTab extends PluginSettingTab {
    private indexedNoteCount: number = 0;
    private indexedChunkCount: number = 0;
    private databaseSize: number = 0;
    private subscription: { unsubscribe: () => void } | null = null;
    private mTimeStore?: IndexedNoteMTimeStore;
    private modelService?: EmbeddingService;
    private noteChunkRepository?: NoteChunkRepository;
    private modelSettingsSection?: ModelSettingsSection;

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

}

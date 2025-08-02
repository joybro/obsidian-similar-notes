import type { SettingsService } from "@/application/SettingsService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import { isValidGlobPattern, shouldExcludeFile } from "@/utils/folderExclusion";
import log from "loglevel";
import { Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type MainPlugin from "../main";
import { LoadModelModal } from "./LoadModelModal";

interface IndexSettingsSectionProps {
    containerEl: HTMLElement;
    plugin: MainPlugin;
    settingsService: SettingsService;
    app: App;
    indexedNoteCount: number;
    indexedChunkCount: number;
    databaseSize: number;
    mTimeStore?: IndexedNoteMTimeStore;
    noteChunkRepository?: NoteChunkRepository;
}

export class IndexSettingsSection {
    private sectionContainer?: HTMLElement;

    constructor(private props: IndexSettingsSectionProps) {}

    /**
     * Render the index settings section
     */
    render(currentStats?: { indexedNoteCount: number; indexedChunkCount: number; databaseSize: number }): void {
        const { containerEl, settingsService, plugin, app } = this.props;
        // Use current stats if provided, otherwise fall back to props
        const { indexedNoteCount, indexedChunkCount, databaseSize } = currentStats || this.props;
        const settings = settingsService.get();

        // Create or clear the section container
        // Check if sectionContainer exists and is still connected to the DOM
        if (!this.sectionContainer || !this.sectionContainer.parentElement) {
            this.sectionContainer = containerEl.createDiv("index-settings-section");
        } else {
            this.sectionContainer.empty();
        }

        new Setting(this.sectionContainer).setName("Index").setHeading();

        const formatBytes = (bytes: number): string => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        // Index statistics with excluded files count
        const indexStatsSetting = new Setting(this.sectionContainer)
            .setName("Index statistics");

        // Function to update index statistics  
        const updateVaultStats = () => {
            const allFiles = app.vault.getMarkdownFiles();
            
            // Calculate actually excluded files: total files - indexed files
            const actuallyExcludedCount = allFiles.length - indexedNoteCount;
            
            // Clear and rebuild the description with proper structure
            indexStatsSetting.descEl.empty();
            
            const statsContainer = indexStatsSetting.descEl.createDiv("similar-notes-stats-container");
            
            const indexedStat = statsContainer.createDiv("similar-notes-stat-item");
            indexedStat.setText(`• Indexed: ${indexedNoteCount} notes (${indexedChunkCount} chunks)`);
            
            const excludedStat = statsContainer.createDiv("similar-notes-stat-item");
            excludedStat.setText(`• Excluded: ${actuallyExcludedCount} files`);
            
            const dbSizeStat = statsContainer.createDiv("similar-notes-stat-item");
            dbSizeStat.setText(`• Database size: ${formatBytes(databaseSize)}`);
        };

        // Initial update
        setTimeout(() => updateVaultStats(), 0);

        new Setting(this.sectionContainer)
            .setName("Reindex notes")
            .setDesc("Rebuild the similarity index for all notes")
            .addButton((button) => {
                button.setButtonText("Reindex").onClick(async () => {
                    await plugin.reindexNotes();
                });
            });

        new Setting(this.sectionContainer)
            .setName("Include frontmatter in indexing and search")
            .setDesc(
                "If enabled, the frontmatter of each note will be included in the similarity index and search."
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(settings.includeFrontmatter)
                    .onChange(async (value) => {
                        await settingsService.update({
                            includeFrontmatter: value,
                        });
                    });
            });

        let updateExcludedFilesList: () => void;

        // Add UI for folder exclusion patterns
        new Setting(this.sectionContainer)
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
                    await settingsService.update({
                        excludeFolderPatterns: validPatterns,
                    });
                    
                    // Update excluded files list (but not index stats - those reflect current index state)
                    updateExcludedFilesList();
                });
            });

        // Add excluded files preview
        const excludedFilesSetting = new Setting(this.sectionContainer)
            .setDesc("");
        
        const excludedFilesDescription = excludedFilesSetting.descEl;
        const excludedFilesList = excludedFilesSetting.controlEl.createDiv(
            "similar-notes-excluded-files-list"
        );
        
        // Function to update excluded files list
        updateExcludedFilesList = () => {
            const allFiles = app.vault.getMarkdownFiles();
            const currentSettings = settingsService.get();
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
        new Setting(this.sectionContainer)
            .setName("Apply exclusion patterns")
            .setDesc("Synchronize the index with current exclusion patterns without full reindexing")
            .addButton((button) => {
                button
                    .setButtonText("Apply Patterns")
                    .setTooltip("Apply current exclusion patterns to synchronize the index")
                    .onClick(async () => {
                        const preview = plugin.previewExclusionApplication();
                        
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
                            app,
                            message,
                            async () => {
                                try {
                                    new Notice("Applying exclusion patterns...");
                                    const result = await plugin.applyExclusionPatterns();
                                    
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
                const currentSettings = settingsService.get();
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
        new Setting(this.sectionContainer)
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
                    await settingsService.update({
                        excludeRegexPatterns: validPatterns,
                    });

                    // Update test output when patterns change
                    processTestInput();
                });
            });

        // Add RegExp tester UI
        const regExpTesterContainer = this.sectionContainer.createDiv(
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
            settingsService.update({
                regexpTestInputText: testInputTextArea.value,
            });

            // Process the input to update the output
            processTestInput();
        });

        // Initialize output when settings tab opens
        setTimeout(() => processTestInput(), 0);
    }
}
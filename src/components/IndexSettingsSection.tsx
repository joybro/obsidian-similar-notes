import type { SettingsService } from "@/application/SettingsService";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import { isValidGlobPattern, shouldExcludeFile } from "@/utils/folderExclusion";
import log from "loglevel";
import type { App } from "obsidian";
import { Notice, Setting } from "obsidian";
import type MainPlugin from "../main";
import { LoadModelModal } from "./LoadModelModal";

interface IndexSettingsSectionProps {
    containerEl: HTMLElement;
    plugin: MainPlugin;
    settingsService: SettingsService;
    app: App;
    mTimeStore?: IndexedNoteMTimeStore;
    noteChunkRepository?: NoteChunkRepository;
}

export class IndexSettingsSection {
    private sectionContainer?: HTMLElement;
    private statsContainer?: HTMLElement;
    private indexedStat?: HTMLElement;
    private excludedStat?: HTMLElement;

    constructor(private props: IndexSettingsSectionProps) {}

    /**
     * Update just the statistics without rebuilding the entire section
     */
    updateStats(stats: {
        indexedNoteCount: number;
        indexedChunkCount: number;
    }): void {
        if (this.indexedStat && this.excludedStat) {
            const { app } = this.props;
            const allFiles = app.vault.getMarkdownFiles();
            const actuallyExcludedCount = allFiles.length - stats.indexedNoteCount;

            this.indexedStat.setText(
                `• Indexed: ${stats.indexedNoteCount} notes (${stats.indexedChunkCount} chunks)`
            );
            this.excludedStat.setText(`• Excluded: ${actuallyExcludedCount} files`);
        }
    }

    private renderFolderExclusionSettings(updateVaultStats: () => void): void {
        const { settingsService } = this.props;
        const settings = settingsService.get();

        let updateExcludedFilesList: () => void = () => {
            // Will be set by renderExcludedFilesPreview
        };

        const updateExcludedFilesListWrapper = () => {
            updateExcludedFilesList();
        };

        new Setting(this.sectionContainer!)
            .setName("Exclude folders from indexing")
            .setDesc(
                "Enter glob patterns to exclude folders/files from indexing (one per line). Note: Only applies to newly modified notes. Use Reindex to apply to all notes."
            )
            .addTextArea((text) => {
                text.inputEl.rows = 5;
                text.inputEl.cols = 40;
                text.setValue(settings.excludeFolderPatterns.join("\n"));
                text.setPlaceholder("Templates/\nArchive/\n*.tmp\n**/drafts/*");

                let hasError = false;
                const errorClass = "similar-notes-regexp-error";

                text.onChange(async (value) => {
                    hasError = false;
                    text.inputEl.removeClass(errorClass);

                    const patterns = value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0);

                    const validPatterns: string[] = [];
                    for (const pattern of patterns) {
                        if (isValidGlobPattern(pattern)) {
                            validPatterns.push(pattern);
                        } else {
                            hasError = true;
                        }
                    }

                    if (hasError) {
                        text.inputEl.addClass(errorClass);
                    }

                    await settingsService.update({
                        excludeFolderPatterns: validPatterns,
                    });

                    updateExcludedFilesListWrapper();
                });
            });

        this.renderExcludedFilesPreview((fn) => {
            updateExcludedFilesList = fn;
        });
        this.renderApplyExclusionButton(updateExcludedFilesListWrapper, updateVaultStats);

        setTimeout(() => updateExcludedFilesListWrapper(), 0);
    }

    private renderExcludedFilesPreview(
        setUpdateFunction: (fn: () => void) => void
    ): void {
        const { app, settingsService } = this.props;

        const excludedFilesSetting = new Setting(this.sectionContainer!).setDesc("");
        const excludedFilesDescription = excludedFilesSetting.descEl;
        const excludedFilesList = excludedFilesSetting.controlEl.createDiv(
            "similar-notes-excluded-files-list"
        );

        const updateExcludedFilesList = () => {
            const allFiles = app.vault.getMarkdownFiles();
            const currentSettings = settingsService.get();
            const patterns = currentSettings.excludeFolderPatterns;

            const excludedFiles = allFiles.filter((file) =>
                shouldExcludeFile(file.path, patterns)
            );

            excludedFilesDescription.innerHTML = `
                <div>Excluded files:</div>
                <div style="font-size: var(--font-ui-smaller); color: var(--text-muted);">${excludedFiles.length} files total</div>
            `;

            excludedFilesList.empty();

            if (excludedFiles.length === 0) {
                const emptyMessage = excludedFilesList.createDiv(
                    "similar-notes-excluded-empty"
                );
                emptyMessage.setText("No files excluded");
            } else {
                excludedFiles
                    .slice(0, Math.min(100, excludedFiles.length))
                    .forEach((file) => {
                        const fileItem = excludedFilesList.createDiv(
                            "similar-notes-excluded-file-item"
                        );
                        fileItem.setText(file.path);
                        fileItem.title = file.path;
                    });
            }
        };

        setUpdateFunction(updateExcludedFilesList);
    }

    private renderApplyExclusionButton(
        updateExcludedFilesList: () => void,
        updateVaultStats: () => void
    ): void {
        const { app, plugin } = this.props;

        new Setting(this.sectionContainer!)
            .setName("Apply exclusion patterns")
            .setDesc(
                "Synchronize the index with current exclusion patterns without full reindexing"
            )
            .addButton((button) => {
                button
                    .setButtonText("Apply Patterns")
                    .setTooltip(
                        "Apply current exclusion patterns to synchronize the index"
                    )
                    .onClick(async () => {
                        const preview = plugin.previewExclusionApplication();

                        if (preview.removed === 0 && preview.added === 0) {
                            new Notice(
                                "No changes needed - index is already synchronized with current patterns"
                            );
                            return;
                        }

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

                                    updateExcludedFilesList();
                                    updateVaultStats();
                                } catch (error) {
                                    log.error("Failed to apply exclusion patterns:", error);
                                    new Notice(
                                        `Failed to apply exclusion patterns: ${error.message}`
                                    );
                                }
                            },
                            () => {
                                // User cancelled
                            }
                        ).open();
                    });
            });
    }

    private renderContentExclusionSettings(processTestInput: () => void): void {
        const { settingsService } = this.props;
        const settings = settingsService.get();

        new Setting(this.sectionContainer!)
            .setName("Exclude content from indexing")
            .setDesc(
                "Enter regular expressions to exclude content from indexing (one per line). Note: Only applies to newly modified notes. Use Reindex to apply to all notes."
            )
            .addTextArea((text) => {
                text.inputEl.rows = 5;
                text.inputEl.cols = 40;
                text.setValue(settings.excludeRegexPatterns.join("\n"));
                const errorMessages: Map<number, string> = new Map();
                const errorLineClass = "similar-notes-regexp-error";

                const applyErrorStyles = () => {
                    const textArea = text.inputEl;
                    textArea.removeClass(errorLineClass);
                    textArea.title = "";

                    if (errorMessages.size > 0) {
                        textArea.addClass(errorLineClass);
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
                    errorMessages.clear();
                    const lines = value.split("\n");
                    const validPatterns: string[] = [];

                    lines.forEach((pattern, index) => {
                        if (pattern.trim().length === 0) return;

                        try {
                            new RegExp(pattern);
                            validPatterns.push(pattern);
                        } catch (e) {
                            errorMessages.set(index, e.message);
                        }
                    });

                    applyErrorStyles();

                    await settingsService.update({
                        excludeRegexPatterns: validPatterns,
                    });

                    processTestInput();
                });
            });
    }

    private renderRegExpTester(): () => void {
        const { settingsService } = this.props;
        const settings = settingsService.get();

        const regExpTesterContainer = this.sectionContainer!.createDiv(
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

        testInputTextArea.addEventListener("input", () => {
            settingsService.update({
                regexpTestInputText: testInputTextArea.value,
            });
            processTestInput();
        });

        setTimeout(() => processTestInput(), 0);

        return processTestInput;
    }

    /**
     * Render the index settings section
     */
    render(currentStats: {
        indexedNoteCount: number;
        indexedChunkCount: number;
    }): void {
        this.initializeSectionContainer();

        const updateVaultStats = this.renderIndexStatistics(
            currentStats.indexedNoteCount,
            currentStats.indexedChunkCount
        );

        this.renderBasicIndexSettings();
        this.renderFolderExclusionSettings(updateVaultStats);

        const processTestInput = this.renderRegExpTester();
        this.renderContentExclusionSettings(processTestInput);
    }

    private initializeSectionContainer(): void {
        const { containerEl } = this.props;

        if (!this.sectionContainer || !this.sectionContainer.parentElement) {
            this.sectionContainer = containerEl.createDiv(
                "index-settings-section"
            );
            this.statsContainer = undefined;
            this.indexedStat = undefined;
            this.excludedStat = undefined;
        } else {
            this.sectionContainer.empty();
            this.statsContainer = undefined;
            this.indexedStat = undefined;
            this.excludedStat = undefined;
        }

        this.sectionContainer.createDiv("setting-item-separator");
        new Setting(this.sectionContainer).setName("Index").setHeading();
    }

    private renderIndexStatistics(
        indexedNoteCount: number,
        indexedChunkCount: number
    ): () => void {
        const { app } = this.props;

        const indexStatsSetting = new Setting(this.sectionContainer!).setName(
            "Index statistics"
        );

        if (!this.statsContainer) {
            this.statsContainer = indexStatsSetting.descEl.createDiv(
                "similar-notes-stats-container"
            );
            this.indexedStat = this.statsContainer.createDiv("similar-notes-stat-item");
            this.excludedStat = this.statsContainer.createDiv("similar-notes-stat-item");
        }

        const updateVaultStats = () => {
            const allFiles = app.vault.getMarkdownFiles();
            const actuallyExcludedCount = allFiles.length - indexedNoteCount;

            if (this.indexedStat && this.excludedStat) {
                this.indexedStat.setText(
                    `• Indexed: ${indexedNoteCount} notes (${indexedChunkCount} chunks)`
                );
                this.excludedStat.setText(`• Excluded: ${actuallyExcludedCount} files`);
            }
        };

        setTimeout(() => updateVaultStats(), 0);
        return updateVaultStats;
    }

    private renderBasicIndexSettings(): void {
        const { plugin, settingsService } = this.props;
        const settings = settingsService.get();

        new Setting(this.sectionContainer!)
            .setName("Reindex notes")
            .setDesc("Rebuild the similarity index for all notes")
            .addButton((button) => {
                button.setButtonText("Reindex").onClick(async () => {
                    await plugin.reindexNotes();
                });
            });

        new Setting(this.sectionContainer!)
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
    }
}

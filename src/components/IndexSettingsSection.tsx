/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { SettingsService, SimilarNotesSettings } from "@/application/SettingsService";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import { isValidGlobPattern, shouldExcludeFile } from "@/utils/folderExclusion";
import log from "loglevel";
import type { App, Setting } from "obsidian";
import { Notice, SettingGroup } from "obsidian";
import type MainPlugin from "../main";
import { LoadModelModal } from "./LoadModelModal";
import type { SettingBuilder } from "./OpenAISettingsSection";

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

    // State for dynamic updates
    private excludedFilesDescription?: HTMLElement;
    private excludedFilesList?: HTMLElement;
    private testInputTextArea?: HTMLTextAreaElement;
    private testOutputTextArea?: HTMLTextAreaElement;

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

    /**
     * Render the index settings section
     */
    render(currentStats: {
        indexedNoteCount: number;
        indexedChunkCount: number;
    }): void {
        this.initializeSectionContainer();

        const { app } = this.props;
        const indexedNoteCount = currentStats.indexedNoteCount;
        const indexedChunkCount = currentStats.indexedChunkCount;

        // Build all settings in a single SettingGroup
        const settingGroup = new SettingGroup(this.sectionContainer!).setHeading("Index");

        // Add all setting builders
        const builders = this.getSettingBuilders();
        builders.forEach(builder => settingGroup.addSetting(builder));

        // Initialize stats and excluded files list
        setTimeout(() => {
            const allFiles = app.vault.getMarkdownFiles();
            const actuallyExcludedCount = allFiles.length - indexedNoteCount;

            if (this.indexedStat && this.excludedStat) {
                this.indexedStat.setText(
                    `• Indexed: ${indexedNoteCount} notes (${indexedChunkCount} chunks)`
                );
                this.excludedStat.setText(`• Excluded: ${actuallyExcludedCount} files`);
            }

            this.updateExcludedFilesList();
            this.processTestInput();
        }, 0);
    }

    private getSettingBuilders(): SettingBuilder[] {
        const { plugin, settingsService } = this.props;
        const settings = settingsService.get();

        return [
            // Index statistics
            (setting) => {
                setting.setName("Index statistics");
                if (!this.statsContainer) {
                    this.statsContainer = setting.descEl.createDiv("similar-notes-stats-container");
                    this.indexedStat = this.statsContainer.createDiv("similar-notes-stat-item");
                    this.excludedStat = this.statsContainer.createDiv("similar-notes-stat-item");
                }
            },
            // Indexing delay
            (setting) => {
                setting
                    .setName("Indexing delay")
                    .setDesc("Wait time (seconds) after file changes before indexing. Higher values reduce API costs for paid providers.")
                    .addText((text) => {
                        text.inputEl.type = "number";
                        text.inputEl.min = "0";
                        text.inputEl.max = "60";
                        text.inputEl.step = "1";
                        text.setValue(String(settings.indexingDelaySeconds ?? 1));
                        text.setPlaceholder("1");
                        text.onChange(async (value) => {
                            const numValue = parseInt(value, 10);
                            if (!isNaN(numValue) && numValue >= 0 && numValue <= 60) {
                                await settingsService.update({ indexingDelaySeconds: numValue });
                            }
                        });
                    });
            },
            // Reindex notes
            (setting) => {
                setting
                    .setName("Reindex notes")
                    .setDesc("Rebuild the similarity index for all notes")
                    .addButton((button) => {
                        button.setButtonText("Reindex").onClick(async () => {
                            await plugin.reindexNotes();
                        });
                    });
            },
            // Include frontmatter
            (setting) => {
                setting
                    .setName("Include frontmatter in indexing and search")
                    .setDesc("If enabled, the frontmatter of each note will be included in the similarity index and search.")
                    .addToggle((toggle) => {
                        toggle.setValue(settings.includeFrontmatter).onChange(async (value) => {
                            await settingsService.update({ includeFrontmatter: value });
                        });
                    });
            },
            // Exclude folders
            (setting) => this.buildExcludeFoldersSetting(setting, settings, settingsService),
            // Excluded files preview
            (setting) => {
                setting.setDesc("");
                this.excludedFilesDescription = setting.descEl;
                this.excludedFilesList = setting.controlEl.createDiv("similar-notes-excluded-files-list");
            },
            // Apply exclusion patterns
            (setting) => {
                setting
                    .setName("Apply exclusion patterns")
                    .setDesc("Synchronize the index with current exclusion patterns without full reindexing")
                    .addButton((button) => {
                        button
                            .setButtonText("Apply Patterns")
                            .setTooltip("Apply current exclusion patterns to synchronize the index")
                            .onClick(async () => this.handleApplyExclusionPatterns());
                    });
            },
            // RegExp tester
            (setting) => this.renderRegExpTesterContent(setting),
            // Exclude content
            (setting) => this.buildExcludeContentSetting(setting, settings, settingsService),
        ];
    }

    private buildExcludeFoldersSetting(
        setting: Setting,
        settings: SimilarNotesSettings,
        settingsService: SettingsService
    ): void {
        setting
            .setName("Exclude folders from indexing")
            .setDesc("Enter glob patterns to exclude folders/files from indexing (one per line). Note: Only applies to newly modified notes. Use Reindex to apply to all notes.")
            .addTextArea((text) => {
                text.inputEl.rows = 5;
                text.inputEl.cols = 40;
                text.setValue(settings.excludeFolderPatterns.join("\n"));
                text.setPlaceholder("Templates/\nArchive/\n*.tmp\n**/drafts/*");

                const errorClass = "similar-notes-regexp-error";

                text.onChange(async (value) => {
                    let hasError = false;
                    text.inputEl.removeClass(errorClass);

                    const patterns = value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
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

                    await settingsService.update({ excludeFolderPatterns: validPatterns });
                    this.updateExcludedFilesList();
                });
            });
    }

    private buildExcludeContentSetting(
        setting: Setting,
        settings: SimilarNotesSettings,
        settingsService: SettingsService
    ): void {
        setting
            .setName("Exclude content from indexing")
            .setDesc("Enter regular expressions to exclude content from indexing (one per line). Note: Only applies to newly modified notes. Use Reindex to apply to all notes.")
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
                        const tooltipMessages = Array.from(errorMessages.entries())
                            .map(([line, message]) => `Line ${line + 1}: ${message}`)
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
                    await settingsService.update({ excludeRegexPatterns: validPatterns });
                    this.processTestInput();
                });
            });
    }

    private initializeSectionContainer(): void {
        const { containerEl } = this.props;

        if (!this.sectionContainer || !this.sectionContainer.parentElement) {
            this.sectionContainer = containerEl.createDiv("index-settings-section");
        } else {
            this.sectionContainer.empty();
        }

        // Reset state
        this.statsContainer = undefined;
        this.indexedStat = undefined;
        this.excludedStat = undefined;
        this.excludedFilesDescription = undefined;
        this.excludedFilesList = undefined;
        this.testInputTextArea = undefined;
        this.testOutputTextArea = undefined;
    }

    private updateExcludedFilesList(): void {
        if (!this.excludedFilesDescription || !this.excludedFilesList) return;

        const { app, settingsService } = this.props;
        const allFiles = app.vault.getMarkdownFiles();
        const currentSettings = settingsService.get();
        const patterns = currentSettings.excludeFolderPatterns;

        const excludedFiles = allFiles.filter((file) => shouldExcludeFile(file.path, patterns));

        this.excludedFilesDescription.innerHTML = `
            <div>Excluded files:</div>
            <div style="font-size: var(--font-ui-smaller); color: var(--text-muted);">${excludedFiles.length} files total</div>
        `;

        this.excludedFilesList.empty();

        if (excludedFiles.length === 0) {
            const emptyMessage = this.excludedFilesList.createDiv("similar-notes-excluded-empty");
            emptyMessage.setText("No files excluded");
        } else {
            excludedFiles.slice(0, Math.min(100, excludedFiles.length)).forEach((file) => {
                const fileItem = this.excludedFilesList!.createDiv("similar-notes-excluded-file-item");
                fileItem.setText(file.path);
                fileItem.title = file.path;
            });
        }
    }

    private handleApplyExclusionPatterns(): void {
        const { app, plugin } = this.props;

        const preview = plugin.previewExclusionApplication();

        if (preview.removed === 0 && preview.added === 0) {
            new Notice("No changes needed - index is already synchronized with current patterns");
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

                    let successMessage = "Exclusion patterns applied";
                    if (result.removed > 0 && result.added > 0) {
                        successMessage += ` - ${result.removed} files queued for removal, ${result.added} files queued for indexing`;
                    } else if (result.removed > 0) {
                        successMessage += ` - ${result.removed} files queued for removal`;
                    } else if (result.added > 0) {
                        successMessage += ` - ${result.added} files queued for indexing`;
                    }

                    new Notice(successMessage);
                    this.updateExcludedFilesList();
                } catch (error) {
                    log.error("Failed to apply exclusion patterns:", error);
                    new Notice(`Failed to apply exclusion patterns: ${error.message}`);
                }
            },
            () => {
                // User cancelled
            }
        ).open();
    }

    private renderRegExpTesterContent(setting: Setting): void {
        const { settingsService } = this.props;
        const settings = settingsService.get();

        const container = setting.settingEl;
        container.addClass("similar-notes-regexp-tester");

        setting.setDesc("Test your regular expressions against sample text");

        const regExpTesterContent = setting.controlEl;
        regExpTesterContent.addClass("similar-notes-regexp-tester-content");

        const testInputContainer = regExpTesterContent.createDiv("similar-notes-test-input-container");
        const testOutputContainer = regExpTesterContent.createDiv("similar-notes-test-output-container");

        testInputContainer.createDiv("similar-notes-test-label").setText("Input text:");
        testOutputContainer.createDiv("similar-notes-test-label").setText("Result (content that will be indexed):");

        this.testInputTextArea = testInputContainer.createEl("textarea");
        this.testInputTextArea.rows = 8;
        this.testInputTextArea.cols = 30;
        this.testInputTextArea.placeholder = "Enter text to test against your regular expressions";
        this.testInputTextArea.value = settings.regexpTestInputText || "";

        this.testOutputTextArea = testOutputContainer.createEl("textarea");
        this.testOutputTextArea.rows = 8;
        this.testOutputTextArea.cols = 30;
        this.testOutputTextArea.readOnly = true;
        this.testOutputTextArea.placeholder = "Filtered content will appear here";

        this.testInputTextArea.addEventListener("input", () => {
            settingsService.update({ regexpTestInputText: this.testInputTextArea!.value });
            this.processTestInput();
        });
    }

    private processTestInput(): void {
        if (!this.testInputTextArea || !this.testOutputTextArea) return;

        const { settingsService } = this.props;
        const inputText = this.testInputTextArea.value || "";
        let outputText = inputText;

        try {
            const currentSettings = settingsService.get();
            const patterns = currentSettings.excludeRegexPatterns;

            for (const pattern of patterns) {
                const regex = new RegExp(pattern, "gm");
                outputText = outputText.replace(regex, "");
            }
            this.testOutputTextArea.value = outputText;
        } catch (e) {
            this.testOutputTextArea.value = `Error processing RegExp: ${e.message}`;
        }
    }
}

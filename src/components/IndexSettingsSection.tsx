/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { SettingsService, SimilarNotesSettings } from "@/application/SettingsService";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { ErroredNoteStore } from "@/infrastructure/ErroredNoteStore";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import { computeIndexStatus, visibleErroredEntries } from "@/application/indexStatus";
import { isValidGlobPattern, shouldExcludeFile } from "@/utils/folderExclusion";
import log from "loglevel";
import type { App, Setting } from "obsidian";
import { Notice, SettingGroup } from "obsidian";
import type MainPlugin from "../main";
import { renderErroredFilesList } from "./erroredFilesList";
import { RegexpExclusionTester } from "./regexpExclusionTester";
import { LoadModelModal } from "./LoadModelModal";
import type { SettingBuilder } from "./OpenAISettingsSection";

interface IndexSettingsSectionProps {
    containerEl: HTMLElement;
    plugin: MainPlugin;
    settingsService: SettingsService;
    app: App;
    mTimeStore?: IndexedNoteMTimeStore;
    erroredStore?: ErroredNoteStore;
    noteChunkRepository?: NoteChunkRepository;
}

export class IndexSettingsSection {
    private sectionContainer?: HTMLElement;
    private statsContainer?: HTMLElement;
    private indexedStat?: HTMLElement;
    private erroredStat?: HTMLElement;
    private excludedStat?: HTMLElement;

    // State for dynamic updates
    private excludedFilesDescription?: HTMLElement;
    private excludedFilesList?: HTMLElement;
    private erroredFilesDescription?: HTMLElement;
    private erroredFilesList?: HTMLElement;
    private retryErroredButton?: HTMLButtonElement;
    private regexpTester: RegexpExclusionTester;

    constructor(private props: IndexSettingsSectionProps) {
        this.regexpTester = new RegexpExclusionTester(props.settingsService);
    }

    /**
     * Update just the statistics without rebuilding the entire section
     */
    updateStats(stats: {
        indexedNoteCount: number;
        indexedChunkCount: number;
    }): void {
        this.renderStats(stats.indexedChunkCount);
        this.updateErroredFilesList();
    }

    /**
     * Render the honest, mutually-exclusive Indexed / Errored / Excluded counts
     * (indexing-status spec §3) — replaces the old `total - indexed` guess that
     * lumped errored/pending files into "Excluded".
     */
    private renderStats(indexedChunkCount: number): void {
        if (!this.indexedStat || !this.excludedStat) return;
        const { app, settingsService } = this.props;
        const allPaths = app.vault.getMarkdownFiles().map((f) => f.path);
        const patterns = settingsService.get().excludeFolderPatterns || [];
        const indexedPaths = this.props.mTimeStore?.getAllPaths() ?? [];
        const erroredPaths = this.props.erroredStore?.getAllPaths() ?? [];

        const status = computeIndexStatus(
            allPaths,
            patterns,
            indexedPaths,
            erroredPaths
        );

        this.indexedStat.setText(
            `• Indexed: ${status.indexed} notes (${indexedChunkCount} chunks)`
        );
        if (this.erroredStat) {
            this.erroredStat.setText(`• Errored: ${status.errored} files`);
        }
        this.excludedStat.setText(`• Excluded: ${status.excluded} files`);
    }

    /**
     * Render the index settings section
     */
    render(currentStats: {
        indexedNoteCount: number;
        indexedChunkCount: number;
    }): void {
        this.initializeSectionContainer();

        const indexedChunkCount = currentStats.indexedChunkCount;

        // Index group: general config, statistics, and error recovery.
        const indexGroup = new SettingGroup(this.sectionContainer!).setHeading("Index");
        this.getIndexSettingBuilders().forEach((builder) => indexGroup.addSetting(builder));

        // Exclusion lives in its own top-level group so the Index group stays
        // scannable. SettingGroup can't nest and Setting-level sub-headings
        // render poorly, so a sibling group is the clean way to separate it.
        const exclusionGroup = new SettingGroup(this.sectionContainer!).setHeading("Exclude from index");
        this.getExclusionSettingBuilders().forEach((builder) => exclusionGroup.addSetting(builder));

        // Initialize stats and excluded/errored files lists
        setTimeout(() => {
            this.renderStats(indexedChunkCount);
            this.updateErroredFilesList();
            this.updateExcludedFilesList();
            this.regexpTester.run();
        }, 0);
    }

    /**
     * Builders for the "Index" group: general indexing config, statistics, and
     * error recovery. Exclusion settings live in their own group
     * ({@link getExclusionSettingBuilders}).
     */
    private getIndexSettingBuilders(): SettingBuilder[] {
        const { plugin, settingsService } = this.props;
        const settings = settingsService.get();

        return [
            // Index statistics
            (setting) => {
                setting.setName("Index statistics");
                if (!this.statsContainer) {
                    this.statsContainer = setting.descEl.createDiv("similar-notes-stats-container");
                    this.indexedStat = this.statsContainer.createDiv("similar-notes-stat-item");
                    this.erroredStat = this.statsContainer.createDiv("similar-notes-stat-item");
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
            // Errored files preview — mirrors the Excluded files preview exactly:
            // empty name/desc so the info column stays minimal and the box claims
            // the full control width (renders wide). The count label goes in
            // descEl; the explanation + Retry action live in the row below.
            (setting) => {
                setting.setDesc("");
                this.erroredFilesDescription = setting.descEl;
                this.erroredFilesList = setting.controlEl.createDiv("similar-notes-errored-files-list");
            },
            // Retry errored notes
            (setting) => {
                setting
                    .setName("Retry errored notes")
                    .setDesc(
                        "Re-attempt all errored notes after fixing the cause (e.g. wrong model, Ollama down). Editing a note retries it automatically."
                    )
                    .addButton((button) => {
                        this.retryErroredButton = button.buttonEl;
                        button
                            .setButtonText("Retry errored")
                            .setTooltip("Re-queue all errored notes for another attempt")
                            .onClick(async () => {
                                await this.props.plugin.retryErroredNotes();
                                this.updateErroredFilesList();
                            });
                    });
            },
        ];
    }

    /**
     * Builders for the "Exclude from index" group. Ordered as two coherent
     * blocks: folder exclusion (which files are indexed — input, preview, and the
     * Apply action that syncs the index) followed by content exclusion (what text
     * within a file is indexed — regex input, then its tester).
     */
    private getExclusionSettingBuilders(): SettingBuilder[] {
        const { settingsService } = this.props;
        const settings = settingsService.get();

        return [
            // Exclude folders
            (setting) => this.buildExcludeFoldersSetting(setting, settings, settingsService),
            // Excluded files preview
            (setting) => {
                setting.setDesc("");
                this.excludedFilesDescription = setting.descEl;
                this.excludedFilesList = setting.controlEl.createDiv("similar-notes-excluded-files-list");
            },
            // Apply exclusion patterns (acts on folder/glob patterns)
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
            // Exclude content
            (setting) => this.buildExcludeContentSetting(setting, settings, settingsService),
            // RegExp tester (tests the content-exclusion patterns above)
            (setting) => this.regexpTester.render(setting),
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
                    this.regexpTester.run();
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
        this.erroredStat = undefined;
        this.excludedStat = undefined;
        this.excludedFilesDescription = undefined;
        this.excludedFilesList = undefined;
        this.erroredFilesDescription = undefined;
        this.erroredFilesList = undefined;
        this.retryErroredButton = undefined;
        this.regexpTester.reset();
    }

    private updateErroredFilesList(): void {
        const allEntries = this.props.erroredStore?.getAll() ?? {};
        // Mirror the "Errored: N" stat's precedence: hide entries for files that
        // are now excluded by a glob, or no longer present in the vault — so the
        // list and its count never disagree with the stat.
        const vaultPaths = this.props.app.vault
            .getMarkdownFiles()
            .map((f) => f.path);
        const patterns =
            this.props.settingsService.get().excludeFolderPatterns || [];
        const entries = visibleErroredEntries(allEntries, vaultPaths, patterns);

        if (this.erroredFilesDescription) {
            this.erroredFilesDescription.empty();
            this.erroredFilesDescription.createDiv().setText("Errored files:");
            this.erroredFilesDescription
                .createDiv("similar-notes-errored-count")
                .setText(`${Object.keys(entries).length} errored`);
        }

        if (this.erroredFilesList) {
            renderErroredFilesList(
                this.erroredFilesList,
                this.retryErroredButton,
                entries
            );
        }
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

}

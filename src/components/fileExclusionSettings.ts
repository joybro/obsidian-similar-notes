import type { SettingsService, SimilarNotesSettings } from "@/application/SettingsService";
import { isValidGlobPattern } from "@/utils/folderExclusion";
import type { NoteExclusionSource } from "@/utils/noteExclusion";
import type { Setting } from "obsidian";

/**
 * UI pieces of the "Exclude files from index" settings group (frontmatter-
 * exclusion spec §4): the path-glob textarea, the frontmatter-rule textarea,
 * and the excluded-files preview renderer. Extracted from
 * IndexSettingsSection, which owns the group layout and the exclusion
 * predicate.
 */

export function buildExcludePathsSetting(
    setting: Setting,
    settings: SimilarNotesSettings,
    settingsService: SettingsService,
    onChanged: () => void
): void {
    setting
        .setName("Path patterns")
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
                onChanged();
            });
        });
}

export function buildExcludeFrontmatterSetting(
    setting: Setting,
    settings: SimilarNotesSettings,
    settingsService: SettingsService,
    onChanged: () => void
): void {
    setting
        .setName("Frontmatter properties")
        .setDesc(
            "Exclude notes whose frontmatter matches a rule (one per line)."
        )
        .addTextArea((text) => {
            text.inputEl.rows = 4;
            text.inputEl.cols = 40;
            text.setValue((settings.excludeFrontmatterRules || []).join("\n"));
            text.setPlaceholder("noindex\ntags: noindex\nembed: false");

            text.onChange(async (value) => {
                const rules = value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                await settingsService.update({
                    excludeFrontmatterRules: rules,
                });
                onChanged();
            });
        });

    // Rule syntax reference, below the one-line description.
    const syntax = setting.descEl.createEl("ul");
    syntax.createEl("li").setText("key — property exists (and is not false)");
    syntax.createEl("li").setText(
        "key: value — property equals the value, or the list contains it"
    );
}

export interface ExcludedFileEntry {
    path: string;
    source: NoteExclusionSource;
}

/**
 * Render the excluded-files preview: one row per file, badged with the
 * mechanism that excluded it (frontmatter-exclusion spec §3).
 */
export function renderExcludedFilesList(
    descEl: HTMLElement,
    listEl: HTMLElement,
    entries: ExcludedFileEntry[]
): void {
    descEl.innerHTML = `
        <div>Excluded files:</div>
        <div style="font-size: var(--font-ui-smaller); color: var(--text-muted);">${entries.length} files total</div>
    `;

    listEl.empty();

    if (entries.length === 0) {
        const emptyMessage = listEl.createDiv("similar-notes-excluded-empty");
        emptyMessage.setText("No files excluded");
        return;
    }

    entries.slice(0, 100).forEach((entry) => {
        const fileItem = listEl.createDiv("similar-notes-excluded-file-item");
        fileItem.title = entry.path;
        fileItem
            .createSpan("similar-notes-excluded-file-path")
            .setText(entry.path);
        fileItem
            .createSpan(
                `similar-notes-exclusion-badge similar-notes-exclusion-badge-${entry.source}`
            )
            .setText(entry.source);
    });
}

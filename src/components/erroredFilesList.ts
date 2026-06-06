import type { ErroredNoteEntry } from "@/infrastructure/IndexedDBErroredStorage";

const MAX_LISTED = 100;

/**
 * Render the errored-files preview list (path + error reason) into `listEl` and
 * toggle the retry button's disabled state. Extracted from IndexSettingsSection
 * to keep that file focused.
 */
export function renderErroredFilesList(
    listEl: HTMLElement,
    retryButton: HTMLButtonElement | undefined,
    entries: Record<string, ErroredNoteEntry>
): void {
    const paths = Object.keys(entries);

    if (retryButton) {
        retryButton.disabled = paths.length === 0;
    }

    listEl.empty();

    if (paths.length === 0) {
        listEl
            .createDiv("similar-notes-errored-empty")
            .setText("No errored files");
        return;
    }

    paths.slice(0, Math.min(MAX_LISTED, paths.length)).forEach((path) => {
        const entry = entries[path];
        const item = listEl.createDiv("similar-notes-errored-file-item");
        item.setText(path);
        item.title = `${path}\n${entry.error}`;
        item.createDiv("similar-notes-errored-file-reason").setText(entry.error);
    });

    if (paths.length > MAX_LISTED) {
        listEl
            .createDiv("similar-notes-errored-more")
            .setText(`…and ${paths.length - MAX_LISTED} more`);
    }
}

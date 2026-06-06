import type { App } from "obsidian";
import { MarkdownView, TFile } from "obsidian";

// Characters illegal in OS file names plus Obsidian link-sensitive characters.
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeFileName(raw: string): string {
    return raw
        .replace(ILLEGAL_FILENAME_CHARS, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Create a note whose title is the (sanitized) search query, in Obsidian's
 * configured default new-note location, and open it. Returns false (no-op) for
 * an empty query; opens the existing note instead of duplicating on a name clash.
 *
 * NOTE: `getNewFileParent` / `vault.create` signatures verified against the
 * Obsidian API; if a future API change breaks this, re-check the docs.
 */
export async function createNoteFromQuery(app: App, query: string): Promise<boolean> {
    const baseName = sanitizeFileName(query);
    if (!baseName) return false;

    const sourcePath = app.workspace.getActiveFile()?.path ?? "";
    const parent = app.fileManager.getNewFileParent(sourcePath);
    const folderPrefix = parent?.path ? `${parent.path}/` : "";
    const targetPath = `${folderPrefix}${baseName}.md`;

    const existing = app.vault.getAbstractFileByPath(targetPath);
    if (existing) {
        app.workspace.openLinkText(targetPath, sourcePath, false);
        return true;
    }

    await app.vault.create(targetPath, "");
    app.workspace.openLinkText(targetPath, sourcePath, false);
    return true;
}

/**
 * Resolve a vault path to a `[[linktext]]` string using Obsidian's configured
 * link format (relative to `sourcePath`). Returns null when the path is not a file.
 */
export function resolveWikilink(
    app: App,
    notePath: string,
    sourcePath: string
): string | null {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return null;
    const linktext = app.metadataCache.fileToLinktext(file, sourcePath);
    return `[[${linktext}]]`;
}

/**
 * Insert a wiki-link to the given note path at the active editor's cursor,
 * followed by a single space so successive inserts are space-separated.
 * Returns false (caller surfaces a Notice) when there is no active editor.
 */
export function insertLinkForNote(app: App, notePath: string): boolean {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) return false;

    const sourcePath = view.file?.path ?? "";
    const wikilink = resolveWikilink(app, notePath, sourcePath);
    if (!wikilink) return false;

    view.editor.replaceSelection(`${wikilink} `);
    return true;
}

export interface SearchKeyEvent {
    key: string;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    preventDefault: () => void;
}

export interface SearchKeyContext {
    resultCount: number;
    moveSelection: (delta: number) => void;
    open: (newTab: boolean) => void;
    insertLink: () => void;
    createNote: () => void;
    close: () => void;
}

export function handleSemanticSearchKey(e: SearchKeyEvent, ctx: SearchKeyContext): void {
    switch (e.key) {
        case "ArrowDown":
            e.preventDefault();
            ctx.moveSelection(1);
            break;
        case "ArrowUp":
            e.preventDefault();
            ctx.moveSelection(-1);
            break;
        case "Enter":
            e.preventDefault();
            if (e.shiftKey) {
                ctx.createNote();
                break;
            }
            if (ctx.resultCount > 0) {
                if (e.altKey) {
                    ctx.insertLink();
                } else {
                    ctx.open(e.metaKey || e.ctrlKey);
                }
            }
            break;
        case "Escape":
            e.preventDefault();
            ctx.close();
            break;
    }
}

import type { App, MarkdownView } from "obsidian";
import { MarkdownView as MarkdownViewClass } from "obsidian";

/**
 * Creates a mock MarkdownView that tracks the currently active file.
 * This is useful for components that need a MarkdownView interface
 * but should always reflect the current active file.
 */
export function createActiveFileMockView(app: App): MarkdownView {
    return {
        get file() {
            const activeView = app.workspace.getActiveViewOfType(MarkdownViewClass);
            return activeView?.file || null;
        },
        app: app,
    } as MarkdownView;
}
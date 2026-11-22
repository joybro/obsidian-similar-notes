import type { App, MarkdownView, Workspace } from "obsidian";
import { MarkdownView as MarkdownViewClass } from "obsidian";

/**
 * The markdown editor the user is working in: the active markdown view, or
 * else the most recently used leaf in the main area when that is a markdown
 * view. The fallback matters for anything triggered from the sidebar: a click
 * inside a sidebar leaf makes that leaf active (Obsidian sets the active leaf
 * on pointerdown and focusin), while the note the user was writing in stays
 * open, with its cursor, in the main area.
 */
export function getTargetMarkdownView(workspace: Workspace): MarkdownView | null {
    const active = workspace.getActiveViewOfType(MarkdownViewClass);
    if (active) return active;
    const recent = workspace.getMostRecentLeaf()?.view;
    return recent instanceof MarkdownViewClass ? recent : null;
}

/**
 * Creates a mock MarkdownView that tracks the note of the target editor
 * (see getTargetMarkdownView), so a sidebar view keeps following the note
 * even while the sidebar itself has focus.
 */
export function createActiveFileMockView(app: App): MarkdownView {
    return {
        get file() {
            return getTargetMarkdownView(app.workspace)?.file || null;
        },
        app: app,
    } as MarkdownView;
}

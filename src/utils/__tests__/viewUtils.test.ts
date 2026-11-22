import { describe, expect, it, vi } from "vitest";
import { MarkdownView } from "obsidian";
import { createActiveFileMockView, getTargetMarkdownView } from "../viewUtils";

function markdownView(path: string) {
    return Object.assign(new MarkdownView(), { file: { path } });
}

function makeApp(active: unknown, recentView: unknown) {
    return {
        workspace: {
            getActiveViewOfType: vi.fn(() => active),
            getMostRecentLeaf: vi.fn(() => (recentView ? { view: recentView } : null)),
        },
    } as never;
}

describe("getTargetMarkdownView", () => {
    it("returns the active markdown view", () => {
        const active = markdownView("a.md");
        expect(getTargetMarkdownView(makeApp(active, markdownView("b.md")))).toBe(active);
    });

    it("falls back to the most recent main-area markdown view when a sidebar leaf is active", () => {
        const recent = markdownView("b.md");
        expect(getTargetMarkdownView(makeApp(null, recent))).toBe(recent);
    });

    it("returns null when the most recent main-area leaf is not a markdown view", () => {
        expect(getTargetMarkdownView(makeApp(null, { file: { path: "c.canvas" } }))).toBeNull();
        expect(getTargetMarkdownView(makeApp(null, null))).toBeNull();
    });
});

describe("createActiveFileMockView", () => {
    it("reports the note of the most recent editor while the sidebar itself is active", () => {
        const mock = createActiveFileMockView(makeApp(null, markdownView("b.md")));
        expect(mock.file).toEqual({ path: "b.md" });
    });
});

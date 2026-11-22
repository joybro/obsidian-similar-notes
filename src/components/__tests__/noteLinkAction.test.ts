import { describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile } from "obsidian";
import { appendNoteLink } from "../noteLinkAction";

function editorView(file: TFile) {
    const replaceRange = vi.fn();
    const view = Object.assign(new MarkdownView(), {
        file,
        getMode: () => "source",
        editor: { lastLine: () => 0, getLine: () => "body", replaceRange },
    });
    return { view, replaceRange };
}

function makeApp(active: unknown, recentView: unknown) {
    const process = vi.fn(async () => undefined);
    const workspace = {
        getActiveViewOfType: vi.fn(() => active),
        getMostRecentLeaf: vi.fn(() => (recentView ? { view: recentView } : null)),
    };
    const app = {
        workspace,
        vault: { process },
        fileManager: { generateMarkdownLink: vi.fn(() => "[[Target]]") },
    };
    return { app: app as never, workspace: workspace as never, process };
}

describe("appendNoteLink from the sidebar (no preferred view)", () => {
    it("writes through the note's editor even though the sidebar leaf is active", async () => {
        const source = new TFile("src.md");
        const { view, replaceRange } = editorView(source);
        const { app, workspace, process } = makeApp(null, view);

        await appendNoteLink(app, workspace, null, source, new TFile("Target.md"));

        expect(replaceRange).toHaveBeenCalledWith("\n[[Target]]\n", { line: 0, ch: 4 });
        expect(process).not.toHaveBeenCalled();
    });

    it("rewrites the file when no editor shows the source note", async () => {
        const source = new TFile("src.md");
        const { app, workspace, process } = makeApp(null, null);

        await appendNoteLink(app, workspace, null, source, new TFile("Target.md"));

        expect(process).toHaveBeenCalled();
    });
});

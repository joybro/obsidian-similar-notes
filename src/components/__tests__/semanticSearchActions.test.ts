import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
    MarkdownView: class MarkdownView {},
    Notice: vi.fn(),
    TFile: class TFile {
        path: string;
        basename: string;
        constructor(path = "") {
            this.path = path;
            this.basename = path.replace(/\.md$/, "");
        }
    },
}));

import { MarkdownView, TFile } from "obsidian";
import {
    sanitizeFileName,
    createNoteFromQuery,
    insertLinkForNote,
    resolveWikilink,
    handleSemanticSearchKey,
    type SearchKeyContext,
} from "../semanticSearchActions";

describe("sanitizeFileName (spec item 2)", () => {
    it("replaces filesystem/Obsidian-illegal characters with spaces and collapses them", () => {
        expect(sanitizeFileName('a/b:c*d?"e<f>g|h')).toBe("a b c d e f g h");
    });

    it("trims and collapses surrounding/duplicate whitespace", () => {
        expect(sanitizeFileName("  hello   world  ")).toBe("hello world");
    });

    it("returns an empty string for whitespace-only or illegal-only input", () => {
        expect(sanitizeFileName("   ")).toBe("");
        expect(sanitizeFileName("///")).toBe("");
    });
});

function makeApp(overrides = {}) {
    return {
        workspace: {
            getActiveFile: vi.fn(() => new TFile("src.md")),
            openLinkText: vi.fn(),
        },
        vault: {
            getAbstractFileByPath: vi.fn(() => null),
            create: vi.fn(async (path: string) => new TFile(path)),
        },
        fileManager: {
            getNewFileParent: vi.fn(() => ({ path: "Notes" })),
        },
        ...overrides,
    } as never;
}

describe("createNoteFromQuery (spec item 2)", () => {
    it("creates a note named after the sanitized query in the default new-note folder and opens it", async () => {
        const app = makeApp();
        const created = await createNoteFromQuery(app, "my new idea");

        expect(created).toBe(true);
        expect(
            (app as never as { vault: { create: ReturnType<typeof vi.fn> } }).vault.create
        ).toHaveBeenCalledWith("Notes/my new idea.md", "");
        expect(
            (app as never as { workspace: { openLinkText: ReturnType<typeof vi.fn> } }).workspace
                .openLinkText
        ).toHaveBeenCalledWith("Notes/my new idea.md", "src.md", false);
    });

    it("is a no-op for an empty/illegal-only query", async () => {
        const app = makeApp();
        const created = await createNoteFromQuery(app, "   ");

        expect(created).toBe(false);
        expect(
            (app as never as { vault: { create: ReturnType<typeof vi.fn> } }).vault.create
        ).not.toHaveBeenCalled();
    });

    it("opens the existing note instead of creating a duplicate", async () => {
        const app = makeApp({
            vault: {
                getAbstractFileByPath: vi.fn(() => new TFile("Notes/dup.md")),
                create: vi.fn(),
            },
        });
        const created = await createNoteFromQuery(app, "dup");

        expect(created).toBe(true);
        expect(
            (app as never as { vault: { create: ReturnType<typeof vi.fn> } }).vault.create
        ).not.toHaveBeenCalled();
        expect(
            (app as never as { workspace: { openLinkText: ReturnType<typeof vi.fn> } }).workspace
                .openLinkText
        ).toHaveBeenCalledWith("Notes/dup.md", "src.md", false);
    });
});

function makeEditorApp(view: unknown) {
    return {
        workspace: { getActiveViewOfType: vi.fn(() => view) },
        vault: { getAbstractFileByPath: vi.fn((p: string) => new TFile(p)) },
        metadataCache: { fileToLinktext: vi.fn(() => "Target") },
    } as never;
}

describe("insertLinkForNote (spec item 3)", () => {
    it("inserts [[link]] with a trailing space at the cursor and returns true", () => {
        const replaceSelection = vi.fn();
        const app = makeEditorApp({ editor: { replaceSelection }, file: { path: "src.md" } });

        const inserted = insertLinkForNote(app, "Target.md");

        expect(inserted).toBe(true);
        expect(replaceSelection).toHaveBeenCalledWith("[[Target]] ");
    });

    it("returns false when there is no active markdown editor", () => {
        const app = makeEditorApp(null);
        expect(insertLinkForNote(app, "Target.md")).toBe(false);
    });
});

// Keep MarkdownView import referenced (the helper passes it to getActiveViewOfType).
void MarkdownView;

function makeCtx(overrides: Partial<SearchKeyContext> = {}): SearchKeyContext {
    return {
        resultCount: 1,
        moveSelection: vi.fn(),
        open: vi.fn(),
        insertLink: vi.fn(),
        createNote: vi.fn(),
        close: vi.fn(),
        ...overrides,
    };
}

function keyEvent(
    key: string,
    mods: Partial<{ shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}
) {
    return {
        key,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault: vi.fn(),
        ...mods,
    };
}

describe("handleSemanticSearchKey (spec item 1)", () => {
    it("maps Shift+Enter to createNote (even with no results)", () => {
        const ctx = makeCtx({ resultCount: 0 });
        handleSemanticSearchKey(keyEvent("Enter", { shiftKey: true }), ctx);
        expect(ctx.createNote).toHaveBeenCalledTimes(1);
        expect(ctx.open).not.toHaveBeenCalled();
    });

    it("maps Alt+Enter to insertLink when there are results", () => {
        const ctx = makeCtx();
        handleSemanticSearchKey(keyEvent("Enter", { altKey: true }), ctx);
        expect(ctx.insertLink).toHaveBeenCalledTimes(1);
        expect(ctx.open).not.toHaveBeenCalled();
    });

    it("maps plain Enter to open and Mod+Enter to open-in-new-tab", () => {
        const ctx = makeCtx();
        handleSemanticSearchKey(keyEvent("Enter"), ctx);
        expect(ctx.open).toHaveBeenCalledWith(false);

        handleSemanticSearchKey(keyEvent("Enter", { metaKey: true }), ctx);
        expect(ctx.open).toHaveBeenLastCalledWith(true);
    });

    it("does not open or insert when there are no results", () => {
        const ctx = makeCtx({ resultCount: 0 });
        handleSemanticSearchKey(keyEvent("Enter", { altKey: true }), ctx);
        handleSemanticSearchKey(keyEvent("Enter"), ctx);
        expect(ctx.insertLink).not.toHaveBeenCalled();
        expect(ctx.open).not.toHaveBeenCalled();
    });

    it("maps arrows to moveSelection and Escape to close", () => {
        const ctx = makeCtx();
        handleSemanticSearchKey(keyEvent("ArrowDown"), ctx);
        expect(ctx.moveSelection).toHaveBeenCalledWith(1);
        handleSemanticSearchKey(keyEvent("ArrowUp"), ctx);
        expect(ctx.moveSelection).toHaveBeenCalledWith(-1);
        handleSemanticSearchKey(keyEvent("Escape"), ctx);
        expect(ctx.close).toHaveBeenCalledTimes(1);
    });
});

describe("resolveWikilink (spec item: shared linktext helper)", () => {
    function appFor(file: unknown) {
        return {
            vault: { getAbstractFileByPath: vi.fn(() => file) },
            metadataCache: { fileToLinktext: vi.fn(() => "Target") },
        } as never;
    }

    it("returns a [[linktext]] string for an existing file", () => {
        expect(resolveWikilink(appFor(new TFile("Target.md")), "Target.md", "src.md")).toBe(
            "[[Target]]"
        );
    });

    it("returns null when the path is not a TFile", () => {
        expect(resolveWikilink(appFor(null), "missing.md", "src.md")).toBeNull();
    });
});

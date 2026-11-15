import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MarkdownView, TFile, Workspace } from "obsidian";
import { BehaviorSubject } from "rxjs";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Helper function to create mock TFile objects
const createMockTFile = (path: string): TFile => ({
    path,
    name: path.split('/').pop() || '',
    extension: path.split('.').pop() || '',
    basename: path.split('/').pop()?.split('.')[0] || '',
    stat: { 
        mtime: Date.now(), 
        ctime: Date.now(), 
        size: 100 
    },
    vault: {} as any,
    parent: {} as any
});
import NoteBottomViewReact from "../NoteBottomViewReact";

// Vitest will automatically use the mock from src/__mocks__/obsidian.ts
vi.mock("obsidian");

// Define the SimilarNote type to match what your component expects
interface SimilarNote {
    file: TFile;
    title: string;
    preview: string;
    similarity: number;
}

describe("SimilarNotesViewReact", () => {
    let mockWorkspace: Partial<Workspace>;
    let mockLeaf: MarkdownView;
    let mockOpenLinkText: (
        linktext: string,
        sourcePath: string,
        newLeaf?: boolean
    ) => Promise<void>;
    let bottomViewModelSubject$: BehaviorSubject<{
        currentFile: TFile;
        similarNoteEntries: SimilarNote[];
        noteDisplayMode: "title" | "path" | "smart";
    }>;
    let currentFile: TFile;

    beforeEach(() => {
        // Obsidian's openLinkText returns a Promise; the view chains .catch on it.
        mockOpenLinkText = vi.fn().mockResolvedValue(undefined);
        mockLeaf = {
            file: undefined,
        } as unknown as MarkdownView;
        mockWorkspace = {
            getLeaf: vi.fn().mockReturnValue(mockLeaf),
            openLinkText: mockOpenLinkText,
            trigger: vi.fn(),
        };
        currentFile = createMockTFile("current-file.md");
        bottomViewModelSubject$ = new BehaviorSubject({
            currentFile,
            similarNoteEntries: [
                {
                    file: createMockTFile("similar1.md"),
                    title: "Similar Note 1",
                    preview: "Preview of Similar Note 1",
                    similarity: 0.95,
                },
                {
                    file: createMockTFile("similar2.md"),
                    title: "Similar Note 2",
                    preview: "Preview of Similar Note 2",
                    similarity: 0.85,
                },
            ],
            noteDisplayMode: "title",
        });
        mockLeaf.file = currentFile;
    });

    test("renders header with correct text", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );

        expect(screen.getByText("Similar notes")).toBeInTheDocument();
        expect(await screen.findByText("Similar Note 1")).toBeInTheDocument();
    });

    test("renders similar notes when provided", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );

        expect(await screen.findByText("Similar Note 1")).toBeInTheDocument();
        expect(await screen.findByText("Similar Note 2")).toBeInTheDocument();
        expect(await screen.findByText("0.95")).toBeInTheDocument();
        expect(await screen.findByText("0.85")).toBeInTheDocument();
    });

    test("hides content when collapsed", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );

        await screen.findByText("Similar Note 1");
        fireEvent.click(screen.getByText("Similar notes"));
        expect(screen.queryByText("Similar Note 1")).not.toBeInTheDocument();
    });

    test("shows empty state when no similar notes", async () => {
        bottomViewModelSubject$.next({
            currentFile,
            similarNoteEntries: [],
            noteDisplayMode: "title",
        });
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );
        // 클래스 이름으로 빈 상태 요소를 찾음
        await waitFor(() => {
            const emptyStateEl = screen.getByText("No similar notes found.");
            expect(emptyStateEl).toBeInTheDocument();
        });
    });

    test.each([
        [{ kind: "unwritten" }, "Write a few lines and similar notes will appear here."],
        [
            { kind: "excluded-cloud", provider: "OpenAI" },
            "This note is excluded from the index, so it isn't sent to OpenAI.",
        ],
        [
            { kind: "embedding-failed" },
            "Couldn't analyze this note. Check the model in Settings, then reopen the note.",
        ],
        [
            { kind: "below-threshold", threshold: 0.5 },
            "No notes above the minimum similarity (0.50).",
        ],
        [
            { kind: "indexing", remaining: 1240 },
            "Indexing your vault: 1,240 notes left. Results fill in as notes are indexed.",
        ],
        [
            { kind: "indexing", remaining: 1 },
            "Indexing your vault: 1 note left. Results fill in as notes are indexed.",
        ],
        [{ kind: "none" }, "No similar notes found."],
    ] as const)("empty panel says why: %o", async (emptyReason, text) => {
        bottomViewModelSubject$.next({
            currentFile,
            similarNoteEntries: [],
            emptyReason,
            noteDisplayMode: "title",
            sidebarResultCount: 10,
            bottomResultCount: 5,
        });
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );
        const el = await screen.findByText(text);
        expect(el).toBeInTheDocument();
        // Only the confirmed failure is styled as an error
        expect(el.classList.contains("is-error")).toBe(emptyReason.kind === "embedding-failed");
    });

    test("calls openFile when note is clicked", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );
        const noteElement = await screen.findByText("Similar Note 1");
        fireEvent.click(noteElement);
        expect(mockOpenLinkText).toHaveBeenCalledWith("similar1.md", "", false);
    });

    test("emits hover-link for Page Preview when a note row is hovered (issue #55)", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );
        const noteElement = await screen.findByText("Similar Note 1");
        fireEvent.mouseOver(noteElement);
        expect(mockWorkspace.trigger).toHaveBeenCalledWith(
            "hover-link",
            expect.objectContaining({
                source: "similar-notes",
                linktext: "similar1.md",
                hoverParent: expect.objectContaining({ hoverPopover: null }),
                targetEl: expect.any(HTMLElement),
            })
        );
    });

    const renderLinkAction = (viewType: "sidebar" | "bottom") => render(
        <NoteBottomViewReact
            workspace={mockWorkspace as Workspace}
            leaf={mockLeaf}
            bottomViewModelSubject$={bottomViewModelSubject$}
            vaultName="test-vault"
            viewType={viewType}
        />
    );
    const linkButton = () => screen.findByRole("button", { name: "Add link to Similar Note 1" });

    test.each(["sidebar", "bottom"] as const)("links from the %s editor without opening the result", async (viewType) => {
        const editor = {
            lastLine: () => 1,
            getLine: () => "Unsaved text",
            replaceRange: vi.fn(),
        };
        const generateMarkdownLink = vi.fn(() => "[Target](folder/Target.md)");
        const activeView = { file: currentFile, getMode: () => "source", editor };
        Object.assign(mockLeaf, { app: { fileManager: { generateMarkdownLink } }, ...activeView });
        mockWorkspace.getActiveViewOfType = vi.fn().mockReturnValue(activeView);
        renderLinkAction(viewType);

        fireEvent.click(await linkButton());
        expect(generateMarkdownLink).toHaveBeenCalledWith(bottomViewModelSubject$.value.similarNoteEntries[0].file, currentFile.path);
        expect(editor.replaceRange).toHaveBeenCalledWith("\n[Target](folder/Target.md)\n", { line: 1, ch: 12 });
        expect(mockOpenLinkText).not.toHaveBeenCalled();
        expect(screen.getByLabelText("Already linked")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Add link to Similar Note 1" })).not.toBeInTheDocument();
    });

    test("appends atomically in reading mode and prevents duplicate clicks while saving", async () => {
        let finish: (() => void) | undefined;
        const process = vi.fn((_file, update: (content: string) => string) => {
            expect(update("Existing\n")).toBe("Existing\n[[similar1]]\n");
            expect(update("Existing")).toBe("Existing\n[[similar1]]\n");
            expect(update("")).toBe("[[similar1]]\n");
            return new Promise<void>((resolve) => { finish = resolve; });
        });
        Object.assign(mockLeaf, {
            app: {
                fileManager: { generateMarkdownLink: () => "[[similar1]]" },
                vault: { process },
            },
            getMode: () => "preview",
        });
        renderLinkAction("bottom");
        const button = await linkButton();
        fireEvent.click(button);
        fireEvent.click(button);
        expect(process).toHaveBeenCalledTimes(1);
        expect(process).toHaveBeenCalledWith(currentFile, expect.any(Function));
        await act(async () => { finish?.(); });
        expect(screen.getByLabelText("Already linked")).toBeInTheDocument();
    });

    test("does not add a link to a different note when the displayed results are stale", async () => {
        const generateMarkdownLink = vi.fn();
        Object.assign(mockLeaf, { app: { fileManager: { generateMarkdownLink } } });
        renderLinkAction("bottom");
        const button = await linkButton();
        mockLeaf.file = createMockTFile("other.md");
        fireEvent.click(button);
        expect(generateMarkdownLink).not.toHaveBeenCalled();
    });
});

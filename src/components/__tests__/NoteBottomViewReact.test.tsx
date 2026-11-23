import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
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
            { kind: "model-download-failed" },
            "Couldn't download the model. Check your connection, then reopen the note.",
        ],
        [
            { kind: "model-load-failed" },
            "Couldn't load the model. Check the model in Settings.",
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
        // Only the confirmed failures are styled as an error
        expect(el.classList.contains("is-error")).toBe(
            ["embedding-failed", "model-download-failed", "model-load-failed"].includes(
                emptyReason.kind
            )
        );
    });

    test("before the first result for its note arrives the panel says it is looking", async () => {
        // The latest model is for another note (or the coordinator's initial
        // value at startup), so this view has nothing to show yet.
        mockLeaf.file = createMockTFile("just-opened.md");
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="sidebar"
            />
        );

        expect(screen.getByText("Looking for similar notes…")).toBeInTheDocument();
        expect(screen.queryByText("No similar notes found.")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Expand all")).not.toBeInTheDocument();

        // The search for this note comes back empty: now "none found" is true.
        (bottomViewModelSubject$ as BehaviorSubject<unknown>).next({
            currentFile: mockLeaf.file,
            similarNoteEntries: [],
            emptyReason: { kind: "none" },
            noteDisplayMode: "title",
            sidebarResultCount: 10,
            bottomResultCount: 5,
        });
        expect(await screen.findByText("No similar notes found.")).toBeInTheDocument();
        expect(screen.queryByText("Looking for similar notes…")).not.toBeInTheDocument();
    });

    test("분할 창의 검색하지 않은 아래 패널은 상태를 꾸며 내지 않는다", () => {
        const passiveFile = createMockTFile("passive.md");
        const passiveLeaf = { file: passiveFile } as MarkdownView;
        const view = render(
            <NoteBottomViewReact
                workspace={mockWorkspace as Workspace}
                leaf={passiveLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );

        expect(screen.getByText("Similar notes")).toBeInTheDocument();
        expect(view.container.querySelector(".search-empty-state")).toBeNull();
        expect(screen.queryByText("Similar Note 1")).not.toBeInTheDocument();

        act(() => {
            (bottomViewModelSubject$ as BehaviorSubject<unknown>).next({
                currentFile: passiveFile,
                similarNoteEntries: [],
                emptyReason: { kind: "loading" },
                noteDisplayMode: "title",
                sidebarResultCount: 10,
                bottomResultCount: 5,
            });
        });
        expect(screen.getByText("Looking for similar notes…")).toBeInTheDocument();

        act(() => {
            (bottomViewModelSubject$ as BehaviorSubject<unknown>).next({
                currentFile: passiveFile,
                similarNoteEntries: [],
                emptyReason: { kind: "none" },
                noteDisplayMode: "title",
                sidebarResultCount: 10,
                bottomResultCount: 5,
            });
        });
        expect(screen.getByText("No similar notes found.")).toBeInTheDocument();
    });

    test("sidebar with no note to follow drops the results and says to open a note", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="sidebar"
            />
        );
        await screen.findByText("Similar Note 1");

        // The last note is closed (or a canvas/PDF tab becomes the most
        // recent one): the followed view has no file and the coordinator
        // emits an empty model.
        (mockLeaf as { file: TFile | null }).file = null;
        (bottomViewModelSubject$ as BehaviorSubject<unknown>).next({
            currentFile: null,
            similarNoteEntries: [],
            emptyReason: { kind: "no-note" },
            noteDisplayMode: "title",
            sidebarResultCount: 10,
            bottomResultCount: 5,
        });

        expect(
            await screen.findByText("Open a note and similar notes will appear here.")
        ).toBeInTheDocument();
        expect(screen.queryByText("Similar Note 1")).not.toBeInTheDocument();
        expect(screen.queryByText("No similar notes found.")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Expand all")).not.toBeInTheDocument();
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
});

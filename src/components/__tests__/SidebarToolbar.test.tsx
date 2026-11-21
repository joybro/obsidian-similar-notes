import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import type { MarkdownView, TFile, Workspace } from "obsidian";
import { BehaviorSubject } from "rxjs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import NoteBottomViewReact, {
    type NoteBottomViewModel,
    type SimilarNoteEntry,
    type ViewType,
} from "../NoteBottomViewReact";
import {
    readExpandAll,
    SIDEBAR_EXPAND_ALL_KEY,
    withExpandAll,
} from "../sidebarViewState";

const file = (path: string): TFile =>
    ({
        path,
        name: path,
        basename: path.replace(/\.md$/, ""),
        extension: "md",
    }) as unknown as TFile;

const entry = (path: string, similarity = 0.9): SimilarNoteEntry => ({
    file: file(path),
    title: path.replace(/\.md$/, ""),
    similarity,
    preview: `Preview of ${path}`,
    isLinked: false,
});

const model = (
    current: TFile,
    entries: SimilarNoteEntry[]
): NoteBottomViewModel => ({
    currentFile: current,
    similarNoteEntries: entries,
    noteDisplayMode: "title",
    sidebarResultCount: 10,
    bottomResultCount: 10,
});

const row = (title: string) => {
    const el = screen.getByText(title).closest(".search-result");
    if (!el) throw new Error(`no row for ${title}`);
    return el as HTMLElement;
};
const isExpanded = (title: string) =>
    !row(title).classList.contains("is-collapsed");
const rowChevron = (title: string) => {
    const el = row(title).querySelector(".collapse-icon");
    if (!el) throw new Error(`no chevron for ${title}`);
    return el as HTMLElement;
};
const expandButton = () =>
    screen.queryByRole("button", { name: /^(Expand|Collapse) all$/ });

describe("Sidebar toolbar", () => {
    let leaf: { file: TFile | null };
    let subject$: BehaviorSubject<NoteBottomViewModel>;
    let workspace: Partial<Workspace>;
    const noteA = file("note-a.md");
    const noteB = file("note-b.md");

    beforeEach(() => {
        leaf = { file: noteA };
        workspace = {
            openLinkText: vi.fn().mockResolvedValue(undefined),
            trigger: vi.fn(),
        };
        subject$ = new BehaviorSubject(
            model(noteA, [entry("alpha.md"), entry("beta.md"), entry("gamma.md")])
        );
    });

    const renderView = (
        viewType: ViewType,
        onOpenSemanticSearch?: (onDismissed: () => void) => void
    ) =>
        render(
            <NoteBottomViewReact
                workspace={workspace as Workspace}
                vaultName="v"
                leaf={leaf as unknown as MarkdownView}
                bottomViewModelSubject$={subject$}
                viewType={viewType}
                onOpenSemanticSearch={onOpenSemanticSearch}
            />
        );

    test("sidebar shows the two buttons; the in-document panel does not", () => {
        const { unmount } = renderView("sidebar", vi.fn());
        expect(expandButton()).toHaveAttribute("aria-label", "Expand all");
        expect(expandButton()).toHaveAttribute("data-icon", "chevrons-up-down");
        const search = screen.getByRole("button", { name: "Semantic search…" });
        expect(search).toHaveAttribute("data-icon", "text-search");
        expect(search).toHaveClass("clickable-icon", "nav-action-button");
        expect(search.closest(".nav-buttons-container")).not.toBeNull();
        unmount();

        renderView("bottom");
        expect(expandButton()).toBeNull();
        expect(
            screen.queryByRole("button", { name: "Semantic search…" })
        ).toBeNull();
    });

    test("rows start collapsed, as before", () => {
        renderView("sidebar", vi.fn());
        expect(isExpanded("alpha")).toBe(false);
        expect(isExpanded("beta")).toBe(false);
    });

    test("expand all, per-row override kept by path across refresh, reset on note switch, collapse all", () => {
        renderView("sidebar", vi.fn());

        fireEvent.click(expandButton()!);
        expect(isExpanded("alpha")).toBe(true);
        expect(isExpanded("beta")).toBe(true);
        expect(isExpanded("gamma")).toBe(true);
        expect(expandButton()).toHaveAttribute("aria-label", "Collapse all");
        expect(expandButton()).toHaveAttribute("data-icon", "chevrons-down-up");
        expect(expandButton()).not.toHaveClass("is-active");

        // Per-row collapse
        fireEvent.click(rowChevron("beta"));
        expect(isExpanded("beta")).toBe(false);
        expect(isExpanded("alpha")).toBe(true);

        // Same source note refreshes with a new order: override follows the path
        act(() => {
            subject$.next(
                model(noteA, [entry("beta.md"), entry("gamma.md"), entry("alpha.md"), entry("delta.md")])
            );
        });
        expect(isExpanded("beta")).toBe(false);
        expect(isExpanded("alpha")).toBe(true);
        expect(isExpanded("gamma")).toBe(true);
        expect(isExpanded("delta")).toBe(true);
        // One row still open, so the button offers to collapse
        expect(expandButton()).toHaveAttribute("aria-label", "Collapse all");

        // Switch the active note: overrides reset, the all-expanded mode stays
        leaf.file = noteB;
        act(() => {
            subject$.next(model(noteB, [entry("beta.md"), entry("epsilon.md")]));
        });
        expect(isExpanded("beta")).toBe(true);
        expect(isExpanded("epsilon")).toBe(true);

        // Collapse all
        fireEvent.click(expandButton()!);
        expect(isExpanded("beta")).toBe(false);
        expect(isExpanded("epsilon")).toBe(false);
        expect(expandButton()).toHaveAttribute("aria-label", "Expand all");

        // Collapsed mode also survives a note switch
        leaf.file = noteA;
        act(() => {
            subject$.next(model(noteA, [entry("alpha.md")]));
        });
        expect(isExpanded("alpha")).toBe(false);
    });

    test("expanding one row by hand flips the button to Collapse all", () => {
        renderView("sidebar", vi.fn());
        fireEvent.click(rowChevron("gamma"));
        expect(isExpanded("gamma")).toBe(true);
        expect(expandButton()).toHaveAttribute("aria-label", "Collapse all");
        fireEvent.click(expandButton()!);
        expect(isExpanded("gamma")).toBe(false);
    });

    test("expand button is hidden with 0 results; search stays", () => {
        subject$.next(model(noteA, []));
        renderView("sidebar", vi.fn());
        expect(expandButton()).toBeNull();
        expect(
            screen.getByRole("button", { name: "Semantic search…" })
        ).toBeInTheDocument();
    });

    test("buttons respond to Enter and Space", () => {
        renderView("sidebar", vi.fn());
        fireEvent.keyDown(expandButton()!, { key: "Enter" });
        expect(isExpanded("alpha")).toBe(true);
        fireEvent.keyDown(expandButton()!, { key: " " });
        expect(isExpanded("alpha")).toBe(false);
    });

    test("search button opens the search modal by mouse, Enter and Space, and gets focus back when dismissed", () => {
        const open = vi.fn();
        renderView("sidebar", open);
        const search = screen.getByRole("button", { name: "Semantic search…" });

        fireEvent.click(search);
        fireEvent.keyDown(search, { key: "Enter" });
        fireEvent.keyDown(search, { key: " " });
        expect(open).toHaveBeenCalledTimes(3);

        search.blur();
        expect(document.activeElement).not.toBe(search);
        const onDismissed = open.mock.calls[0][0] as () => void;
        act(() => onDismissed());
        expect(document.activeElement).toBe(search);
    });

    describe("saved expand-all mode (sidebar view state)", () => {
        /**
         * Stands in for the sidebar view: it owns the mode, re-renders the
         * component with it, and counts layout saves like
         * workspace.requestSaveLayout().
         */
        const renderSaved = (initial: boolean) => {
            const view = { expandAll: initial, saves: 0 };
            const element = () => (
                <NoteBottomViewReact
                    workspace={workspace as Workspace}
                    vaultName="v"
                    leaf={leaf as unknown as MarkdownView}
                    bottomViewModelSubject$={subject$}
                    viewType="sidebar"
                    onOpenSemanticSearch={vi.fn()}
                    savedExpandMode={{
                        expandAll: view.expandAll,
                        onExpandAllChange: (expandAll) => {
                            view.expandAll = expandAll;
                            view.saves++;
                            result.rerender(element());
                        },
                    }}
                />
            );
            const result = render(element());
            return view;
        };

        test("a saved expanded mode opens with every row expanded and is not saved again", () => {
            const view = renderSaved(true);
            expect(isExpanded("alpha")).toBe(true);
            expect(isExpanded("gamma")).toBe(true);
            expect(expandButton()).toHaveAttribute("aria-label", "Collapse all");
            expect(view.saves).toBe(0);
        });

        test("no saved mode opens collapsed, as before", () => {
            const view = renderSaved(false);
            expect(isExpanded("alpha")).toBe(false);
            expect(expandButton()).toHaveAttribute("aria-label", "Expand all");
            expect(view.saves).toBe(0);
        });

        test("only Expand all / Collapse all save; note switches and row chevrons do not", () => {
            const view = renderSaved(false);

            fireEvent.click(expandButton()!);
            expect(view).toEqual({ expandAll: true, saves: 1 });
            expect(isExpanded("alpha")).toBe(true);

            // A row's own chevron is an override, not saved
            fireEvent.click(rowChevron("beta"));
            expect(isExpanded("beta")).toBe(false);
            expect(view.saves).toBe(1);

            // Switching the active note keeps the saved mode without saving
            leaf.file = noteB;
            act(() => {
                subject$.next(model(noteB, [entry("delta.md"), entry("beta.md")]));
            });
            expect(isExpanded("delta")).toBe(true);
            expect(isExpanded("beta")).toBe(true);
            expect(view.saves).toBe(1);

            fireEvent.click(expandButton()!);
            expect(view).toEqual({ expandAll: false, saves: 2 });
            expect(isExpanded("delta")).toBe(false);
            expect(isExpanded("beta")).toBe(false);
        });
    });
});

describe("sidebar view state helpers", () => {
    test("read only a boolean; anything else means no saved mode", () => {
        expect(readExpandAll({ [SIDEBAR_EXPAND_ALL_KEY]: true })).toBe(true);
        expect(readExpandAll({ [SIDEBAR_EXPAND_ALL_KEY]: false })).toBe(false);
        expect(readExpandAll({ [SIDEBAR_EXPAND_ALL_KEY]: "true" })).toBeUndefined();
        expect(readExpandAll({ [SIDEBAR_EXPAND_ALL_KEY]: 1 })).toBeUndefined();
        expect(readExpandAll({})).toBeUndefined();
        expect(readExpandAll(null)).toBeUndefined();
        expect(readExpandAll(undefined)).toBeUndefined();
    });

    test("write keeps the host's state and round-trips", () => {
        const state = withExpandAll({ hostKey: "kept" }, true);
        expect(state).toEqual({ hostKey: "kept", sidebarExpandAll: true });
        expect(readExpandAll(state)).toBe(true);
        expect(readExpandAll(withExpandAll(state, false))).toBe(false);
    });
});

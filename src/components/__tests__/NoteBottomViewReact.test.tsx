/* eslint-disable @typescript-eslint/no-explicit-any */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MarkdownView, TFile, Workspace } from "obsidian";
import { BehaviorSubject } from "rxjs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import NoteBottomViewReact from "../NoteBottomViewReact";

// Vitest will automatically use the mock from src/__mocks__/obsidian.ts
vi.mock("obsidian");

// Define the SimilarNote type to match what your component expects
interface SimilarNote {
    file: TFile;
    title: string;
    similarity: number;
}

describe("SimilarNotesViewReact", () => {
    let mockWorkspace: Partial<Workspace>;
    let mockLeaf: MarkdownView;
    let mockOpenFile: (file: TFile) => void;
    let bottomViewModelSubject$: BehaviorSubject<{
        currentFile: TFile;
        similarNoteEntries: SimilarNote[];
    }>;
    let currentFile: TFile;

    beforeEach(() => {
        mockOpenFile = vi.fn();
        mockLeaf = {
            file: undefined,
            openFile: mockOpenFile,
        } as unknown as MarkdownView;
        mockWorkspace = {
            getLeaf: vi.fn().mockReturnValue(mockLeaf),
        };
        currentFile = { path: "current-file.md" } as TFile;
        bottomViewModelSubject$ = new BehaviorSubject({
            currentFile,
            similarNoteEntries: [
                {
                    file: { path: "similar1.md" } as TFile,
                    title: "Similar Note 1",
                    similarity: 0.95,
                },
                {
                    file: { path: "similar2.md" } as TFile,
                    title: "Similar Note 2",
                    similarity: 0.85,
                },
            ],
        });
        mockLeaf.file = currentFile;
    });

    test("renders header with correct text", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
            />
        );

        expect(screen.getByText("Similar notes")).toBeInTheDocument();
        expect(await screen.findByText("Similar Note 1")).toBeInTheDocument();
    });

    test("renders similar notes when provided", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
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
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
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
        });
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
            />
        );
        expect(
            await screen.findByText("No similar notes found")
        ).toBeInTheDocument();
    });

    test("calls openFile when note is clicked", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
            />
        );
        const noteElement = await screen.findByText("Similar Note 1");
        fireEvent.click(noteElement);
        expect(mockOpenFile).toHaveBeenCalledWith({ path: "similar1.md" });
    });
});

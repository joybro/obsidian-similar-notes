import { jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App, TFile } from "obsidian";
import React from "react";
import SimilarNotesViewReact from "../SimilarNotesViewReact";

// Jest will automatically use the mock from src/__mocks__/obsidian.ts
jest.mock("obsidian");

// Define the SimilarNote type to match what your component expects
interface SimilarNote {
    file: TFile;
    title: string;
    similarity: number;
}

describe("SimilarNotesViewReact", () => {
    let mockApp: App;
    let mockCurrentFile: TFile;
    const mockGetSimilarNotes = jest.fn() as jest.MockedFunction<
        (file: TFile) => Promise<SimilarNote[]>
    >;

    beforeEach(() => {
        mockApp = {
            workspace: {
                getLeaf: jest.fn().mockReturnValue({
                    openFile: jest.fn(),
                }),
            },
        } as unknown as App;

        mockCurrentFile = { path: "current-file.md" } as TFile;
        mockGetSimilarNotes.mockResolvedValue([
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
        ]);
    });

    test("renders header with correct text", async () => {
        render(
            <SimilarNotesViewReact
                app={mockApp}
                currentFile={mockCurrentFile}
                getSimilarNotes={mockGetSimilarNotes}
            />
        );

        expect(screen.getByText("Similar notes")).toBeInTheDocument();
        expect(await screen.findByText("Similar Note 1")).toBeInTheDocument();
    });

    test("renders similar notes when provided", async () => {
        render(
            <SimilarNotesViewReact
                app={mockApp}
                currentFile={mockCurrentFile}
                getSimilarNotes={mockGetSimilarNotes}
            />
        );

        // Wait for async calls to complete
        expect(await screen.findByText("Similar Note 1")).toBeInTheDocument();
        expect(await screen.findByText("Similar Note 2")).toBeInTheDocument();
        expect(await screen.findByText("0.95")).toBeInTheDocument();
        expect(await screen.findByText("0.85")).toBeInTheDocument();
    });

    test("hides content when collapsed", async () => {
        render(
            <SimilarNotesViewReact
                app={mockApp}
                currentFile={mockCurrentFile}
                getSimilarNotes={mockGetSimilarNotes}
            />
        );

        // Wait for notes to render
        await screen.findByText("Similar Note 1");

        // Click header to collapse
        fireEvent.click(screen.getByText("Similar notes"));

        // Content should be hidden
        expect(screen.queryByText("Similar Note 1")).not.toBeInTheDocument();
    });

    test("shows empty state when no similar notes", async () => {
        mockGetSimilarNotes.mockResolvedValue([]);

        render(
            <SimilarNotesViewReact
                app={mockApp}
                currentFile={mockCurrentFile}
                getSimilarNotes={mockGetSimilarNotes}
            />
        );

        expect(
            await screen.findByText("No similar notes found")
        ).toBeInTheDocument();
    });

    test("calls openFile when note is clicked", async () => {
        render(
            <SimilarNotesViewReact
                app={mockApp}
                currentFile={mockCurrentFile}
                getSimilarNotes={mockGetSimilarNotes}
            />
        );

        // Wait for notes to render
        const noteElement = await screen.findByText("Similar Note 1");

        // Click on the note
        fireEvent.click(noteElement);

        // Expect openFile to have been called
        expect(mockApp.workspace.getLeaf().openFile).toHaveBeenCalled();
    });
});

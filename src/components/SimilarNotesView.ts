import type { App, TFile } from "obsidian";
import { Component } from "obsidian";
import * as React from "react";
import { type Root, createRoot } from "react-dom/client";
import SimilarNotesViewReact from "./SimilarNotesViewReact";

// Interface for similar note items
export interface SimilarNotesViewData {
    file: TFile;
    title: string;
    similarity: number;
}

export class SimilarNotesView extends Component {
    private containerEl: HTMLElement;
    private currentFile: TFile | null = null;
    private root: Root;

    constructor(
        private app: App,
        private parentEl: HTMLElement,
        private getSimilarNotes: (
            file: TFile
        ) => Promise<SimilarNotesViewData[]>
    ) {
        super();
        this.containerEl = parentEl.createDiv({
            cls: "similar-notes-container-wrapper",
        });
        this.root = createRoot(this.containerEl);
        this.render();
    }

    private render(): void {
        this.root.render(
            React.createElement(SimilarNotesViewReact, {
                app: this.app,
                currentFile: this.currentFile,
                getSimilarNotes: this.getSimilarNotes,
            })
        );
    }

    async updateForFile(file: TFile): Promise<void> {
        // Don't update if it's the same file
        if (this.currentFile && this.currentFile.path === file.path) return;

        this.currentFile = file;
        this.render();
    }

    public getContainerEl(): HTMLElement {
        return this.containerEl;
    }

    onunload(): void {
        this.root.unmount();
    }
}

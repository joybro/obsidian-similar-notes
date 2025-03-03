import type { App, TFile } from "obsidian";
import { Component } from "obsidian";
import * as React from "react";
import * as ReactDOM from "react-dom";
import SimilarNotesViewReact from "./components/SimilarNotesViewReact";

// Interface for similar note items
interface SimilarNote {
    file: TFile;
    title: string;
    similarity: number;
}

export class SimilarNotesView extends Component {
    private containerEl: HTMLElement;
    private currentFile: TFile | null = null;

    constructor(
        private app: App,
        private parentEl: HTMLElement,
        private getSimilarNotes: (file: TFile) => Promise<SimilarNote[]>
    ) {
        super();
        this.containerEl = parentEl.createDiv({
            cls: "similar-notes-container-wrapper",
        });
        this.render();
    }

    private render(): void {
        ReactDOM.render(
            React.createElement(SimilarNotesViewReact, {
                app: this.app,
                currentFile: this.currentFile,
                getSimilarNotes: this.getSimilarNotes,
            }),
            this.containerEl
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
        ReactDOM.unmountComponentAtNode(this.containerEl);
    }
}

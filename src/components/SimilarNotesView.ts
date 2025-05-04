import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { Component } from "obsidian";
import * as React from "react";
import { type Root, createRoot } from "react-dom/client";
import type { Observable } from "rxjs";
import SimilarNotesViewReact, {
    type NoteBottomViewModel,
} from "./SimilarNotesViewReact";

// Interface for similar note items
export interface SimilarNotesViewData {
    file: TFile;
    title: string;
    similarity: number;
}

export class SimilarNotesView extends Component {
    private containerEl: HTMLElement;
    private root: Root;

    constructor(
        private app: App,
        private leaf: WorkspaceLeaf,
        private parentEl: HTMLElement,
        private bottomViewModelSubject$: Observable<NoteBottomViewModel>
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
                leaf: this.leaf,
                bottomViewModelSubject$: this.bottomViewModelSubject$,
            })
        );
    }

    public getContainerEl(): HTMLElement {
        return this.containerEl;
    }

    onunload(): void {
        this.root.unmount();
    }
}

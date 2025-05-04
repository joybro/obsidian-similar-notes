import type { MarkdownView, TFile, Workspace } from "obsidian";
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
        private workspace: Workspace,
        private leaf: MarkdownView,
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
                workspace: this.workspace,
                leaf: this.leaf,
                bottomViewModelSubject$: this.bottomViewModelSubject$,
            })
        );
    }

    public getContainerEl(): HTMLElement {
        return this.containerEl;
    }

    public unload(): void {
        this.root.unmount();
    }
}

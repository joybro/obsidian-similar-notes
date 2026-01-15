import type { MarkdownView, Workspace } from "obsidian";
import { Component } from "obsidian";
import * as React from "react";
import { type Root, createRoot } from "react-dom/client";
import type { Observable } from "rxjs";
import NoteBottomViewReact, {
    type NoteBottomViewModel,
} from "./NoteBottomViewReact";

export class NoteBottomView extends Component {
    private containerEl: HTMLElement;
    private root: Root;

    constructor(
        private workspace: Workspace,
        private vaultName: string,
        private leaf: MarkdownView,
        private parentEl: HTMLElement,
        private bottomViewModelSubject$: Observable<NoteBottomViewModel>
    ) {
        super();
        this.containerEl = parentEl.createDiv({
            cls: "embedded-similar-notes",
        });
        this.root = createRoot(this.containerEl);
        this.render();
    }

    private render(): null {
        this.root.render(
            React.createElement(NoteBottomViewReact, {
                workspace: this.workspace,
                vaultName: this.vaultName,
                leaf: this.leaf,
                bottomViewModelSubject$: this.bottomViewModelSubject$,
                viewType: "bottom",
            })
        );
        return null;
    }

    public getContainerEl(): HTMLElement {
        return this.containerEl;
    }

    public unload(): void {
        this.root.unmount();
        this.containerEl.remove();
    }
}

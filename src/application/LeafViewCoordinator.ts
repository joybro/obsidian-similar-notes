import type { App, WorkspaceLeaf } from "obsidian";
import { filter, map } from "rxjs";
import { NoteBottomViewManager } from "./NoteBottomViewManager";
import type { SettingsService } from "./SettingsService";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";

export class LeafViewCoordinator {
    private noteBottomViewManager: NoteBottomViewManager;

    constructor(
        app: App,
        similarNoteCoordinator: SimilarNoteCoordinator,
        settingsService: SettingsService
    ) {
        // Extract only showAtBottom-related data from SettingsService
        const initialShowAtBottom = settingsService.get().showAtBottom;
        const showAtBottomChanges$ = settingsService
            .getNewSettingsObservable()
            .pipe(
                // Only emit when showAtBottom actually changes
                filter(changes => changes.showAtBottom !== undefined),
                map(changes => changes.showAtBottom!)
            );

        this.noteBottomViewManager = new NoteBottomViewManager(
            app,
            similarNoteCoordinator,
            initialShowAtBottom,
            showAtBottomChanges$
        );
    }

    async onActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void> {
        await this.noteBottomViewManager.onActiveLeafChange(leaf);
    }

    async onLayoutChange(): Promise<void> {
        await this.noteBottomViewManager.onLayoutChange();
    }

    async onUnload(): Promise<void> {
        await this.noteBottomViewManager.onUnload();
    }
}

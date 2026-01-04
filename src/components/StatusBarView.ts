import type { App, Plugin } from "obsidian";
import { Menu, Notice, setIcon } from "obsidian";
import type { Observable } from "rxjs";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";

export interface StatusBarViewConfig {
    plugin: Plugin;
    app: App;
    noteChangeCount$: Observable<number>;
    downloadProgress$: Observable<number>;
    modelError$: Observable<string | null>;
    indexedNotesMTimeStore: IndexedNoteMTimeStore;
    noteChunkRepository: NoteChunkRepository;
    modelService: EmbeddingService;
    onRetry: () => void;
    onOpenSettings: () => void;
}

type StatusBarState = "idle" | "downloading" | "indexing" | "error";

export class StatusBarView {
    private statusBarItem: HTMLElement;
    private lastNotifiedThreshold: number | null = null;
    private lastError: string | null = null;

    private currentState: StatusBarState = "idle";
    private downloadProgress = 100;
    private noteChangeCount = 0;

    constructor(private config: StatusBarViewConfig) {
        this.statusBarItem = this.config.plugin.addStatusBarItem();
        this.statusBarItem.addClass("similar-notes-status-bar");

        this.setupClickHandler();
        this.subscribeToObservables();
        this.updateDisplay();
    }

    private setupClickHandler(): void {
        this.statusBarItem.addEventListener("click", (evt) => {
            this.showMenu(evt);
        });
    }

    private subscribeToObservables(): void {
        this.config.downloadProgress$.subscribe((progress) => {
            this.downloadProgress = progress;
            this.updateState();
        });

        this.config.noteChangeCount$.subscribe((count) => {
            this.noteChangeCount = count;

            // Show notice when crossing 100-note thresholds
            if (count > 10) {
                const currentThreshold =
                    Math.floor((count - 1) / 100) * 100 + 100;
                if (
                    this.lastNotifiedThreshold !== null &&
                    currentThreshold < this.lastNotifiedThreshold
                ) {
                    new Notice(
                        `Similar Notes: ${count} notes remaining to index`
                    );
                }
                this.lastNotifiedThreshold = currentThreshold;
            } else {
                this.lastNotifiedThreshold = null;
            }

            this.updateState();
        });

        this.config.modelError$.subscribe((error) => {
            this.lastError = error;
            this.updateState();
        });
    }

    private updateState(): void {
        let newState: StatusBarState;

        if (this.lastError) {
            newState = "error";
        } else if (this.downloadProgress < 100) {
            newState = "downloading";
        } else if (this.noteChangeCount > 10) {
            newState = "indexing";
        } else {
            newState = "idle";
        }

        if (newState !== this.currentState) {
            this.currentState = newState;
        }
        this.updateDisplay();
    }

    private updateDisplay(): void {
        this.statusBarItem.empty();

        const iconEl = this.statusBarItem.createSpan({ cls: "status-bar-item-icon" });

        switch (this.currentState) {
            case "error":
                setIcon(iconEl, "alert-triangle");
                break;
            case "downloading":
                setIcon(iconEl, "search");
                this.statusBarItem.createSpan({
                    text: ` ${Math.floor(this.downloadProgress)}%`,
                });
                break;
            case "indexing":
                setIcon(iconEl, "search");
                this.statusBarItem.createSpan({
                    text: ` ${this.noteChangeCount} to index`,
                });
                break;
            case "idle":
            default:
                setIcon(iconEl, "search");
                break;
        }
    }

    private async showMenu(evt: MouseEvent): Promise<void> {
        const menu = new Menu();

        // Header
        menu.addItem((item) =>
            item.setTitle("Similar Notes").setIsLabel(true)
        );

        menu.addSeparator();

        if (this.currentState === "error" && this.lastError) {
            // Error state menu
            menu.addItem((item) =>
                item.setTitle(`⚠ ${this.lastError}`).setIsLabel(true)
            );

            menu.addSeparator();

            menu.addItem((item) =>
                item
                    .setTitle("Retry")
                    .setIcon("refresh-cw")
                    .onClick(() => {
                        this.config.onRetry();
                    })
            );
        } else {
            // Normal state menu - show stats
            const indexedNoteCount =
                this.config.indexedNotesMTimeStore.getCurrentIndexedNoteCount();
            const totalNoteCount =
                this.config.app.vault.getMarkdownFiles().length;

            let chunkCount = 0;
            try {
                chunkCount = await this.config.noteChunkRepository.count();
            } catch {
                // Ignore errors when getting chunk count
            }

            const modelId = this.config.modelService.getCurrentModelId();
            const providerType = this.config.modelService.getCurrentProviderType();

            menu.addItem((item) =>
                item
                    .setTitle(
                        `Indexed: ${indexedNoteCount}/${totalNoteCount} notes (${chunkCount} chunks)`
                    )
                    .setIsLabel(true)
            );

            if (modelId) {
                const providerLabel = providerType === "ollama" ? "Ollama" : "Built-in";
                menu.addItem((item) =>
                    item.setTitle(`Model: ${modelId} (${providerLabel})`).setIsLabel(true)
                );
            }

            menu.addSeparator();

            menu.addItem((item) =>
                item
                    .setTitle("Reindex all")
                    .setIcon("refresh-cw")
                    .onClick(() => {
                        // @ts-expect-error - Obsidian's commands API
                        this.config.app.commands.executeCommandById(
                            "similar-notes:reindex-all-notes"
                        );
                    })
            );
        }

        menu.addItem((item) =>
            item
                .setTitle("Settings")
                .setIcon("settings")
                .onClick(() => {
                    this.config.onOpenSettings();
                })
        );

        menu.showAtMouseEvent(evt);
    }

    dispose(): void {
        this.statusBarItem.remove();
    }
}

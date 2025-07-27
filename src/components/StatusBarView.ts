import type { Plugin } from "obsidian";
import { Notice } from "obsidian";
import type { Observable } from "rxjs";

export class StatusBarView {
    private noteCountItem: HTMLElement;
    private modelBusyItem: HTMLElement;
    private modelDownloadProgressItem: HTMLElement;
    private lastNotifiedThreshold: number | null = null;

    constructor(
        private plugin: Plugin,
        private noteChangeCount$: Observable<number>,
        private modelBusy$: Observable<boolean>,
        private downloadProgress$: Observable<number>,
        private modelError$?: Observable<string | null>
    ) {
        this.modelBusyItem = this.plugin.addStatusBarItem();
        this.modelDownloadProgressItem = this.plugin.addStatusBarItem();
        this.noteCountItem = this.plugin.addStatusBarItem();

        this.downloadProgress$.subscribe((progress) => {
            if (progress < 100) {
                this.modelDownloadProgressItem.setText(
                    `${Math.floor(progress)}%`
                );
                this.modelDownloadProgressItem.show();
            } else {
                this.modelDownloadProgressItem.hide();
            }
        });

        this.noteChangeCount$.subscribe((count) => {
            if (count > 10) {
                this.noteCountItem.setText(`${count} to index`);
                this.noteCountItem.show();

                // Show notice when crossing 100-note thresholds
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
                this.noteCountItem.hide();
                this.lastNotifiedThreshold = null;
            }
        });

        // Subscribe to model error changes
        if (this.modelError$) {
            this.modelError$.subscribe((error) => {
                if (error) {
                    this.setStatus("error");
                } else {
                    this.setStatus("ready");
                }
            });
        }

        // It turned out to be too short time to be useful
        // this.modelBusy$.subscribe((busy) => {
        //     this.modelBusyItem.setText(busy ? "X" : "");
        // });
    }

    /**
     * Set the status message in the status bar
     * @param status The status to set ("ready" or "error")
     */
    setStatus(status: "ready" | "error"): void {
        if (status === "ready") {
            this.modelBusyItem.setText("");
        } else if (status === "error") {
            this.modelBusyItem.setText("Error loading model");
            this.modelBusyItem.show();
        }
    }

    dispose() {
        this.noteCountItem.remove();
        this.modelBusyItem.remove();
        this.modelDownloadProgressItem.remove();
    }
}

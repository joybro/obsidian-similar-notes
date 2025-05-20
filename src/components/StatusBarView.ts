import type { Plugin } from "obsidian";
import type { Observable } from "rxjs";

export class StatusBarView {
    private noteCountItem: HTMLElement;
    private modelBusyItem: HTMLElement;
    private modelDownloadProgressItem: HTMLElement;

    constructor(
        private plugin: Plugin,
        private noteChangeCount$: Observable<number>,
        private modelBusy$: Observable<boolean>,
        private downloadProgress$: Observable<number>
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
            } else {
                this.noteCountItem.hide();
            }
        });

        // It turned out to be too short time to be useful
        // this.modelBusy$.subscribe((busy) => {
        //     this.modelBusyItem.setText(busy ? "X" : "");
        // });
    }

    dispose() {
        this.noteCountItem.remove();
        this.modelBusyItem.remove();
    }
}

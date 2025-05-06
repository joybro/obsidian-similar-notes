import type { Plugin } from "obsidian";
import type { Observable } from "rxjs";

export class StatusBarView {
    private noteCountItem: HTMLElement;
    private modelBusyItem: HTMLElement;

    constructor(
        private plugin: Plugin,
        private noteChangeCount$: Observable<number>,
        private modelBusy$: Observable<boolean>
    ) {
        this.modelBusyItem = this.plugin.addStatusBarItem();
        this.noteCountItem = this.plugin.addStatusBarItem();

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

import type { EmptyReason } from "@/components/emptyStateText";
import { Subject, type Observable, type Subscription } from "rxjs";

/** The part of the panel coordinator the gate drives. */
export interface WaitingPanel {
    setWaiting(reason: EmptyReason | null): void;
}

/**
 * Keeps the panel from searching while the model is being downloaded or
 * loaded (panel-empty-states spec, "Model load"). A search in that window
 * throws in the provider and shows the red failure line for something that
 * clears by itself.
 */
// A model already on disk also reports progress from 0 to 100 while it is
// read (measured on desktop: about 0.6 s). Only a load still below 100 after
// this long is called a download.
export const DOWNLOAD_GRACE_MS = 2000;

export class ModelLoadGate {
    private loading = false;
    // Last download progress (0-100) of the current load; null until the
    // provider reports one (a model already on disk may report none).
    private percent: number | null = null;
    // True once progress has stayed below 100 for the grace period.
    private downloadShown = false;
    private graceTimer: number | null = null;
    private readonly shownProgress$ = new Subject<number>();

    constructor(
        private readonly panel: WaitingPanel,
        private readonly graceMs = DOWNLOAD_GRACE_MS
    ) {}

    /** A model load is starting (plugin start, model change, reload). */
    begin(): void {
        this.reset();
        this.loading = true;
        this.publish();
    }

    /**
     * The load finished; the panel searches again. After a failed load the
     * index is not opened, so a search would throw: the panel holds on the
     * failure line instead, for every note, until the next load begins.
     */
    end(options: { failed?: boolean } = {}): void {
        if (!this.loading) {
            return;
        }
        this.reset();
        this.shownProgress$.next(100);
        this.panel.setWaiting(options.failed ? { kind: "embedding-failed" } : null);
    }

    /** Follow the download progress (the status bar's source). */
    watch(downloadProgress$: Observable<number>): Subscription {
        return downloadProgress$.subscribe((percent) => {
            if (!this.loading) {
                return;
            }
            this.percent = percent;
            if (percent < 100 && !this.downloadShown && this.graceTimer === null) {
                this.graceTimer = window.setTimeout(() => {
                    this.graceTimer = null;
                    this.downloadShown = true;
                    this.publish();
                }, this.graceMs);
            }
            this.publish();
        });
    }

    /**
     * The download percent as shown to the user: below 100 only while the
     * panel says "downloading", 100 otherwise. The status bar reads this, so
     * it shows a percent exactly when the panel does, with the same number.
     */
    getShownDownloadProgress$(): Observable<number> {
        return this.shownProgress$.asObservable();
    }

    private publish(): void {
        const reason = this.reason();
        this.shownProgress$.next(
            reason.kind === "downloading" ? reason.percent : 100
        );
        this.panel.setWaiting(reason);
    }

    private reset(): void {
        this.loading = false;
        this.percent = null;
        this.downloadShown = false;
        if (this.graceTimer !== null) {
            window.clearTimeout(this.graceTimer);
            this.graceTimer = null;
        }
    }

    // "downloading" once progress has stayed below 100 past the grace period;
    // otherwise the model is being read from disk, which takes seconds.
    private reason(): EmptyReason {
        return this.downloadShown && this.percent !== null && this.percent < 100
            ? { kind: "downloading", percent: this.percent }
            : { kind: "loading" };
    }
}

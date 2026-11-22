import type { EmptyReason } from "@/components/emptyStateText";
import type { Observable, Subscription } from "rxjs";

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
export class ModelLoadGate {
    private loading = false;
    // Last download progress (0-100) of the current load; null until the
    // provider reports one (a model already on disk may report none).
    private percent: number | null = null;

    constructor(private readonly panel: WaitingPanel) {}

    /** A model load is starting (plugin start, model change, reload). */
    begin(): void {
        this.loading = true;
        this.percent = null;
        this.panel.setWaiting(this.reason());
    }

    /** The load finished or failed; the panel searches again. */
    end(): void {
        if (!this.loading) {
            return;
        }
        this.loading = false;
        this.percent = null;
        this.panel.setWaiting(null);
    }

    /** Follow the download progress (the status bar's source). */
    watch(downloadProgress$: Observable<number>): Subscription {
        return downloadProgress$.subscribe((percent) => {
            if (!this.loading) {
                return;
            }
            this.percent = percent;
            this.panel.setWaiting(this.reason());
        });
    }

    // "downloading" while progress is below 100; otherwise the model is being
    // read from disk, which takes seconds.
    private reason(): EmptyReason {
        return this.percent !== null && this.percent < 100
            ? { kind: "downloading", percent: this.percent }
            : { kind: "loading" };
    }
}

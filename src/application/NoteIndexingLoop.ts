import type { NoteChange, NoteChangeQueue } from "@/infrastructure/noteChangeQueue";
import type { Subscription } from "rxjs";
import log from "loglevel";

/** Queue scheduling only; processing and retry policy belong to NoteIndexingService. */
export class NoteIndexingLoop {
    private timer: number | null = null;
    private subscription: Subscription | null = null;
    private generation = 0;
    private inFlightPass: Promise<unknown> | null = null;

    constructor(
        private readonly queue: NoteChangeQueue,
        private readonly process: (change: NoteChange) => Promise<void>,
        private readonly supportsParallel: () => boolean,
        private readonly publishCount: (count: number) => void
    ) {}

    start(): void {
        if (this.subscription) return;
        const generation = ++this.generation;
        const current = () => generation === this.generation;
        const schedule = (delay = 1000) => {
            if (current()) this.timer = window.setTimeout(() => void run(), delay);
        };
        const run = async () => {
            if (!current()) return;
            this.timer = null;
            // A restarted loop must wait for I/O from the old generation.
            if (this.inFlightPass) {
                await this.inFlightPass;
                if (!current()) return;
            }
            try {
                this.publishCount(this.queue.getFileChangeCount());
                const changes = this.queue.pollFileChanges(this.supportsParallel() ? 5 : 1);
                if (changes.length === 0) { schedule(); return; }
                this.inFlightPass = Promise.allSettled(changes.map(this.process));
                await this.inFlightPass;
                this.inFlightPass = null;
            } catch (error) {
                log.error("[NoteIndexingService] Change loop failed, retrying in 1s:", error);
                schedule();
                return;
            }
            if (current()) void run();
        };
        this.subscription = this.queue.getReadyChanges$().subscribe(() => {
            // Idle/error timers can wake early. An active pass drains on completion.
            // Defer so queue producers finish their mutations before polling.
            if (this.timer !== null) {
                window.clearTimeout(this.timer);
                schedule(0);
            }
        });
        void run();
    }

    stop(): void {
        this.generation++;
        this.subscription?.unsubscribe();
        this.subscription = null;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BehaviorSubject } from "rxjs";

// Shared sink so tests can inspect the titles rendered into the status-bar menu.
const { capturedTitles } = vi.hoisted(() => ({
    capturedTitles: [] as string[],
}));

// StatusBarView pulls Menu/Notice/setIcon/setTooltip from obsidian. Provide just
// enough of that surface for construction + dispose, and record menu item titles.
vi.mock("obsidian", () => ({
    Menu: class {
        addItem(cb?: (item: unknown) => void) {
            const item = {
                setTitle(t: string) {
                    capturedTitles.push(t);
                    return item;
                },
                setIsLabel() {
                    return item;
                },
                setIcon() {
                    return item;
                },
                onClick() {
                    return item;
                },
            };
            cb?.(item);
            return this;
        }
        addSeparator() {
            return this;
        }
        showAtMouseEvent() {
            return this;
        }
    },
    Notice: class {},
    setIcon: vi.fn(),
    setTooltip: vi.fn(),
}));

import { StatusBarView, type StatusBarViewConfig } from "../StatusBarView";

function createFakeStatusBarItem() {
    return {
        addClass: vi.fn(),
        removeClass: vi.fn(),
        empty: vi.fn(),
        createSpan: vi.fn(() => ({})),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        remove: vi.fn(),
    };
}

function createConfig() {
    const statusBarItem = createFakeStatusBarItem();
    const downloadProgress$ = new BehaviorSubject<number>(100);
    const noteChangeCount$ = new BehaviorSubject<number>(0);
    const modelError$ = new BehaviorSubject<string | null>(null);
    const erroredCount$ = new BehaviorSubject<number>(0);

    const config = {
        plugin: { addStatusBarItem: () => statusBarItem },
        app: { vault: { getMarkdownFiles: () => [] } },
        noteChangeCount$,
        downloadProgress$,
        modelError$,
        indexedNotesMTimeStore: { getCurrentIndexedNoteCount: () => 0 },
        erroredNoteStore: { getErroredCount$: () => erroredCount$ },
        noteChunkRepository: { count: async () => 0 },
        modelService: {
            getCurrentModelId: () => "m",
            getCurrentProviderType: () => "builtin",
        },
        onRetry: vi.fn(),
        onOpenSettings: vi.fn(),
    } as unknown as StatusBarViewConfig;

    return {
        config,
        statusBarItem,
        downloadProgress$,
        noteChangeCount$,
        modelError$,
        erroredCount$,
    };
}

describe("StatusBarView cleanup (issue #8 — leaked subscriptions/listeners on reload)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("subscribes to all observables on construction", () => {
        const { config, downloadProgress$, noteChangeCount$, modelError$ } = createConfig();

        new StatusBarView(config);

        expect(downloadProgress$.observed).toBe(true);
        expect(noteChangeCount$.observed).toBe(true);
        expect(modelError$.observed).toBe(true);
    });

    it("unsubscribes from all observables on dispose()", () => {
        const { config, downloadProgress$, noteChangeCount$, modelError$ } = createConfig();

        const view = new StatusBarView(config);
        view.dispose();

        // Dangling subscriptions keep the StatusBarView (and its DOM node) alive
        // across plugin reloads.
        expect(downloadProgress$.observed).toBe(false);
        expect(noteChangeCount$.observed).toBe(false);
        expect(modelError$.observed).toBe(false);
    });

    it("removes the click listener on dispose()", () => {
        const { config, statusBarItem } = createConfig();

        const view = new StatusBarView(config);
        const [event, handler] = statusBarItem.addEventListener.mock.calls[0];
        view.dispose();

        expect(statusBarItem.removeEventListener).toHaveBeenCalledWith(event, handler);
    });
});

describe("StatusBarView errored count (indexing-status spec §4.7)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedTitles.length = 0;
    });

    it("shows the errored count in the menu when there are errored notes", async () => {
        const { config, statusBarItem, erroredCount$ } = createConfig();
        const view = new StatusBarView(config);
        erroredCount$.next(2);

        // Trigger the click handler that opens the (async) menu.
        const handler = statusBarItem.addEventListener.mock.calls[0][1] as (
            evt: MouseEvent
        ) => void;
        handler({} as MouseEvent);

        await vi.waitFor(() => {
            expect(capturedTitles.some((t) => /\(2 errored\)/.test(t))).toBe(true);
        });

        view.dispose();
    });
});

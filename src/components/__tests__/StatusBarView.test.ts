import { describe, it, expect, vi, beforeEach } from "vitest";
import { BehaviorSubject } from "rxjs";

// StatusBarView pulls Menu/Notice/setIcon/setTooltip from obsidian. Provide just
// enough of that surface for construction + dispose.
vi.mock("obsidian", () => ({
    Menu: class {
        addItem() {
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

    const config = {
        plugin: { addStatusBarItem: () => statusBarItem },
        app: { vault: { getMarkdownFiles: () => [] } },
        noteChangeCount$,
        downloadProgress$,
        modelError$,
        indexedNotesMTimeStore: { getCurrentIndexedNoteCount: () => 0 },
        noteChunkRepository: { count: async () => 0 },
        modelService: {
            getCurrentModelId: () => "m",
            getCurrentProviderType: () => "builtin",
        },
        onRetry: vi.fn(),
        onOpenSettings: vi.fn(),
    } as unknown as StatusBarViewConfig;

    return { config, statusBarItem, downloadProgress$, noteChangeCount$, modelError$ };
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

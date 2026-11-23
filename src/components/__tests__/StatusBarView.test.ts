import { describe, it, expect, vi, beforeEach } from "vitest";
import { BehaviorSubject } from "rxjs";

// Shared sink so tests can inspect the titles rendered into the status-bar menu.
const { capturedTitles, capturedNotices } = vi.hoisted(() => ({
    capturedTitles: [] as string[],
    capturedNotices: [] as string[],
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
    Notice: class {
        constructor(message: string) { capturedNotices.push(message); }
    },
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
        getNotifiableChangeCount: () => noteChangeCount$.value,
        downloadProgress$,
        modelError$,
        indexedNotesMTimeStore: {
            getCurrentIndexedNoteCount: () => 0,
            getAllPaths: () => [] as string[],
        },
        erroredNoteStore: {
            getErroredCount$: () => erroredCount$,
            getAllPaths: () => [] as string[],
        },
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

describe("StatusBarView model line names the active provider", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedTitles.length = 0;
    });

    it.each([
        ["builtin", "Built-in Models"],
        ["ollama", "Ollama"],
        ["openai", "OpenAI / Compatible"],
        ["gemini", "Google Gemini"],
    ])("provider %s is labeled %s", async (providerType, label) => {
        const { config, statusBarItem } = createConfig();
        (
            config.modelService as unknown as {
                getCurrentProviderType: () => string;
            }
        ).getCurrentProviderType = () => providerType;
        const view = new StatusBarView(config);

        const handler = statusBarItem.addEventListener.mock.calls[0][1] as (
            evt: MouseEvent
        ) => void;
        handler({} as MouseEvent);

        await vi.waitFor(() => {
            expect(capturedTitles).toContain(`Model: m (${label})`);
        });

        view.dispose();
    });
});

describe("StatusBarView indexed count leaves out excluded notes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedTitles.length = 0;
    });

    it("counts only notes the exclusion rules do not match", async () => {
        const { config, statusBarItem } = createConfig();
        const files = ["a.md", "b.md", "Private/c.md"].map((path) => ({
            path,
        }));
        (
            config.app as unknown as {
                vault: { getMarkdownFiles: () => { path: string }[] };
            }
        ).vault.getMarkdownFiles = () => files;
        (
            config.indexedNotesMTimeStore as unknown as {
                getAllPaths: () => string[];
            }
        ).getAllPaths = () => ["a.md", "b.md"];
        (
            config as unknown as { isExcluded: (p: string) => boolean }
        ).isExcluded = (p) => p.startsWith("Private/");
        const view = new StatusBarView(config);

        const handler = statusBarItem.addEventListener.mock.calls[0][1] as (
            evt: MouseEvent
        ) => void;
        handler({} as MouseEvent);

        await vi.waitFor(() => {
            expect(capturedTitles).toContain("Indexed: 2/2 notes (0 chunks)");
        });

        view.dispose();
    });

    it("leaves a newly excluded note out of the indexed count before Apply rules", async () => {
        const { config, statusBarItem } = createConfig();
        const files = ["a.md", "b.md", "Private/c.md"].map((path) => ({
            path,
        }));
        (
            config.app as unknown as {
                vault: { getMarkdownFiles: () => { path: string }[] };
            }
        ).vault.getMarkdownFiles = () => files;
        // Private/c.md was indexed before the rule was added, so its mtime
        // entry is still in the store until the rules are applied.
        (
            config.indexedNotesMTimeStore as unknown as {
                getCurrentIndexedNoteCount: () => number;
                getAllPaths: () => string[];
            }
        ).getCurrentIndexedNoteCount = () => 3;
        (
            config.indexedNotesMTimeStore as unknown as {
                getAllPaths: () => string[];
            }
        ).getAllPaths = () => ["a.md", "b.md", "Private/c.md"];
        (
            config as unknown as { isExcluded: (p: string) => boolean }
        ).isExcluded = (p) => p.startsWith("Private/");
        const view = new StatusBarView(config);

        const handler = statusBarItem.addEventListener.mock.calls[0][1] as (
            evt: MouseEvent
        ) => void;
        handler({} as MouseEvent);

        await vi.waitFor(() => {
            expect(capturedTitles).toContain("Indexed: 2/2 notes (0 chunks)");
        });

        view.dispose();
    });
});


describe("제목 백필과 일반 색인의 진행 알림", () => {
    async function drain(titleCount: number, bodyCount: number) {
        const { NoteChangeQueue } = await import("@/infrastructure/noteChangeQueue");
        const { NoteIndexingLoop } = await import("@/application/NoteIndexingLoop");
        const queue = new NoteChangeQueue(
            {} as never, {} as never, {} as never, {} as never, {} as never
        );
        queue.enqueue([
            ...Array.from({ length: titleCount }, (_, i) => ({
                path: `title-${i}.md`, reason: "title-backfill" as const,
            })),
            ...Array.from({ length: bodyCount }, (_, i) => ({
                path: `body-${i}.md`, reason: "modified" as const,
            })),
        ]);
        const { config, noteChangeCount$, statusBarItem } = createConfig();
        config.getNotifiableChangeCount = () => queue.getNotifiableChangeCount();
        noteChangeCount$.next(queue.getFileChangeCount());
        capturedNotices.length = 0;
        const view = new StatusBarView(config);
        const processed: string[] = [];
        const loop = new NoteIndexingLoop(queue, async (change) => {
            processed.push(change.path);
        }, () => true, (count) => noteChangeCount$.next(count));
        try {
            expect(statusBarItem.createSpan).toHaveBeenCalledWith({
                text: ` ${titleCount + bodyCount} to index`,
            });
            loop.start();
            await vi.waitFor(() => expect(noteChangeCount$.value).toBe(0));
            expect(processed).toHaveLength(titleCount + bodyCount);
            return [...capturedNotices];
        } finally {
            loop.stop();
            view.dispose();
        }
    }

    it("제목만 3200건이면 상태 표시를 유지하고 팝업은 띄우지 않는다", async () => {
        expect(await drain(3200, 0)).toEqual([]);
    });

    it("본문 350건은 기존 100개 단위 알림을 유지한다", async () => {
        expect(await drain(0, 350)).toEqual([
            "Similar Notes: 300 notes remaining to index",
            "Similar Notes: 200 notes remaining to index",
            "Similar Notes: 100 notes remaining to index",
        ]);
    });

    it("백필 3200건과 본문 350건이 섞여도 본문 수만 알린다", async () => {
        expect(await drain(3200, 350)).toEqual([
            "Similar Notes: 300 notes remaining to index",
            "Similar Notes: 200 notes remaining to index",
            "Similar Notes: 100 notes remaining to index",
        ]);
    });
});

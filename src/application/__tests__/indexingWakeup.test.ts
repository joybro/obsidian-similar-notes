import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TFile } from "obsidian";
import { NoteChangeQueue } from "@/infrastructure/noteChangeQueue";
import { NoteIndexingService } from "../NoteIndexingService";

const cleanups: Array<() => void> = [];

function fixture(parallel = false) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const reads = new Map<string, number[]>();
    const indexed = new Set(["a.md", "b.md"]);
    const removed: string[] = [];
    const started: string[] = [];
    let busy = 0;
    let maxBusy = 0;
    let barrier: Promise<void> | undefined;
    let release = () => {};
    const settings = { get: () => ({ excludeFolderPatterns: [], excludeFrontmatterRules: [], indexingDelaySeconds: 1 }) };
    const files = new Map<string, TFile>();
    const vault = {
        getMarkdownFiles: () => [],
        getAbstractFileByPath: (path: string) => files.get(path),
        on: (name: string, callback: (...args: unknown[]) => unknown) => {
            handlers.set(name, callback);
            return { name };
        },
        offref: (ref: { name: string }) => { handlers.delete(ref.name); },
    };
    const metadata = { getFileCache: () => null };
    const mtimes = {
        getAllPaths: () => [], getMTime: () => undefined,
        deleteMTime: async () => {},
    };
    const errors = { get: () => undefined, delete: async () => {}, getAllPaths: () => [], clear: async () => {} };
    const queue = new NoteChangeQueue(vault as never, metadata as never, mtimes as never, settings as never, errors as never);
    const repository = {
        // A filesystem read is observable work, even when a note vanished meanwhile.
        findByPath: async (path: string) => {
            reads.set(path, [...(reads.get(path) ?? []), Date.now()]);
            return null;
        },
    };
    const chunks = {
        removeByPath: async (path: string) => {
            started.push(path);
            busy++;
            maxBusy = Math.max(maxBusy, busy);
            if (barrier) await barrier;
            indexed.delete(path);
            removed.push(path);
            busy--;
        },
    };
    const service = new NoteIndexingService(repository as never, chunks as never, queue, {} as never,
        { supportsParallelProcessing: () => parallel } as never, {} as never, settings as never,
        { workspace: { getActiveFile: () => null } } as never, errors as never);
    cleanups.push(() => { service.stopLoop(); queue.cleanup(); });
    return {
        queue, service, reads, indexed, removed, started,
        maxBusy: () => maxBusy,
        block: () => { barrier = new Promise<void>((resolve) => { release = resolve; }); },
        release: () => release(),
        modify: (path: string) => {
            const file = Object.assign(new TFile(path), { stat: { mtime: Date.now() } });
            files.set(path, file);
            handlers.get("modify")?.(file);
        },
    };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });

describe("ready queue scheduling (indexing-wakeup-spec §1–3)", () => {
    test("processes a saved edit when its delay expires instead of waiting for the next poll", async () => {
        const f = fixture();
        await f.queue.initialize();
        f.service.startLoop();
        await vi.advanceTimersByTimeAsync(100);
        f.modify("edited.md");
        await vi.advanceTimersByTimeAsync(999);
        expect(f.reads.has("edited.md")).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(f.reads.get("edited.md")).toEqual([1101]);
        expect(f.queue.getFileChangeCount()).toBe(0);
    });

    test("a later edit restarts the configured debounce", async () => {
        const f = fixture(); await f.queue.initialize(); f.service.startLoop();
        await vi.advanceTimersByTimeAsync(100); f.modify("edited.md");
        await vi.advanceTimersByTimeAsync(500); f.modify("edited.md");
        await vi.advanceTimersByTimeAsync(999);
        expect(f.reads.has("edited.md")).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(f.reads.get("edited.md")).toEqual([1601]);
    });

    test("appends during a busy local pass stay serial and drain after it finishes", async () => {
        const f = fixture(); await f.queue.initialize(); f.service.startLoop(); f.block();
        f.queue.enqueue([{ path: "a.md", reason: "deleted" }]);
        await vi.advanceTimersByTimeAsync(1);
        expect(f.started).toEqual(["a.md"]);
        f.queue.enqueue([{ path: "b.md", reason: "deleted" }]);
        await vi.advanceTimersByTimeAsync(2000);
        expect(f.indexed.has("b.md")).toBe(true);
        f.release(); await vi.advanceTimersByTimeAsync(1);
        expect(f.removed).toEqual(["a.md", "b.md"]);
        expect(f.maxBusy()).toBe(1);
    });

    test("stopping while idle leaves queued work for a future start", async () => {
        const f = fixture(); await f.queue.initialize(); f.service.startLoop(); f.service.stopLoop();
        f.queue.enqueue([{ path: "a.md", reason: "deleted" }]);
        await vi.advanceTimersByTimeAsync(3000);
        expect(f.indexed.has("a.md")).toBe(true);
        expect(f.queue.getFileChangeCount()).toBe(1);
    });

    test("a stopped in-flight pass cannot drain another queued note", async () => {
        const f = fixture(); await f.queue.initialize(); f.block();
        f.queue.enqueue([{ path: "a.md", reason: "deleted" }]); f.service.startLoop();
        await vi.advanceTimersByTimeAsync(0); f.service.stopLoop();
        f.queue.enqueue([{ path: "b.md", reason: "deleted" }]);
        f.release(); await vi.advanceTimersByTimeAsync(3000);
        expect(f.removed).toEqual(["a.md"]);
        expect(f.indexed.has("b.md")).toBe(true);
    });

    test("restart waits for the old pass and does not exceed local concurrency", async () => {
        const f = fixture(); await f.queue.initialize(); f.block();
        f.queue.enqueue([{ path: "a.md", reason: "deleted" }]); f.service.startLoop();
        await vi.advanceTimersByTimeAsync(0); f.service.stopLoop();
        f.queue.enqueue([{ path: "b.md", reason: "deleted" }]); f.service.startLoop();
        await vi.advanceTimersByTimeAsync(1);
        expect(f.started).toEqual(["a.md"]);
        f.release(); await vi.advanceTimersByTimeAsync(1);
        expect(f.removed).toEqual(["a.md", "b.md"]);
        expect(f.maxBusy()).toBe(1);
    });

    test("starting twice cannot exceed the parallel provider limit of five", async () => {
        const f = fixture(true); await f.queue.initialize(); f.block();
        f.service.startLoop(); f.service.startLoop();
        f.queue.enqueue(Array.from({ length: 8 }, (_, n) => ({ path: n + ".md", reason: "deleted" as const })));
        await vi.advanceTimersByTimeAsync(1001);
        expect(f.started).toHaveLength(5);
        f.release(); await vi.advanceTimersByTimeAsync(1);
        expect(f.removed).toHaveLength(8);
        expect(f.maxBusy()).toBe(5);
    });
});

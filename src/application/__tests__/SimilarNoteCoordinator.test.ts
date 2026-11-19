import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import type { TFile, Vault } from "obsidian";
import { BehaviorSubject, Subject, firstValueFrom } from "rxjs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SimilarNoteCoordinator } from "../SimilarNoteCoordinator";
import type {
    SettingsService,
    SimilarNotesSettings,
} from "../SettingsService";

function makeFile(path: string, mtime = 1): TFile {
    return {
        path,
        basename: path.replace(/\.md$/, ""),
        extension: path.split(".").pop() ?? "",
        stat: { mtime, ctime: mtime, size: 1 },
    } as unknown as TFile;
}

function makeSettings(
    overrides: Partial<SimilarNotesSettings> = {}
): SimilarNotesSettings {
    return {
        modelProvider: "builtin",
        modelId: "test-model",
        includeFrontmatter: false,
        showSourceChunk: false,
        useGPU: false,
        excludeFolderPatterns: [],
        excludeRegexPatterns: [],
        regexpTestInputText: "",
        noteDisplayMode: "smart",
        showAtBottom: true,
        sidebarResultCount: 10,
        bottomResultCount: 5,
        minSimilarityThreshold: 0,
        indexingDelaySeconds: 1,
        ...overrides,
    };
}

describe("SimilarNoteCoordinator", () => {
    let vault: Vault;
    let noteRepository: NoteRepository;
    let similarNoteFinder: SimilarNoteFinder;
    let settingsService: SettingsService;
    let settings: SimilarNotesSettings;

    let settingsChange$: Subject<Partial<SimilarNotesSettings>>;

    beforeEach(() => {
        settings = makeSettings();
        settingsChange$ = new Subject<Partial<SimilarNotesSettings>>();

        vault = {
            getFileByPath: vi.fn((path: string) => makeFile(path)),
        } as unknown as Vault;

        noteRepository = {
            findByFile: vi.fn().mockResolvedValue({
                path: "open.md",
                title: "open",
                content: "",
                links: [],
            }),
            findByPath: vi.fn(),
            getLinkedPaths: vi.fn().mockResolvedValue([]),
        };

        const findSimilarNotes = vi.fn().mockResolvedValue([]);
        similarNoteFinder = {
            findSimilarNotes,
            // Tests stub findSimilarNotes; the status variant reports "ok"
            // around it unless a test overrides it.
            findSimilarNotesWithStatus: vi.fn(
                async (...args: unknown[]) => ({
                    notes: await findSimilarNotes(...args),
                    status: "ok",
                })
            ),
        } as unknown as SimilarNoteFinder;

        settingsService = {
            get: vi.fn(() => settings),
            getNewSettingsObservable: vi.fn(() => settingsChange$),
        } as unknown as SettingsService;
    });

    describe("#39.1: sidebar should not show stale results when the active note is closed", () => {
        test("onFileOpen(null) emits a model with currentFile=null and an empty result list", async () => {
            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );

            // Prime the sidebar with results for some file.
            const opened = makeFile("open.md");
            (
                similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>
            ).mockResolvedValueOnce([
                {
                    path: "neighbor.md",
                    title: "neighbor",
                    similarity: 0.9,
                    similarChunk: "chunk",
                    sourceChunk: "source",
                },
            ]);
            (vault.getFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
                makeFile("neighbor.md")
            );
            await coord.onFileOpen(opened);

            // Capture every emission from now on.
            const seen: Array<{
                currentFile: unknown;
                count: number;
            }> = [];
            const sub = coord
                .getNoteBottomViewModelObservable()
                .subscribe((m) => {
                    seen.push({
                        currentFile: m.currentFile,
                        count: m.similarNoteEntries.length,
                    });
                });

            // BehaviorSubject replays the latest value on subscribe — that's the
            // primed "opened" emission. Drop it; we care about what onFileOpen(null) emits next.
            seen.length = 0;

            // The user closes the note. Obsidian fires file-open(null).
            await coord.onFileOpen(null);

            sub.unsubscribe();

            expect(seen).toHaveLength(1);
            expect(seen[0].currentFile).toBeNull();
            expect(seen[0].count).toBe(0);
        });

        test("onFileOpen(non-markdown file) also clears the sidebar instead of keeping prior results", async () => {
            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );

            await coord.onFileOpen(makeFile("open.md"));

            const seen: Array<{ currentFile: unknown; count: number }> = [];
            const sub = coord
                .getNoteBottomViewModelObservable()
                .subscribe((m) => {
                    seen.push({
                        currentFile: m.currentFile,
                        count: m.similarNoteEntries.length,
                    });
                });
            seen.length = 0;

            // User focuses a PDF in another leaf.
            await coord.onFileOpen(makeFile("attachment.pdf"));

            sub.unsubscribe();

            expect(seen).toHaveLength(1);
            expect(seen[0].currentFile).toBeNull();
            expect(seen[0].count).toBe(0);
        });
    });

    describe("#39.2: minimum similarity threshold filter", () => {
        const neighbors = [
            {
                path: "high.md",
                title: "high",
                similarity: 0.9,
                similarChunk: "h-chunk",
                sourceChunk: "h-src",
            },
            {
                path: "mid.md",
                title: "mid",
                similarity: 0.55,
                similarChunk: "m-chunk",
                sourceChunk: "m-src",
            },
            {
                path: "low.md",
                title: "low",
                similarity: 0.2,
                similarChunk: "l-chunk",
                sourceChunk: "l-src",
            },
        ];

        function primeFinder(): void {
            (
                similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>
            ).mockResolvedValue(neighbors);
        }

        test("entries with similarity below the threshold are dropped from the emission", async () => {
            settings = makeSettings({ minSimilarityThreshold: 0.6 });
            (settingsService.get as ReturnType<typeof vi.fn>).mockImplementation(
                () => settings
            );
            primeFinder();

            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );

            await coord.onFileOpen(makeFile("open.md"));

            const latest = coord["noteBottomViewModel$"].value;
            const titles = latest.similarNoteEntries.map((e) => e.title);

            expect(titles).toEqual(["high"]);
        });

        test("default threshold of 0 keeps every entry (backward compat)", async () => {
            primeFinder();

            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );

            await coord.onFileOpen(makeFile("open.md"));

            const latest = coord["noteBottomViewModel$"].value;
            expect(latest.similarNoteEntries.map((e) => e.title)).toEqual([
                "high",
                "mid",
                "low",
            ]);
        });

        test("raising the threshold via settings observable re-emits with the new filter applied", async () => {
            primeFinder();

            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );

            await coord.onFileOpen(makeFile("open.md"));
            expect(
                coord["noteBottomViewModel$"].value.similarNoteEntries
            ).toHaveLength(3);

            // Capture subsequent emissions.
            const seen: number[] = [];
            const sub = coord
                .getNoteBottomViewModelObservable()
                .subscribe((m) => seen.push(m.similarNoteEntries.length));
            seen.length = 0;

            // User raises the threshold in settings.
            settings = makeSettings({ minSimilarityThreshold: 0.5 });
            settingsChange$.next({ minSimilarityThreshold: 0.5 });

            // Let any pending promises resolve (emitNoteBottomViewModel is async).
            await new Promise((resolve) => setTimeout(resolve, 0));

            sub.unsubscribe();

            expect(seen.at(-1)).toBe(2); // high + mid pass; low is dropped
        });
    });

    describe("#51: unchanged indexable text", () => {
        test("refreshes cached linked state without repeating similarity search", async () => {
            const activeFile = makeFile("open.md", 1);
            const updatedFile = makeFile("open.md", 2);
            (vault.getFileByPath as ReturnType<typeof vi.fn>)
                .mockImplementation((path: string) =>
                    path === "open.md" ? updatedFile : makeFile(path)
                );
            (
                similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>
            ).mockResolvedValue([
                {
                    title: "Linked",
                    path: "linked.md",
                    similarity: 0.9,
                    similarChunk: "related",
                    sourceChunk: "source",
                    isLinked: false,
                },
            ]);

            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );
            await coord.onFileOpen(activeFile);

            (noteRepository.getLinkedPaths as ReturnType<typeof vi.fn>)
                .mockResolvedValue(["linked.md"]);

            await expect(
                coord.refreshCachedNoteMetadataFromPath("open.md")
            ).resolves.toBe(true);

            expect(similarNoteFinder.findSimilarNotes).toHaveBeenCalledOnce();
            // Metadata refresh must not read note content — links come from
            // the metadata cache alone.
            expect(noteRepository.findByFile).toHaveBeenCalledOnce(); // initial open only
            expect(
                coord["noteBottomViewModel$"].value.similarNoteEntries[0]
                    .isLinked
            ).toBe(true);
        });

        test("refreshes visible linked state after settings clear the cache", async () => {
            const activeFile = makeFile("open.md", 1);
            const updatedFile = makeFile("open.md", 2);
            (vault.getFileByPath as ReturnType<typeof vi.fn>)
                .mockImplementation((path: string) =>
                    path === "open.md" ? updatedFile : makeFile(path)
                );
            (
                similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>
            ).mockResolvedValue([
                {
                    title: "Linked",
                    path: "linked.md",
                    similarity: 0.9,
                    similarChunk: "related",
                    sourceChunk: "source",
                    isLinked: false,
                },
            ]);

            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );
            await coord.onFileOpen(activeFile);
            settingsChange$.next({ includeFrontmatter: false });

            (noteRepository.getLinkedPaths as ReturnType<typeof vi.fn>)
                .mockResolvedValue(["linked.md"]);

            await expect(
                coord.refreshCachedNoteMetadataFromPath("open.md")
            ).resolves.toBe(true);

            expect(similarNoteFinder.findSimilarNotes).toHaveBeenCalledOnce();
            expect(
                coord["noteBottomViewModel$"].value.similarNoteEntries[0]
                    .isLinked
            ).toBe(true);
        });

        test("does not replace a newly opened note while metadata refresh awaits", async () => {
            const activeFile = makeFile("open.md", 1);
            const updatedFile = makeFile("open.md", 2);
            const nextFile = makeFile("next.md", 3);
            (vault.getFileByPath as ReturnType<typeof vi.fn>)
                .mockImplementation((path: string) =>
                    path === "open.md" ? updatedFile : makeFile(path)
                );
            (
                similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>
            ).mockResolvedValue([
                {
                    title: "Linked",
                    path: "linked.md",
                    similarity: 0.9,
                    similarChunk: "related",
                    sourceChunk: "source",
                    isLinked: false,
                },
            ]);

            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );
            await coord.onFileOpen(activeFile);

            let resolveLinksRead: ((value: string[]) => void) | undefined;
            const linksRead = new Promise<string[]>((resolve) => {
                resolveLinksRead = resolve;
            });
            (noteRepository.getLinkedPaths as ReturnType<typeof vi.fn>)
                .mockImplementation((path: string) =>
                    path === "open.md" ? linksRead : Promise.resolve([])
                );

            const refresh = coord.refreshCachedNoteMetadataFromPath("open.md");
            await coord.onFileOpen(nextFile);
            resolveLinksRead?.(["linked.md"]);
            await refresh;

            expect(
                coord["noteBottomViewModel$"].value.currentFile?.path
            ).toBe("next.md");
        });

        test("stamps the verified mtime, not the live stat, so a concurrent real edit still re-searches", async () => {
            // The note is opened at mtime 1; a hash-verified skip for the
            // change at mtime 1 races with a real edit that bumps the live
            // stat to 2. If the refresh stamped the live stat (2), the
            // pre-edit results would be served as fresh for mtime 2 forever.
            const activeFile = makeFile("open.md", 1);
            const editedFile = makeFile("open.md", 2);
            (vault.getFileByPath as ReturnType<typeof vi.fn>)
                .mockImplementation((path: string) =>
                    path === "open.md" ? editedFile : makeFile(path)
                );
            (
                similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>
            ).mockResolvedValue([
                {
                    path: "neighbor.md",
                    title: "neighbor",
                    similarity: 0.9,
                    similarChunk: "chunk",
                    sourceChunk: "source",
                    isLinked: false,
                },
            ]);

            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );
            await coord.onFileOpen(activeFile); // caches results at mtime 1

            // Hash-skip refresh for the change observed at mtime 1, while the
            // live stat already advanced to 2.
            await coord.refreshCachedNoteMetadataFromPath("open.md", 1);

            // Viewing the edited file (stat mtime 2) must miss the cache and
            // re-run the similarity search.
            await coord.getSimilarNotes(editedFile);
            expect(similarNoteFinder.findSimilarNotes).toHaveBeenCalledTimes(2);
        });
    });

    describe("sim1: regex exclusion applies to the ad-hoc query embedding", () => {
        test("content removed by excludeRegexPatterns never reaches the finder", async () => {
            settings = makeSettings({ excludeRegexPatterns: ["^secret:.*$"] });
            (noteRepository.findByFile as ReturnType<typeof vi.fn>).mockResolvedValue({
                path: "open.md",
                title: "open",
                content: "visible line\nsecret: hunter2\n",
                links: ["a.md"],
            });
            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService
            );

            await coord.getSimilarNotes(makeFile("open.md"));

            const finder = similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>;
            expect(finder).toHaveBeenCalledTimes(1);
            const passed = finder.mock.calls[0][0];
            expect(passed.content).toContain("visible line");
            expect(passed.content).not.toContain("hunter2");
            expect(passed.path).toBe("open.md");
            expect(passed.links).toEqual(["a.md"]);
        });
    });

    describe("excluded notes are not sent to a cloud provider on open", () => {
        const cases: Array<[SimilarNotesSettings["modelProvider"], boolean]> = [
            ["openai", false],
            ["gemini", false],
            ["builtin", true],
            ["ollama", true],
        ];
        test.each(cases)("provider %s → allowAdHocEmbedding %s", async (provider, allowed) => {
            settings = makeSettings({ modelProvider: provider });
            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService,
                (path) => path.startsWith("Private/")
            );
            await coord.getSimilarNotes(makeFile("Private/diary.md"));
            const finder = similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>;
            expect(finder.mock.calls[0][2]).toEqual({ allowAdHocEmbedding: allowed });
        });

        test("included notes keep ad-hoc embedding with a cloud provider", async () => {
            settings = makeSettings({ modelProvider: "openai" });
            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService,
                (path) => path.startsWith("Private/")
            );
            await coord.getSimilarNotes(makeFile("Notes/open.md"));
            const finder = similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>;
            expect(finder.mock.calls[0][2]).toEqual({ allowAdHocEmbedding: true });
        });
    });

    describe("sim6: results cache respects exclusion added after caching", () => {
        test("a target excluded after caching disappears without the source mtime changing", async () => {
            let excluded = false;
            (
                similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>
            ).mockResolvedValue([
                {
                    path: "Private/secret.md",
                    title: "secret",
                    similarity: 0.9,
                    similarChunk: "chunk",
                    sourceChunk: "source",
                    isLinked: false,
                },
                {
                    path: "other.md",
                    title: "other",
                    similarity: 0.8,
                    similarChunk: "chunk",
                    sourceChunk: "source",
                    isLinked: false,
                },
            ]);
            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService,
                (path) => excluded && path.startsWith("Private/")
            );
            const publicFile = makeFile("public.md", 1);
            const before = await coord.getSimilarNotes(publicFile);
            expect(before.map((e) => e.file.path)).toEqual([
                "Private/secret.md",
                "other.md",
            ]);

            excluded = true; // excludeFolderPatterns = Private/** applied
            const after = await coord.getSimilarNotes(publicFile);
            expect(after.map((e) => e.file.path)).toEqual(["other.md"]);
        });

        test("a source excluded after caching with a cloud provider shows an empty panel", async () => {
            settings = makeSettings({ modelProvider: "openai" });
            let excluded = false;
            (
                similarNoteFinder.findSimilarNotes as ReturnType<typeof vi.fn>
            ).mockImplementation(
                async (_note: unknown, _n: number, opts?: { allowAdHocEmbedding?: boolean }) =>
                    opts?.allowAdHocEmbedding === false
                        ? []
                        : [
                            {
                                path: "other.md",
                                title: "other",
                                similarity: 0.8,
                                similarChunk: "chunk",
                                sourceChunk: "source",
                                isLinked: false,
                            },
                        ]
            );
            const coord = new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService,
                (path) => excluded && path.startsWith("Private/")
            );
            const diary = makeFile("Private/diary.md", 1);
            expect(await coord.getSimilarNotes(diary)).toHaveLength(1);

            excluded = true;
            expect(await coord.getSimilarNotes(diary)).toEqual([]);
        });
    });

    describe("empty panel reasons (panel-empty-states spec)", () => {
        const neighbor = (similarity: number) => ({
            path: "neighbor.md",
            title: "neighbor",
            similarity,
            similarChunk: "chunk",
            sourceChunk: "source",
            isLinked: false,
        });
        const withStatus = (status: string, notes: unknown[] = []) =>
            (
                similarNoteFinder.findSimilarNotesWithStatus as ReturnType<typeof vi.fn>
            ).mockResolvedValue({ notes, status });
        const reasonAfterOpen = async (
            coord: SimilarNoteCoordinator,
            path = "open.md"
        ) => {
            await coord.onFileOpen(makeFile(path));
            const view = await firstValueFrom(
                coord.getNoteBottomViewModelObservable()
            );
            return view.emptyReason;
        };
        const make = (isExcluded?: (p: string) => boolean) =>
            new SimilarNoteCoordinator(
                vault,
                noteRepository,
                similarNoteFinder,
                settingsService,
                isExcluded
            );

        test("(a) a note with no text says to write a few lines", async () => {
            withStatus("empty-content");
            expect(await reasonAfterOpen(make())).toEqual({ kind: "unwritten" });
        });

        test("(b) an excluded note with a cloud provider names the provider", async () => {
            settings = makeSettings({ modelProvider: "gemini" });
            withStatus("ad-hoc-disallowed");
            expect(await reasonAfterOpen(make(() => true))).toEqual({
                kind: "excluded-cloud",
                provider: "Gemini",
            });
        });

        test("(c) a failed embedding is reported and not cached", async () => {
            withStatus("embedding-failed");
            const coord = make();
            expect(await reasonAfterOpen(coord)).toEqual({
                kind: "embedding-failed",
            });
            withStatus("ok", [neighbor(0.9)]);
            expect(await reasonAfterOpen(coord)).toBeUndefined();
        });

        test("(d) results hidden by the threshold say so with the value", async () => {
            settings = makeSettings({ minSimilarityThreshold: 0.5 });
            withStatus("ok", [neighbor(0.3)]);
            expect(await reasonAfterOpen(make())).toEqual({
                kind: "below-threshold",
                threshold: 0.5,
            });
        });

        test("(e) no results while notes are queued shows the live count, then searches again", async () => {
            const pending$ = new BehaviorSubject(1240);
            const coord = make();
            coord.watchPendingIndexCount(pending$);
            withStatus("ok", []);
            expect(await reasonAfterOpen(coord)).toEqual({
                kind: "indexing",
                remaining: 1240,
            });

            pending$.next(7);
            let view = await firstValueFrom(coord.getNoteBottomViewModelObservable());
            expect(view.emptyReason).toEqual({ kind: "indexing", remaining: 7 });

            withStatus("ok", [neighbor(0.9)]);
            pending$.next(0);
            await vi.waitFor(async () => {
                view = await firstValueFrom(coord.getNoteBottomViewModelObservable());
                expect(view.similarNoteEntries).toHaveLength(1);
            });
            expect(view.emptyReason).toBeUndefined();
        });

        describe("sim7: results fill in while the vault is still indexing", () => {
            beforeEach(() => {
                vi.useFakeTimers({ toFake: ["Date"] });
                vi.setSystemTime(new Date(2026, 10, 19, 12, 0, 0));
            });
            afterEach(() => {
                vi.useRealTimers();
            });

            test("searches again (throttled) as the count drops, before it reaches zero", async () => {
                const finder =
                    similarNoteFinder.findSimilarNotesWithStatus as ReturnType<typeof vi.fn>;
                const pending$ = new BehaviorSubject(1240);
                const coord = make();
                coord.watchPendingIndexCount(pending$);
                withStatus("ok", []);
                expect(await reasonAfterOpen(coord)).toEqual({
                    kind: "indexing",
                    remaining: 1240,
                });
                const callsAfterOpen = finder.mock.calls.length;

                // Indexed neighbours now exist; the queue drains one note
                // every 100 ms.
                withStatus("ok", [neighbor(0.9)]);
                pending$.next(1239);
                // Within the interval: count updates, no new search yet.
                expect(finder.mock.calls.length).toBe(callsAfterOpen);

                for (let count = 1238; count >= 600; count--) {
                    vi.advanceTimersByTime(100);
                    pending$.next(count);
                    await Promise.resolve();
                }
                await vi.waitFor(async () => {
                    const view = await firstValueFrom(
                        coord.getNoteBottomViewModelObservable()
                    );
                    expect(view.similarNoteEntries).toHaveLength(1);
                    expect(view.emptyReason).toBeUndefined();
                });
                // 64 s of indexing: one search per 10 s at most, and none
                // once results show (the panel left the indexing state).
                expect(finder.mock.calls.length - callsAfterOpen).toBeLessThanOrEqual(7);
                expect(finder.mock.calls.length - callsAfterOpen).toBe(1);
            });
        });

        test("sim8: a plain empty panel switches to the indexing line when notes get queued", async () => {
            const pending$ = new BehaviorSubject(0);
            const coord = make();
            coord.watchPendingIndexCount(pending$);
            withStatus("ok", []);
            expect(await reasonAfterOpen(coord)).toEqual({ kind: "none" });

            pending$.next(1240);
            let view = await firstValueFrom(coord.getNoteBottomViewModelObservable());
            expect(view.emptyReason).toEqual({ kind: "indexing", remaining: 1240 });

            withStatus("ok", [neighbor(0.9)]);
            pending$.next(0);
            await vi.waitFor(async () => {
                view = await firstValueFrom(coord.getNoteBottomViewModelObservable());
                expect(view.similarNoteEntries).toHaveLength(1);
            });
        });

        test("IR3: only the open note queued keeps the plain line, another note queued switches", async () => {
            const pending$ = new BehaviorSubject(0);
            const queued = new Map<string, number>();
            const coord = make();
            coord.watchPendingIndexCount(pending$, (p) => queued.get(p) ?? 0);
            withStatus("ok", []);
            expect(await reasonAfterOpen(coord)).toEqual({ kind: "none" });

            // Typing in the open note queues it (count 0 to 1): its own
            // indexing never fills its own panel, so the line stays.
            queued.set("open.md", 1);
            pending$.next(1);
            let view = await firstValueFrom(coord.getNoteBottomViewModelObservable());
            expect(view.emptyReason).toEqual({ kind: "none" });
            // Reopening while only the open note is queued: still plain.
            expect(await reasonAfterOpen(coord)).toEqual({ kind: "none" });

            // Another note gets queued (sync, another pane): switch.
            queued.set("other.md", 1);
            pending$.next(2);
            view = await firstValueFrom(coord.getNoteBottomViewModelObservable());
            expect(view.emptyReason).toEqual({ kind: "indexing", remaining: 2 });

            // The other note is indexed, only the open note is left: search
            // again and fall back to the plain line.
            queued.delete("other.md");
            pending$.next(1);
            await vi.waitFor(async () => {
                view = await firstValueFrom(coord.getNoteBottomViewModelObservable());
                expect(view.emptyReason).toEqual({ kind: "none" });
            });
        });

        test("results during indexing show normally (no indexing line)", async () => {
            const pending$ = new BehaviorSubject(50);
            const coord = make();
            coord.watchPendingIndexCount(pending$);
            withStatus("ok", [neighbor(0.9)]);
            expect(await reasonAfterOpen(coord)).toBeUndefined();
        });

        test("nothing found after indexing keeps the plain line", async () => {
            withStatus("ok", []);
            expect(await reasonAfterOpen(make())).toEqual({ kind: "none" });
        });
    });
});

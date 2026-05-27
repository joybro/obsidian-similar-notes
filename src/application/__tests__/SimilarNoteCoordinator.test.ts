import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import type { TFile, Vault } from "obsidian";
import { Subject } from "rxjs";
import { beforeEach, describe, expect, test, vi } from "vitest";
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

// eslint-disable-next-line max-lines-per-function
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
        } as unknown as NoteRepository;

        similarNoteFinder = {
            findSimilarNotes: vi.fn().mockResolvedValue([]),
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
});

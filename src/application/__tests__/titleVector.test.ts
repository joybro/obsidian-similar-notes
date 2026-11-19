import { beforeEach, describe, expect, test, vi } from "vitest";
import { NoteIndexingService } from "../NoteIndexingService";
import { Note } from "@/domain/model/Note";
import { NoteChunk } from "@/domain/model/NoteChunk";
import { TextSearchService } from "@/domain/service/TextSearchService";
import { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import type { NoteChange } from "@/infrastructure/noteChangeQueue";

// Title vector spec (docs/title-vector-spec.md) "Tests" section. Everything
// runs against a stateful in-memory chunk repository, and assertions are on
// the end state of that repository, not on which methods were called.

vi.mock("@/utils/errorHandling", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/utils/errorHandling")>()),
    showNoteErrorNotice: vi.fn(),
}));

// Bag-of-words embedding: one dimension per vocabulary word, L2-normalized,
// so the dot product is cosine similarity.
const vocab = new Map<string, number>();
function embed(text: string): number[] {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const w of words) if (!vocab.has(w)) vocab.set(w, vocab.size);
    const v = new Array(256).fill(0);
    for (const w of words) v[vocab.get(w) as number] += 1;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
}
const dot = (a: number[], b: number[]) =>
    a.reduce((s, x, i) => s + x * b[i], 0);

class InMemoryChunkRepository {
    rows: NoteChunk[] = [];

    async putMulti(chunks: NoteChunk[]) {
        this.rows.push(...chunks);
    }
    async put(chunk: NoteChunk) {
        this.rows.push(chunk);
    }
    async removeByPath(path: string) {
        const before = this.rows.length;
        this.rows = this.rows.filter((r) => r.path !== path);
        return before !== this.rows.length;
    }
    async renamePath(oldPath: string, newPath: string) {
        if (!this.rows.some((r) => r.path === oldPath)) return false;
        this.rows = this.rows.map((r) =>
            r.path === oldPath
                ? new NoteChunk(
                    newPath,
                    r.title,
                    r.content,
                    r.chunkIndex,
                    r.totalChunks,
                    r.embedding
                )
                : r
        );
        return true;
    }
    async getByPath(path: string) {
        return this.rows.filter((r) => r.path === path);
    }
    async findSimilarChunks(
        query: number[],
        limit: number,
        minScore = 0,
        excludePaths: string[] = [],
        options: { bodyChunksOnly?: boolean } = {}
    ) {
        return this.rows
            .filter((r) => !excludePaths.includes(r.path))
            .filter((r) => !options.bodyChunksOnly || r.chunkIndex >= 0)
            .map((chunk) => ({ chunk, score: dot(query, chunk.embedding) }))
            .filter((r) => r.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    async count() {
        return this.rows.filter((r) => r.chunkIndex >= 0).length;
    }
    async getPathsWithoutTitleChunk() {
        const body = new Set(
            this.rows.filter((r) => r.chunkIndex >= 0).map((r) => r.path)
        );
        const titled = new Set(
            this.rows.filter((r) => r.chunkIndex < 0).map((r) => r.path)
        );
        return [...body].filter((p) => !titled.has(p));
    }
}

const embeddingService = {
    embedTexts: vi.fn(async (texts: string[]) => texts.map(embed)),
    embedText: vi.fn(async (text: string) => embed(text)),
    countTokens: vi.fn(async () => 1),
    getMaxTokens: vi.fn(() => 512),
    truncateToMaxTokens: vi.fn(async (t: string) => t),
    supportsParallelProcessing: vi.fn(() => false),
};

// Paragraph splitter standing in for the real chunking service.
const chunkingService = {
    init: vi.fn(),
    split: vi.fn(async (note: Note) => {
        const parts = note.content.split(/\n\n+/).filter(Boolean);
        return parts.map(
            (content, i) =>
                new NoteChunk(note.path, note.title, content, i, parts.length, [])
        );
    }),
};

function makeWorld(files: Record<string, string>) {
    const repo = new InMemoryChunkRepository();
    const queued: NoteChange[] = [];
    const queue = {
        requeue: vi.fn((c: NoteChange) => queued.push(c)),
        enqueue: vi.fn((cs: NoteChange[]) => queued.push(...cs)),
        getFileChangeCount: vi.fn(() => queued.length),
        getIndexableTextHash: vi.fn(() => undefined),
        clearIndexableTextHash: vi.fn(async () => undefined),
        markNoteChangeProcessed: vi.fn(async () => undefined),
    };
    const noteRepository = {
        findByPath: vi.fn(async (path: string) => {
            const content = files[path];
            if (content === undefined) return null;
            const title = path.replace(/^.*\//, "").replace(/\.md$/, "");
            return new Note(path, title, content, []);
        }),
    };
    const service = new NoteIndexingService(
        noteRepository as never,
        repo as never,
        queue as never,
        chunkingService as never,
        embeddingService as never,
        {
            emitNoteBottomViewModelFromPath: vi.fn(),
            refreshCachedNoteMetadataFromPath: vi.fn(async () => true),
        } as never,
        {
            get: () => ({
                includeFrontmatter: false,
                excludeRegexPatterns: [],
                excludeFrontmatterRules: [],
            }),
        } as never,
        {
            workspace: { getActiveFile: () => null },
            vault: { getFileByPath: () => null },
            metadataCache: { getFileCache: () => null },
        } as never,
        {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
        } as never
    );
    const process = (change: NoteChange) =>
        (
            service as unknown as {
                processChange: (c: NoteChange) => Promise<void>;
            }
        ).processChange(change);
    return { repo, queue, queued, service, process };
}

const LONG_BODY =
    "Boil pork with fermented cabbage and tofu in a pot for twenty minutes then add scallion garlic pepper paste and serve hot with rice";

beforeEach(() => {
    vi.clearAllMocks();
});

describe("title vector (title-vector spec)", () => {
    test("a title-fragment query ranks the note first even when its body never mentions the title words", async () => {
        const { repo, process } = makeWorld({
            "Kimchi Jjigae.md": `${LONG_BODY}\n\nSecond paragraph about leftovers`,
            "Fermentation.md": "kimchi kimchi fermentation jar",
        });
        await process({ path: "Kimchi Jjigae.md", reason: "new", mtime: 1 });
        await process({ path: "Fermentation.md", reason: "new", mtime: 1 });

        const search = new TextSearchService(
            repo as never,
            embeddingService as never
        );
        const { similarNotes } = await search.findSimilarNotesFromText(
            "kimchi jjigae"
        );

        expect(similarNotes[0].path).toBe("Kimchi Jjigae.md");
        // A title hit previews the note's first body chunk, not the title.
        expect(similarNotes[0].similarChunk).toBe(LONG_BODY);
    });

    test("panel results for a note are identical with and without title rows", async () => {
        const { repo, process } = makeWorld({
            "Kimchi.md": "kimchi cabbage pepper\n\nfermentation jar salt",
            "Cabbage.md": "cabbage salad dressing",
            "Jar.md": "jar lid salt brine",
            "Kimchi Cabbage Jar.md": "unrelated words about trains",
        });
        for (const path of [
            "Kimchi.md",
            "Cabbage.md",
            "Jar.md",
            "Kimchi Cabbage Jar.md",
        ]) {
            await process({ path, reason: "new", mtime: 1 });
        }
        const finder = new SimilarNoteFinder(
            repo as never,
            chunkingService as never,
            embeddingService as never
        );
        const note = new Note(
            "Kimchi.md",
            "Kimchi",
            "kimchi cabbage pepper\n\nfermentation jar salt",
            []
        );

        const withTitles = await finder.findSimilarNotes(note, 10);
        expect(repo.rows.some((r) => r.chunkIndex < 0)).toBe(true);
        repo.rows = repo.rows.filter((r) => r.chunkIndex >= 0);
        const withoutTitles = await finder.findSimilarNotes(note, 10);

        expect(withTitles).toEqual(withoutTitles);
    });

    test("rename re-embeds only the title row; a folder move re-embeds nothing", async () => {
        const { repo, process } = makeWorld({
            "Old Name.md": "first paragraph\n\nsecond paragraph",
        });
        await process({ path: "Old Name.md", reason: "new", mtime: 1 });
        const bodyBefore = repo.rows
            .filter((r) => r.chunkIndex >= 0)
            .map((r) => r.embedding);

        embeddingService.embedTexts.mockClear();
        embeddingService.embedText.mockClear();
        await process({
            path: "New Name.md",
            oldPath: "Old Name.md",
            reason: "renamed",
            mtime: 1,
        });

        expect(await repo.getByPath("Old Name.md")).toEqual([]);
        const renamed = await repo.getByPath("New Name.md");
        expect(
            renamed.filter((r) => r.chunkIndex >= 0).map((r) => r.embedding)
        ).toEqual(bodyBefore);
        const title = renamed.filter((r) => r.chunkIndex < 0);
        expect(title).toHaveLength(1);
        expect(title[0].content).toBe("New Name");
        expect(title[0].embedding).toEqual(embed("New Name"));
        const embedded = [
            ...embeddingService.embedTexts.mock.calls.flatMap((c) => c[0]),
            ...embeddingService.embedText.mock.calls.map((c) => c[0]),
        ];
        expect(embedded).toEqual(["New Name"]);

        // Folder move: same basename, nothing is embedded, title row carried.
        embeddingService.embedTexts.mockClear();
        embeddingService.embedText.mockClear();
        const rowsBefore = (await repo.getByPath("New Name.md")).map((r) => ({
            ...r,
            path: "dir/New Name.md",
        }));
        await process({
            path: "dir/New Name.md",
            oldPath: "New Name.md",
            reason: "renamed",
            mtime: 1,
        });
        expect(embeddingService.embedTexts).not.toHaveBeenCalled();
        expect(embeddingService.embedText).not.toHaveBeenCalled();
        expect(
            (await repo.getByPath("dir/New Name.md")).map((r) => ({ ...r }))
        ).toEqual(rowsBefore);
    });

    test("backfill queues only notes lacking a title row and embeds only titles", async () => {
        const { repo, queued, service, process } = makeWorld({
            "Legacy.md": "old body one\n\nold body two",
            "Fresh.md": "fresh body",
        });
        // Legacy.md was indexed by a version without title rows.
        repo.rows.push(
            new NoteChunk("Legacy.md", "Legacy", "old body one", 0, 2, embed("Legacy old body one")),
            new NoteChunk("Legacy.md", "Legacy", "old body two", 1, 2, embed("old body two"))
        );
        await process({ path: "Fresh.md", reason: "new", mtime: 1 });
        const freshBefore = await repo.getByPath("Fresh.md");
        const legacyBodyBefore = await repo.getByPath("Legacy.md");

        await service.enqueueTitleBackfill();
        expect(queued).toEqual([{ path: "Legacy.md", reason: "title-backfill" }]);

        embeddingService.embedTexts.mockClear();
        embeddingService.embedText.mockClear();
        for (const change of queued.splice(0)) await process(change);

        const embedded = [
            ...embeddingService.embedTexts.mock.calls.flatMap((c) => c[0]),
            ...embeddingService.embedText.mock.calls.map((c) => c[0]),
        ];
        expect(embedded).toEqual(["Legacy"]);
        const legacy = await repo.getByPath("Legacy.md");
        expect(legacy.filter((r) => r.chunkIndex >= 0)).toEqual(legacyBodyBefore);
        const title = legacy.filter((r) => r.chunkIndex < 0);
        expect(title).toHaveLength(1);
        expect(title[0]).toMatchObject({
            content: "Legacy",
            chunkIndex: -1,
            totalChunks: 2,
            embedding: embed("Legacy"),
        });
        expect(await repo.getByPath("Fresh.md")).toEqual(freshBefore);
        expect(queued).toEqual([]);
    });

    test("index, rename and backfill write the same trimmed title row for a space-padded name", async () => {
        const titleRows = async (repo: InMemoryChunkRepository, path: string) =>
            (await repo.getByPath(path))
                .filter((r) => r.chunkIndex < 0)
                .map((r) => ({ title: r.title, content: r.content, embedding: r.embedding }));
        const expected = (text: string) => [
            { title: text, content: text, embedding: embed(text) },
        ];

        // Index
        const a = makeWorld({ " Padded Name .md": "body text" });
        await a.process({ path: " Padded Name .md", reason: "new", mtime: 1 });
        expect(await titleRows(a.repo, " Padded Name .md")).toEqual(expected("Padded Name"));

        // Rename to another padded name
        await a.process({
            path: " Other Name .md",
            oldPath: " Padded Name .md",
            reason: "renamed",
            mtime: 2,
        });
        expect(await titleRows(a.repo, " Other Name .md")).toEqual(expected("Other Name"));

        // Backfill of a row set indexed before title rows existed
        const b = makeWorld({ " Padded Name .md": "body text" });
        b.repo.rows.push(
            new NoteChunk(" Padded Name .md", " Padded Name ", "body text", 0, 1, embed("body text"))
        );
        await b.service.enqueueTitleBackfill();
        for (const change of b.queued.splice(0)) await b.process(change);
        expect(await titleRows(b.repo, " Padded Name .md")).toEqual(expected("Padded Name"));

        // A second backfill pass finds nothing to do (no re-embed loop)
        await b.service.enqueueTitleBackfill();
        expect(b.queued).toEqual([]);
    });

    test("a whitespace-only name gets no title row on index, rename or backfill", async () => {
        const w = makeWorld({ "   .md": "body text", "Named.md": "other body" });
        await w.process({ path: "   .md", reason: "new", mtime: 1 });
        expect((await w.repo.getByPath("   .md")).filter((r) => r.chunkIndex < 0)).toEqual([]);

        await w.process({ path: "Named.md", reason: "new", mtime: 1 });
        await w.process({ path: "  .md", oldPath: "Named.md", reason: "renamed", mtime: 2 });
        const renamed = await w.repo.getByPath("  .md");
        expect(renamed.filter((r) => r.chunkIndex < 0)).toEqual([]);
        expect(renamed.filter((r) => r.chunkIndex >= 0)).toHaveLength(1);
    });
});

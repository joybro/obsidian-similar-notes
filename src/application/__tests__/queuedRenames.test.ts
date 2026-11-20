import { afterEach, describe, expect, test, vi } from "vitest";
import { TFile } from "obsidian";
import { Note } from "@/domain/model/Note";
import { NoteChunk } from "@/domain/model/NoteChunk";
import { NoteChangeQueue, type NoteChange } from "@/infrastructure/noteChangeQueue";
import { computeIndexableTextHash } from "@/utils/indexableTextHash";
import { NoteIndexingService } from "../NoteIndexingService";

vi.mock("@/utils/errorHandling", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/utils/errorHandling")>()),
    showNoteErrorNotice: vi.fn(),
}));

class ChunkRepository {
    rows: NoteChunk[] = [];
    async getByPath(path: string) { return this.rows.filter((row) => row.path === path); }
    async removeByPath(path: string) {
        const before = this.rows.length;
        this.rows = this.rows.filter((row) => row.path !== path);
        return before !== this.rows.length;
    }
    async renamePath(oldPath: string, newPath: string) {
        if (!this.rows.some((row) => row.path === oldPath)) return false;
        this.rows = this.rows.map((row) => row.path === oldPath
            ? new NoteChunk(newPath, row.title, row.content, row.chunkIndex, row.totalChunks, row.embedding)
            : row);
        return true;
    }
    async putMulti(rows: NoteChunk[]) { this.rows.push(...rows); }
    async count() { return this.rows.filter((row) => row.chunkIndex >= 0).length; }
}

async function makeWorld() {
    vi.useFakeTimers();
    const body = "original body";
    const file = Object.assign(new (TFile as unknown as { new(path: string): TFile })("A.md"), {
        stat: { mtime: 1, ctime: 1, size: body.length },
    });
    const files = new Map([[file.path, { file, content: body }]]);
    const events = new Map<string, (file: TFile, oldPath?: string) => void>();
    const vault = {
        on: (name: string, callback: (file: TFile, oldPath?: string) => void) => {
            events.set(name, callback);
            return {};
        },
        offref: () => undefined,
        getMarkdownFiles: () => [...files.values()].map((entry) => entry.file),
        getFileByPath: (path: string) => files.get(path)?.file ?? null,
    };
    const metadata = new Map<string, { mtime: number; hash?: string }>([
        ["A.md", { mtime: 1, hash: await computeIndexableTextHash(body) }],
    ]);
    const store = {
        getMTime: (path: string) => metadata.get(path)?.mtime,
        getIndexableTextHash: (path: string) => metadata.get(path)?.hash,
        getAllPaths: () => [...metadata.keys()],
        setMetadata: async (path: string, mtime: number, hash?: string) => { metadata.set(path, { mtime, hash }); },
        moveMetadata: async (oldPath: string, path: string, mtime: number, hash?: string) => {
            const previousHash = metadata.get(oldPath)?.hash;
            metadata.delete(oldPath);
            metadata.set(path, { mtime, hash: hash ?? previousHash });
        },
        deleteMTime: async (path: string) => { metadata.delete(path); },
        clearIndexableTextHash: async (path: string) => {
            const entry = metadata.get(path);
            if (entry) metadata.set(path, { mtime: entry.mtime });
        },
    };
    const errors = new Map<string, unknown>();
    const errorStore = {
        get: (path: string) => errors.get(path),
        set: async (path: string, error: unknown) => { errors.set(path, error); },
        delete: async (path: string) => { errors.delete(path); },
    };
    const values = { excludeFolderPatterns: [] as string[], excludeFrontmatterRules: [], excludeRegexPatterns: [], includeFrontmatter: false, indexingDelaySeconds: 1 };
    const settings = { get: () => values };
    const cache = { getFileCache: () => null };
    const queue = new NoteChangeQueue(vault as never, cache as never, store as never, settings as never, errorStore as never);
    const repo = new ChunkRepository();
    const bodyEmbedding = [1, 2, 3];
    repo.rows = [new NoteChunk("A.md", "A", body, 0, 1, bodyEmbedding), NoteChunk.titleChunk("A.md", "A", 1, [4])];
    const embedded: string[] = [];
    const embedding = {
        embedTexts: async (texts: string[]) => { embedded.push(...texts); return texts.map((text) => [text.length]); },
        supportsParallelProcessing: () => false,
    };
    const notes = { findByPath: async (path: string) => {
        const entry = files.get(path);
        return entry ? new Note(path, path.slice(0, -3), entry.content, []) : null;
    } };
    const splitter = { split: async (note: Note) => [new NoteChunk(note.path, note.title, note.content, 0, 1, [])] };
    const app = { vault, metadataCache: cache, workspace: { getActiveFile: () => null } };
    const service = new NoteIndexingService(notes as never, repo as never, queue, splitter as never, embedding as never, {} as never, settings as never, app as never, errorStore as never);
    await queue.initialize();
    const rename = (path: string) => {
        const oldPath = file.path;
        const entry = files.get(oldPath)!;
        files.delete(oldPath);
        file.path = path;
        file.basename = path.slice(0, -3);
        files.set(path, entry);
        events.get("rename")!(file, oldPath);
    };
    const drain = async () => {
        for (let i = 0; i < 30; i++) {
            const [change] = queue.pollFileChanges(1);
            if (!change) return;
            await (service as unknown as { processChange: (change: NoteChange) => Promise<void> }).processChange(change);
        }
        throw new Error("Queue did not drain within 30 changes");
    };
    return { file, files, events, metadata, repo, embedded, bodyEmbedding, rename, drain, values, queue, embedding, service };
}

afterEach(() => { vi.useRealTimers(); });

describe("queued rename sequences", () => {
    test("renaming a failed title update cleans its partially moved intermediate rows", async () => {
        const w = await makeWorld();
        w.rename("B.md");
        const embedTexts = w.embedding.embedTexts;
        w.embedding.embedTexts = async () => { throw new Error("temporary title embedding failure"); };
        const [change] = w.queue.pollFileChanges(1);
        await (w.service as unknown as { processChange: (change: NoteChange) => Promise<void> }).processChange(change);
        expect(w.queue.getFileChangeCount()).toBe(1);
        expect([...new Set(w.repo.rows.map((row) => row.path))]).toEqual(["B.md"]);
        expect([...w.metadata.keys()]).toEqual(["A.md"]);
        w.embedding.embedTexts = embedTexts;
        w.rename("C.md");
        await w.drain();
        expect([...new Set(w.repo.rows.map((row) => row.path))]).toEqual(["C.md"]);
        expect([...w.metadata.keys()]).toEqual(["C.md"]);
        expect(w.repo.rows.filter((row) => row.chunkIndex < 0).map((row) => row.content)).toEqual(["C"]);
    });

    test("consecutive renames preserve the body and update the final title", async () => {
        const w = await makeWorld();
        w.rename("B.md");
        w.rename("C.md");
        await w.drain();
        expect([...new Set(w.repo.rows.map((row) => row.path))]).toEqual(["C.md"]);
        expect([...w.metadata.keys()]).toEqual(["C.md"]);
        const body = w.repo.rows.filter((row) => row.chunkIndex >= 0);
        expect(body).toHaveLength(1);
        expect(body[0].embedding).toEqual(w.bodyEmbedding);
        expect(w.repo.rows.filter((row) => row.chunkIndex < 0).map((row) => row.content)).toEqual(["C"]);
        expect(w.embedded).toEqual(["C"]);
    });

    test("an edit after a queued rename leaves only the updated destination", async () => {
        const w = await makeWorld();
        w.rename("B.md");
        w.files.get("B.md")!.content = "changed body";
        w.file.stat.mtime = 2;
        w.events.get("modify")!(w.file);
        await vi.advanceTimersByTimeAsync(1000);
        await w.drain();
        expect([...new Set(w.repo.rows.map((row) => row.path))]).toEqual(["B.md"]);
        expect([...w.metadata.keys()]).toEqual(["B.md"]);
        expect(w.repo.rows.filter((row) => row.chunkIndex >= 0).map((row) => row.content)).toEqual(["changed body"]);
    });

    test("a deletion after a queued rename removes the original index too", async () => {
        const w = await makeWorld();
        w.rename("B.md");
        w.files.delete("B.md");
        w.events.get("delete")!(w.file);
        await w.drain();
        expect(w.repo.rows).toEqual([]);
        expect([...w.metadata.keys()]).toEqual([]);
    });

    test("an older edit timer cannot replace a newer rename", async () => {
        const w = await makeWorld();
        w.events.get("modify")!(w.file);
        w.rename("B.md");
        await vi.advanceTimersByTimeAsync(1000);
        await w.drain();
        expect([...new Set(w.repo.rows.map((row) => row.path))]).toEqual(["B.md"]);
        expect([...w.metadata.keys()]).toEqual(["B.md"]);
        expect(w.embedded).toEqual(["B"]);
        expect(w.repo.rows.find((row) => row.chunkIndex === 0)?.embedding).toEqual(w.bodyEmbedding);
    });

    test("a queued rename followed by a move to an excluded folder cleans every source", async () => {
        const w = await makeWorld();
        w.values.excludeFolderPatterns = ["excluded/**"];
        w.rename("B.md");
        w.rename("excluded/C.md");
        await w.drain();
        expect(w.repo.rows).toEqual([]);
        expect([...w.metadata.keys()]).toEqual([]);
        expect(w.embedded).toEqual([]);
    });

    test("returning to the original name preserves its body and hash", async () => {
        const w = await makeWorld();
        const hash = w.metadata.get("A.md")?.hash;
        w.rename("B.md");
        w.rename("A.md");
        await w.drain();
        expect([...w.metadata.keys()]).toEqual(["A.md"]);
        expect(w.metadata.get("A.md")?.hash).toBe(hash);
        expect([...new Set(w.repo.rows.map((row) => row.path))]).toEqual(["A.md"]);
        expect(w.repo.rows).toHaveLength(2);
        expect(w.embedded).toEqual([]);
    });

    test("an edited rename chain removes all old paths and indexes the latest body", async () => {
        const w = await makeWorld();
        w.rename("B.md");
        w.files.get("B.md")!.content = "changed body";
        w.file.stat.mtime = 2;
        w.events.get("modify")!(w.file);
        w.rename("C.md");
        await vi.advanceTimersByTimeAsync(1000);
        await w.drain();
        expect([...new Set(w.repo.rows.map((row) => row.path))]).toEqual(["C.md"]);
        expect([...w.metadata.keys()]).toEqual(["C.md"]);
        expect(w.repo.rows.find((row) => row.chunkIndex === 0)?.content).toBe("changed body");
        expect(w.repo.rows.find((row) => row.chunkIndex < 0)?.content).toBe("C");
    });
});

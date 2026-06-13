import type { SimilarNoteCoordinator } from "@/application/SimilarNoteCoordinator";
import type { App, Plugin } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ExportActiveNoteSimilarNotesCommand } from "../ExportActiveNoteSimilarNotesCommand";

// The global test-setup mock only exports TFile/PluginSettingTab; the command
// constructs a Notice, so provide a no-op Notice for this file.
vi.mock("obsidian", () => ({
    Notice: class {},
}));

const PLUGIN_ID = "similar-notes";
const FINAL_PATH = `.obsidian/plugins/${PLUGIN_ID}/agent-similar-notes.json`;
const TMP_PATH = `${FINAL_PATH}.tmp`;

/**
 * In-memory fake of Obsidian's vault DataAdapter. Maintains real file/dir
 * state so tests assert the resulting file content and the write/rename
 * sequence, not just which method was called.
 */
function makeFs() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const adapter = {
        exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
        mkdir: vi.fn(async (p: string) => {
            dirs.add(p);
        }),
        write: vi.fn(async (p: string, data: string) => {
            files.set(p, data);
        }),
        rename: vi.fn(async (from: string, to: string) => {
            if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
            files.set(to, files.get(from) as string);
            files.delete(from);
        }),
        remove: vi.fn(async (p: string) => {
            files.delete(p);
        }),
    };
    return { files, dirs, adapter };
}

type FakeFs = ReturnType<typeof makeFs>;

function makeApp(fs: FakeFs, activeFile: unknown): App {
    return {
        workspace: { getActiveFile: () => activeFile },
        vault: { configDir: ".obsidian", adapter: fs.adapter },
    } as unknown as App;
}

function makeCoordinator(
    getSimilarNotes: (...args: unknown[]) => Promise<unknown>
): SimilarNoteCoordinator {
    return {
        getSimilarNotes: vi.fn(getSimilarNotes),
    } as unknown as SimilarNoteCoordinator;
}

/** Register the command and invoke the palette callback the way Obsidian would. */
async function runCommand(
    app: App,
    coordinator: SimilarNoteCoordinator
): Promise<void> {
    const command = new ExportActiveNoteSimilarNotesCommand(
        app,
        coordinator,
        PLUGIN_ID
    );
    let captured: { callback: () => Promise<void> } | undefined;
    command.register({
        addCommand: (cmd: { callback: () => Promise<void> }) => {
            captured = cmd;
        },
    } as unknown as Plugin);
    if (!captured) throw new Error("command was not registered");
    await captured.callback();
}

function readPayload(fs: FakeFs): Record<string, unknown> {
    return JSON.parse(fs.files.get(FINAL_PATH) as string);
}

describe("ExportActiveNoteSimilarNotesCommand — agent-export JSON contract (docs/agent-export.md)", () => {
    let fs: FakeFs;

    beforeEach(() => {
        fs = makeFs();
    });

    test("active markdown file: ok:true payload carries version, sourcePath, ISO generatedAt", async () => {
        const file = { path: "Notes/Source.md", extension: "md" };
        const coord = makeCoordinator(async () => []);

        await runCommand(makeApp(fs, file), coord);

        const payload = readPayload(fs);
        expect(payload.ok).toBe(true);
        expect(payload.version).toBe(1);
        expect(payload.sourcePath).toBe("Notes/Source.md");
        expect(typeof payload.generatedAt).toBe("string");
        expect(Number.isNaN(Date.parse(payload.generatedAt as string))).toBe(
            false
        );
        expect(payload.results).toEqual([]);
    });

    test("results map coordinator entries to { path, title, score, excerpt }", async () => {
        const file = { path: "Notes/Source.md", extension: "md" };
        const entries = [
            { file: { path: "A.md" }, title: "A", similarity: 0.9, preview: "chunk-a" },
            { file: { path: "B.md" }, title: "B", similarity: 0.5, preview: "chunk-b" },
        ];
        const coord = makeCoordinator(async () => entries);

        await runCommand(makeApp(fs, file), coord);

        expect(readPayload(fs).results).toEqual([
            { path: "A.md", title: "A", score: 0.9, excerpt: "chunk-a" },
            { path: "B.md", title: "B", score: 0.5, excerpt: "chunk-b" },
        ]);
    });

    test("no active file: ok:false with code NO_ACTIVE_FILE, version, generatedAt; search not run", async () => {
        const coord = makeCoordinator(async () => []);

        await runCommand(makeApp(fs, null), coord);

        const payload = readPayload(fs);
        expect(payload.ok).toBe(false);
        expect(payload.code).toBe("NO_ACTIVE_FILE");
        expect(payload.version).toBe(1);
        expect(typeof payload.generatedAt).toBe("string");
        expect(coord.getSimilarNotes).not.toHaveBeenCalled();
    });

    test("non-markdown active file: ok:false with code NO_ACTIVE_FILE", async () => {
        const coord = makeCoordinator(async () => []);

        await runCommand(makeApp(fs, { path: "img.png", extension: "png" }), coord);

        const payload = readPayload(fs);
        expect(payload.ok).toBe(false);
        expect(payload.code).toBe("NO_ACTIVE_FILE");
    });

    test("search failure: ok:false with code SEARCH_FAILED and the error message", async () => {
        const file = { path: "Notes/Source.md", extension: "md" };
        const coord = makeCoordinator(async () => {
            throw new Error("index unavailable");
        });

        await runCommand(makeApp(fs, file), coord);

        const payload = readPayload(fs);
        expect(payload.ok).toBe(false);
        expect(payload.code).toBe("SEARCH_FAILED");
        expect(payload.error).toContain("index unavailable");
        expect(payload.version).toBe(1);
    });

    test("atomic write: payload is written to a temp file, then renamed onto the final path", async () => {
        const file = { path: "Notes/Source.md", extension: "md" };
        const coord = makeCoordinator(async () => []);

        await runCommand(makeApp(fs, file), coord);

        const writePaths = fs.adapter.write.mock.calls.map((c) => c[0]);
        // never written directly to the path agents read
        expect(writePaths).toContain(TMP_PATH);
        expect(writePaths).not.toContain(FINAL_PATH);
        // moved into place atomically
        expect(fs.adapter.rename).toHaveBeenCalledWith(TMP_PATH, FINAL_PATH);
        // net effect: final holds the payload, temp is cleaned up
        expect(fs.files.has(TMP_PATH)).toBe(false);
        expect(fs.files.has(FINAL_PATH)).toBe(true);
    });
});

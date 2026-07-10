import type { SettingsService } from "@/application/SettingsService";
import { Note } from "@/domain/model/Note";
import { NoteChunk } from "@/domain/model/NoteChunk";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import { describe, expect, test, vi } from "vitest";
import { CodeAwareNoteChunkingService } from "../CodeAwareNoteChunkingService";
import { FencedCodeBlockExtractor } from "../FencedCodeBlockExtractor";

function makeService(enabled: boolean) {
    const seen: Note[] = [];
    const delegate: NoteChunkingService = {
        init: vi.fn().mockResolvedValue(undefined),
        split: vi.fn(async (note: Note) => {
            seen.push(note);
            return [
                new NoteChunk(note.path, note.title, note.content, 0, 1, []),
            ];
        }),
    };
    const settingsService = {
        get: () => ({ codeModeEnabled: enabled }),
    } as unknown as SettingsService;
    return {
        seen,
        service: new CodeAwareNoteChunkingService(
            delegate,
            new FencedCodeBlockExtractor(),
            settingsService
        ),
    };
}

describe("CodeAwareNoteChunkingService", () => {
    test("preserves legacy Markdown when Code Mode is disabled", async () => {
        const { service, seen } = makeService(false);
        const markdown = "Before\n```ts\nconst x = 1;\n```\nAfter";

        await service.split(new Note("note.md", "note", markdown, []));

        expect(seen[0].content).toBe(markdown);
    });

    test("removes fenced blocks from the Notes corpus when enabled", async () => {
        const { service, seen } = makeService(true);

        await service.split(
            new Note(
                "note.md",
                "note",
                "Before\n```ts\nconst x = 1;\n```\nAfter",
                []
            )
        );

        expect(seen[0].content).toBe("Before\n\nAfter");
        expect(seen[0].content).not.toContain("const x");
    });
});

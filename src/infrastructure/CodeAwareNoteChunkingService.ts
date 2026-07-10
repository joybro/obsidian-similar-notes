import type { SettingsService } from "@/application/SettingsService";
import type { Note } from "@/domain/model/Note";
import type { NoteChunk } from "@/domain/model/NoteChunk";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import type { FencedCodeBlockExtractor } from "./FencedCodeBlockExtractor";

/** Keeps legacy whole-Markdown chunking unless Code Mode owns fenced blocks. */
export class CodeAwareNoteChunkingService implements NoteChunkingService {
    constructor(
        private readonly delegate: NoteChunkingService,
        private readonly extractor: FencedCodeBlockExtractor,
        private readonly settingsService: SettingsService
    ) {}

    async init(): Promise<void> {
        await this.delegate.init();
    }

    async split(note: Note): Promise<NoteChunk[]> {
        if (!this.settingsService.get().codeModeEnabled) {
            return this.delegate.split(note);
        }

        const { prose } = this.extractor.extract(note.content ?? "");
        return this.delegate.split({ ...note, content: prose });
    }
}

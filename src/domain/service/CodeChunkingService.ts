import type { CodeBlock } from "@/domain/model/CodeBlock";
import type { CodeChunk } from "@/domain/model/CodeChunk";
import type { Note } from "@/domain/model/Note";

export interface CodeChunkingService {
    init(): Promise<void>;

    split(note: Note, codeBlocks: CodeBlock[]): Promise<CodeChunk[]>;
}

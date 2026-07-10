export type FenceCharacter = "`" | "~";

/**
 * A fenced code block extracted from a Markdown note.
 * Line numbers are one-based and include the opening/closing fences.
 */
export interface CodeBlock {
    content: string;
    language: string | null;
    info: string;
    blockIndex: number;
    startLine: number;
    endLine: number;
    fenceCharacter: FenceCharacter;
    fenceLength: number;
    closed: boolean;
}

export interface ExtractedFencedCode {
    prose: string;
    codeBlocks: CodeBlock[];
}

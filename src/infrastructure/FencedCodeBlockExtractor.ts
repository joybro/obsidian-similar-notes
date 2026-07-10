import type {
    CodeBlock,
    ExtractedFencedCode,
    FenceCharacter,
} from "@/domain/model/CodeBlock";

interface SourceLine {
    text: string;
    eol: string;
}

interface OpeningFence {
    indentation: number;
    character: FenceCharacter;
    length: number;
    info: string;
    language: string | null;
}

/** Extract CommonMark-style fenced code blocks without changing other prose. */
export class FencedCodeBlockExtractor {
    extract(markdown: string): ExtractedFencedCode {
        const lines = splitSourceLines(markdown);
        const prose: string[] = [];
        const codeBlocks: CodeBlock[] = [];

        let lineIndex = 0;
        while (lineIndex < lines.length) {
            const opening = parseOpeningFence(lines[lineIndex].text);
            if (!opening) {
                prose.push(lines[lineIndex].text, lines[lineIndex].eol);
                lineIndex++;
                continue;
            }

            const closingIndex = findClosingFence(
                lines,
                lineIndex + 1,
                opening
            );
            const contentEnd = closingIndex ?? lines.length;
            const content = removeFinalLineEnding(
                lines
                    .slice(lineIndex + 1, contentEnd)
                    .map(
                        (line) =>
                            removeUpToSpaces(
                                line.text,
                                opening.indentation
                            ) + line.eol
                    )
                    .join("")
            );

            codeBlocks.push({
                content,
                language: opening.language,
                info: opening.info,
                blockIndex: codeBlocks.length,
                startLine: lineIndex + 1,
                endLine: closingIndex === null ? lines.length : closingIndex + 1,
                fenceCharacter: opening.character,
                fenceLength: opening.length,
                closed: closingIndex !== null,
            });

            // Keep one line break where the block started. This prevents prose
            // on either side of the removed block from being joined together.
            prose.push(lines[lineIndex].eol);
            lineIndex = closingIndex === null ? lines.length : closingIndex + 1;
        }

        return { prose: prose.join(""), codeBlocks };
    }
}

function parseOpeningFence(line: string): OpeningFence | null {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) return null;

    const marker = match[2];
    const character = marker[0] as FenceCharacter;
    const remainder = match[3];

    // CommonMark forbids backticks in a backtick fence's info string.
    if (character === "`" && remainder.includes("`")) return null;

    const info = remainder.trim();
    const language = info ? info.split(/[ \t]+/, 1)[0] : null;

    return {
        indentation: match[1].length,
        character,
        length: marker.length,
        info,
        language,
    };
}

function findClosingFence(
    lines: SourceLine[],
    start: number,
    opening: OpeningFence
): number | null {
    for (let index = start; index < lines.length; index++) {
        if (isClosingFence(lines[index].text, opening)) return index;
    }
    return null;
}

function isClosingFence(line: string, opening: OpeningFence): boolean {
    let index = 0;
    while (index < line.length && index < 3 && line[index] === " ") index++;

    const markerStart = index;
    while (index < line.length && line[index] === opening.character) index++;

    if (index - markerStart < opening.length) return false;
    return /^[ \t]*$/.test(line.slice(index));
}

function removeUpToSpaces(line: string, count: number): string {
    let removed = 0;
    while (removed < count && line[removed] === " ") removed++;
    return line.slice(removed);
}

function removeFinalLineEnding(content: string): string {
    return content.replace(/(?:\r\n|\n|\r)$/, "");
}

function splitSourceLines(source: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let start = 0;
    let index = 0;

    while (index < source.length) {
        if (source[index] !== "\n" && source[index] !== "\r") {
            index++;
            continue;
        }

        const eol =
            source[index] === "\r" && source[index + 1] === "\n"
                ? "\r\n"
                : source[index];
        lines.push({ text: source.slice(start, index), eol });
        index += eol.length;
        start = index;
    }

    if (start < source.length || source.length === 0) {
        lines.push({ text: source.slice(start), eol: "" });
    }

    return lines;
}

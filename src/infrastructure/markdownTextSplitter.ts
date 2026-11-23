// Recursive markdown text splitter.
//
// A line-for-line port of the `splitText` path of LangChain's
// RecursiveCharacterTextSplitter.fromLanguage("markdown") from
// @langchain/textsplitters 0.1.0 (MIT License, Copyright (c) LangChain, Inc.).
// The plugin only ever used that one method, and depending on the package
// pulled @langchain/core, langsmith and zod into the bundle. The port must keep
// chunk boundaries byte-identical to the library so existing indexes stay
// valid: src/infrastructure/__tests__/markdownTextSplitter.test.ts pins it
// against outputs recorded from the library (docs/markdown-splitter-spec.md).

export type LengthFunction = (text: string) => number | Promise<number>;

export interface MarkdownTextSplitterOptions {
    chunkSize: number;
    chunkOverlap: number;
    lengthFunction?: LengthFunction;
}

// Separators tried in order: headings from level 2, end of a code block,
// horizontal rules, then paragraphs, lines, words and finally characters.
export const MARKDOWN_SEPARATORS: readonly string[] = [
    "\n## ",
    "\n### ",
    "\n#### ",
    "\n##### ",
    "\n###### ",
    "```\n\n",
    "\n\n***\n\n",
    "\n\n---\n\n",
    "\n\n___\n\n",
    "\n\n",
    "\n",
    " ",
    "",
];

export class MarkdownTextSplitter {
    private readonly chunkSize: number;
    private readonly chunkOverlap: number;
    private readonly lengthFunction: LengthFunction;

    constructor(options: MarkdownTextSplitterOptions) {
        this.chunkSize = options.chunkSize;
        this.chunkOverlap = options.chunkOverlap;
        this.lengthFunction =
            options.lengthFunction ?? ((text: string) => text.length);
        if (this.chunkOverlap >= this.chunkSize) {
            throw new Error("Cannot have chunkOverlap >= chunkSize");
        }
    }

    async splitText(text: string): Promise<string[]> {
        return this.splitRecursive(text, MARKDOWN_SEPARATORS);
    }

    private async splitRecursive(
        text: string,
        separators: readonly string[]
    ): Promise<string[]> {
        const finalChunks: string[] = [];

        // Pick the first separator present in the text; "" always matches.
        let separator = separators[separators.length - 1];
        let newSeparators: readonly string[] | undefined;
        for (let i = 0; i < separators.length; i += 1) {
            const s = separators[i];
            if (s === "") {
                separator = s;
                break;
            }
            if (text.includes(s)) {
                separator = s;
                newSeparators = separators.slice(i + 1);
                break;
            }
        }

        const splits = splitKeepingSeparator(text, separator);

        // Merge small pieces; recurse into pieces that are still too long.
        // Separators are kept on the pieces, so merging joins with "".
        let goodSplits: string[] = [];
        for (const s of splits) {
            // `<` vs `<=` differs only for a piece exactly chunkSize long whose
            // sub-pieces' lengths do not add up to it (a tokenizer can do that);
            // the fixtures never hit it, so keep the library's `<` verbatim.
            if ((await this.lengthFunction(s)) < this.chunkSize) {
                goodSplits.push(s);
            } else {
                if (goodSplits.length) {
                    finalChunks.push(...(await this.mergeSplits(goodSplits)));
                    goodSplits = [];
                }
                if (!newSeparators) {
                    finalChunks.push(s);
                } else {
                    finalChunks.push(
                        ...(await this.splitRecursive(s, newSeparators))
                    );
                }
            }
        }
        if (goodSplits.length) {
            finalChunks.push(...(await this.mergeSplits(goodSplits)));
        }
        return finalChunks;
    }

    // Packs pieces into chunks of at most chunkSize, carrying up to
    // chunkOverlap of the previous chunk's tail into the next one.
    private async mergeSplits(splits: string[]): Promise<string[]> {
        const docs: string[] = [];
        const currentDoc: string[] = [];
        let total = 0;
        for (const d of splits) {
            const len = await this.lengthFunction(d);
            if (total + len > this.chunkSize) {
                if (currentDoc.length > 0) {
                    const doc = joinDocs(currentDoc);
                    if (doc !== null) {
                        docs.push(doc);
                    }
                    // Drop from the front while the carried tail is longer
                    // than the overlap, or while the next piece would not fit.
                    while (
                        total > this.chunkOverlap ||
                        (total + len > this.chunkSize && total > 0)
                    ) {
                        total -= await this.lengthFunction(currentDoc[0]);
                        currentDoc.shift();
                    }
                }
            }
            currentDoc.push(d);
            total += len;
        }
        const doc = joinDocs(currentDoc);
        if (doc !== null) {
            docs.push(doc);
        }
        return docs;
    }
}

function joinDocs(docs: string[]): string | null {
    const text = docs.join("").trim();
    return text === "" ? null : text;
}

// Splits before each occurrence of the separator so every piece but the first
// starts with it; "" splits into single UTF-16 code units, as String.split does.
function splitKeepingSeparator(text: string, separator: string): string[] {
    let splits: string[];
    if (separator) {
        const escaped = separator.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");
        splits = text.split(new RegExp(`(?=${escaped})`));
    } else {
        splits = text.split("");
    }
    return splits.filter((s) => s !== "");
}

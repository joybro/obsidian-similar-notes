// Deterministic markdown generator for the splitter equivalence fixtures.
// Changing anything here changes the recorded inputs: re-record the fixture
// (docs/markdown-splitter-spec.md) instead of editing expected hashes by hand.

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const WORDS = [
    "note",
    "vault",
    "embedding",
    "similar",
    "graph",
    "link",
    "the",
    "a",
    "of",
    "검색",
    "노트",
    "비슷한",
    "メモ",
    "😀",
    "supercalifragilisticexpialidocious",
    "x".repeat(140),
    "[[Wiki Link]]",
    "**bold**",
    "`code`",
    "#tag",
];

const pick = <T>(r: () => number, xs: readonly T[]): T =>
    xs[Math.floor(r() * xs.length)];

function sentence(r: () => number): string {
    const n = 1 + Math.floor(r() * 18);
    return Array.from({ length: n }, () => pick(r, WORDS)).join(" ");
}

function paragraph(r: () => number): string {
    const n = 1 + Math.floor(r() * 5);
    // Mix single newlines inside a paragraph with plain spaces.
    return Array.from({ length: n }, () => sentence(r)).join(
        r() < 0.3 ? "\n" : " "
    );
}

function block(r: () => number): string {
    const k = r();
    if (k < 0.15) return `${"#".repeat(1 + Math.floor(r() * 6))} ${sentence(r)}`;
    if (k < 0.25) return "```js\n" + paragraph(r) + "\n```";
    if (k < 0.32) return pick(r, ["***", "---", "___"]);
    if (k < 0.4)
        return Array.from({ length: 1 + Math.floor(r() * 4) }, () =>
            `- ${sentence(r)}`
        ).join("\n");
    if (k < 0.43) return "   "; // whitespace-only block
    return paragraph(r);
}

export function markdownDoc(seed: number): string {
    const r = mulberry32(seed);
    const n = Math.floor(r() * 30);
    const parts = Array.from({ length: n }, () => block(r));
    const joined = parts.join(r() < 0.8 ? "\n\n" : "\n");
    return r() < 0.3 ? `\n${joined}\n` : joined;
}

// Token-length stand-ins: plain characters, and a word-ish async count closer
// to how a tokenizer grows (the real service counts model tokens).
export const LENGTH_FUNCTIONS = {
    chars: (t: string) => t.length,
    words: async (t: string) =>
        t.split(/\s+/).filter((w) => w !== "").length +
        Math.floor(t.length / 16),
} as const;

export type LengthName = keyof typeof LENGTH_FUNCTIONS;

export interface SplitCase {
    seed: number;
    chunkSize: number;
    chunkOverlap: number;
    length: LengthName;
}

export function splitCases(): SplitCase[] {
    const params: Array<[number, number, LengthName]> = [
        [512, 100, "chars"],
        [120, 100, "chars"],
        [60, 20, "chars"],
        [256, 100, "words"],
        [40, 10, "words"],
    ];
    const cases: SplitCase[] = [];
    for (let seed = 1; seed <= 40; seed += 1) {
        for (const [chunkSize, chunkOverlap, length] of params) {
            cases.push({ seed, chunkSize, chunkOverlap, length });
        }
    }
    return cases;
}

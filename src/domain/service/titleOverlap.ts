/**
 * Title overlap bonus for text queries (docs/title-vector-spec.md, "Title
 * overlap bonus"): a title row's ranking key is its similarity plus
 * TITLE_OVERLAP_WEIGHT * titleOverlap(query, title). Body rows and the panel
 * are not affected.
 */
export const TITLE_OVERLAP_WEIGHT = 0.1;

function words(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1);
}

function bigrams(text: string): string[] {
    const out: string[] = [];
    for (const w of words(text)) {
        // Array.from splits by code point, so surrogate pairs stay whole.
        const chars = Array.from(w);
        for (let k = 0; k + 1 < chars.length; k++) {
            out.push(chars[k] + chars[k + 1]);
        }
    }
    return out;
}

/**
 * Share (0..1) of the query's in-word character bigrams that also occur in
 * the title. Bigrams rather than whole words, so a fragment with a particle
 * attached or a word still being typed keeps its overlap.
 */
export function titleOverlap(query: string, title: string): number {
    const q = bigrams(query);
    if (q.length === 0) {
        return 0;
    }
    const t = new Set(bigrams(title));
    return q.filter((b) => t.has(b)).length / q.length;
}

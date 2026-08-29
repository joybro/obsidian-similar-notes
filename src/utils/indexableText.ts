import log from "loglevel";

/**
 * Applies the user's exclude-RegExp patterns to note content, producing the
 * exact text that gets chunked, embedded, and hashed (indexable-text-hash-spec).
 * Single owner of that transformation: the indexing pipeline and the settings
 * tester preview must both go through it, so the preview always shows what will
 * really be indexed. If the transformation ever changes shape, bump
 * HASH_VERSION in indexableTextHash.ts.
 *
 * Invalid patterns are skipped individually — indexing must not drop a whole
 * note over one bad pattern. Callers can observe skips via onInvalidPattern.
 */
export function applyExclusionPatterns(
    content: string,
    patterns: string[],
    onInvalidPattern?: (pattern: string, error: unknown) => void
): string {
    let result = content;
    for (const pattern of patterns) {
        try {
            result = result.replace(new RegExp(pattern, "gm"), "");
        } catch (error) {
            log.warn(`Invalid RegExp pattern: ${pattern}`, error);
            onInvalidPattern?.(pattern, error);
        }
    }
    return result;
}

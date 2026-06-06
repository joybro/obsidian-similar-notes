export interface TriggerMatch {
    /** Text typed after the trigger, up to the cursor. */
    query: string;
    /** Character offset on the line where the trigger starts. */
    startCh: number;
}

/**
 * Parse the part of the editor line up to the cursor for the semantic-link
 * trigger. Returns the query (text after the last trigger occurrence) and the
 * trigger's start offset, or null when the feature is disabled / the trigger is
 * absent.
 *
 * A trigger starting with '[' is rejected so it can never re-collide with
 * Obsidian's built-in `[[` link suggester (which is index 0 and always wins).
 */
export function parseTrigger(
    lineUpToCursor: string,
    trigger: string
): TriggerMatch | null {
    if (!trigger || trigger.startsWith("[")) return null;

    const idx = lineUpToCursor.lastIndexOf(trigger);
    if (idx === -1) return null;

    return {
        query: lineUpToCursor.slice(idx + trigger.length),
        startCh: idx,
    };
}

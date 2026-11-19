import log from "loglevel";

/**
 * Runs a promise fire-and-forget while still handling its rejection: the
 * failure is logged with context instead of surfacing as an unhandled
 * rejection. Use where the caller cannot (or should not) await, such as
 * Obsidian event callbacks and UI click handlers.
 */
export function logRejection(promise: Promise<unknown>, context: string): void {
    promise.catch((error: unknown) => {
        log.error(`[Similar Notes] ${context}:`, error);
    });
}

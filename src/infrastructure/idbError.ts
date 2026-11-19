/**
 * IndexedDB exposes `request.error` / `transaction.error` as
 * `DOMException | null`. Promises in this plugin always reject with an
 * Error, so a missing error (null) becomes a plain Error with a message.
 */
export function idbError(
    error: DOMException | null,
    fallback = "IndexedDB operation failed"
): Error {
    return error ?? new Error(fallback);
}

/** Wraps a non-Error thrown value so a promise rejects with an Error. */
export function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/**
 * onnxruntime-web's WASM backend aborts by throwing a bare **number** (a heap
 * pointer), not an Error. Surfaced raw, that number is what users saw in the
 * errored-files list ("8934496") and in bug reports — meaningless on its own.
 *
 * Normalize such a throw into a real Error with an actionable message; pass real
 * Errors through unchanged. Kept obsidian-free so the worker can import it
 * without pulling the Obsidian API into the worker bundle.
 */
export function normalizeWasmError(error: unknown): Error {
    if (typeof error === "number") {
        return new Error(
            `Embedding failed: the on-device model crashed in the WASM runtime ` +
                `(code ${error}). This usually means it could not run in this ` +
                `environment — a SharedArrayBuffer/threading restriction or out ` +
                `of memory. Try enabling GPU acceleration in settings, or switch ` +
                `to Ollama.`
        );
    }
    return error instanceof Error ? error : new Error(String(error));
}

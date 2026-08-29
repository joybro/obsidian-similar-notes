const HASH_VERSION = "v1";

/**
 * Hash effective indexable text after exclusions and before chunking.
 */
export async function computeIndexableTextHash(text: string): Promise<string> {
    const encoded = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    const hex = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("");

    return `${HASH_VERSION}:${hex}`;
}

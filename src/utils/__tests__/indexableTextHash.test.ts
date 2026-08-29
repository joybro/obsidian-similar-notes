import { describe, expect, it } from "vitest";
import { computeIndexableTextHash } from "../indexableTextHash";

describe("computeIndexableTextHash", () => {
    it("returns a versioned SHA-256 hex digest", async () => {
        await expect(computeIndexableTextHash("hello")).resolves.toBe(
            "v1:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    });

    it("hashes empty text exactly", async () => {
        await expect(computeIndexableTextHash("")).resolves.toBe(
            "v1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    });

    it("does not normalize indexable text", async () => {
        const plain = await computeIndexableTextHash("note");
        const trailingNewline = await computeIndexableTextHash("note\n");

        expect(trailingNewline).not.toBe(plain);
    });
});

import { describe, expect, test, vi } from "vitest";
import { applyExclusionPatterns } from "../indexableText";

describe("applyExclusionPatterns — canonical indexable-text transformation (indexable-text-hash-spec, #51)", () => {
    test("applies each pattern with gm flags in order", () => {
        expect(
            applyExclusionPatterns("keep\nsecret: hidden\nkeep2", [
                "^secret:.*$",
            ])
        ).toBe("keep\n\nkeep2");
    });

    test("returns content unchanged with no patterns", () => {
        expect(applyExclusionPatterns("abc", [])).toBe("abc");
    });

    test("skips an invalid pattern but still applies the rest (indexing and preview must agree)", () => {
        const onInvalid = vi.fn();
        const result = applyExclusionPatterns(
            "aaa bbb",
            ["[invalid", "bbb"],
            onInvalid
        );
        expect(result).toBe("aaa ");
        expect(onInvalid).toHaveBeenCalledTimes(1);
        expect(onInvalid.mock.calls[0][0]).toBe("[invalid");
    });
});

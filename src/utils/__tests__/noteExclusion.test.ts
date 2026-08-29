import { describe, expect, it } from "vitest";
import { isNoteExcluded, noteExclusionSource } from "../noteExclusion";

const settings = {
    excludeFolderPatterns: ["Templates/"],
    excludeFrontmatterRules: ["tags: noindex"],
};

const frontmatterByPath: Record<string, Record<string, unknown>> = {
    "Diary/secret.md": { tags: ["noindex"] },
    "Templates/tagged.md": { tags: ["noindex"] },
};

const getFrontmatter = (path: string) => frontmatterByPath[path];

describe("noteExclusionSource (frontmatter-exclusion spec §3)", () => {
    it("returns 'path' for a glob-matched file", () => {
        expect(
            noteExclusionSource("Templates/Daily.md", settings, getFrontmatter)
        ).toBe("path");
    });

    it("returns 'frontmatter' for a rule-matched file", () => {
        expect(
            noteExclusionSource("Diary/secret.md", settings, getFrontmatter)
        ).toBe("frontmatter");
    });

    it("returns null for an included file", () => {
        expect(
            noteExclusionSource("Notes/plain.md", settings, getFrontmatter)
        ).toBeNull();
    });

    it("prefers 'path' when both sources match", () => {
        expect(
            noteExclusionSource("Templates/tagged.md", settings, getFrontmatter)
        ).toBe("path");
    });
});

describe("isNoteExcluded (frontmatter-exclusion spec §3)", () => {
    it("is true for either exclusion source", () => {
        expect(
            isNoteExcluded("Templates/Daily.md", settings, getFrontmatter)
        ).toBe(true);
        expect(
            isNoteExcluded("Diary/secret.md", settings, getFrontmatter)
        ).toBe(true);
        expect(
            isNoteExcluded("Notes/plain.md", settings, getFrontmatter)
        ).toBe(false);
    });
});

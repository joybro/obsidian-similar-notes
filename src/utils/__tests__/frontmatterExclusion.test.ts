import { describe, expect, it } from "vitest";
import { shouldExcludeByFrontmatter } from "../frontmatterExclusion";

describe("Bare key rule: exists and not false/null (frontmatter-exclusion spec §1)", () => {
    it("excludes when the property exists with a truthy value", () => {
        expect(
            shouldExcludeByFrontmatter({ noindex: true }, ["noindex"])
        ).toBe(true);
    });

    it("does not exclude when the property is absent", () => {
        expect(shouldExcludeByFrontmatter({ other: 1 }, ["noindex"])).toBe(
            false
        );
    });

    it("does not exclude when the property is false", () => {
        expect(
            shouldExcludeByFrontmatter({ noindex: false }, ["noindex"])
        ).toBe(false);
    });

    it("does not exclude when the property is null", () => {
        expect(
            shouldExcludeByFrontmatter({ noindex: null }, ["noindex"])
        ).toBe(false);
    });

    it("handles missing frontmatter", () => {
        expect(shouldExcludeByFrontmatter(undefined, ["noindex"])).toBe(false);
    });
});

describe("key: value rule: scalar equality as strings (frontmatter-exclusion spec §1)", () => {
    it("matches a string value", () => {
        expect(
            shouldExcludeByFrontmatter({ status: "draft" }, ["status: draft"])
        ).toBe(true);
    });

    it("matches boolean false against rule value 'false'", () => {
        expect(
            shouldExcludeByFrontmatter({ embed: false }, ["embed: false"])
        ).toBe(true);
    });

    it("does not match a different value", () => {
        expect(
            shouldExcludeByFrontmatter({ embed: true }, ["embed: false"])
        ).toBe(false);
    });

    it("matches a number value as string", () => {
        expect(
            shouldExcludeByFrontmatter({ priority: 3 }, ["priority: 3"])
        ).toBe(true);
    });

    it("splits on the first colon only, so values containing ':' work", () => {
        expect(
            shouldExcludeByFrontmatter({ source: "a:b" }, ["source: a:b"])
        ).toBe(true);
    });
});

describe("key: value rule: list containment (frontmatter-exclusion spec §1)", () => {
    it("matches when the list contains the value", () => {
        expect(
            shouldExcludeByFrontmatter(
                { categories: ["[[Work]]", "[[Private]]"] },
                ["categories: [[Private]]"]
            )
        ).toBe(true);
    });

    it("does not match when the list lacks the value", () => {
        expect(
            shouldExcludeByFrontmatter({ categories: ["[[Work]]"] }, [
                "categories: [[Private]]",
            ])
        ).toBe(false);
    });
});

describe("Quoted rule values are unwrapped (frontmatter-exclusion spec §1)", () => {
    it("matches a rule value wrapped in double quotes", () => {
        expect(
            shouldExcludeByFrontmatter({ categories: ["[[Private]]"] }, [
                'categories: "[[Private]]"',
            ])
        ).toBe(true);
    });
});

describe("tags normalization: leading # stripped, case-insensitive (frontmatter-exclusion spec §1)", () => {
    it("matches a frontmatter tag written with a leading #", () => {
        expect(
            shouldExcludeByFrontmatter({ tags: ["#NoIndex"] }, [
                "tags: noindex",
            ])
        ).toBe(true);
    });

    it("matches the singular 'tag' key", () => {
        expect(
            shouldExcludeByFrontmatter({ tag: "noindex" }, ["tag: noindex"])
        ).toBe(true);
    });

    it("does not normalize # for non-tag keys", () => {
        expect(
            shouldExcludeByFrontmatter({ topic: "#noindex" }, [
                "topic: noindex",
            ])
        ).toBe(false);
    });
});

describe("Rule list handling (frontmatter-exclusion spec §1)", () => {
    it("excludes when any rule matches", () => {
        expect(
            shouldExcludeByFrontmatter({ tags: ["noindex"] }, [
                "embed: false",
                "tags: noindex",
            ])
        ).toBe(true);
    });

    it("ignores blank rule lines", () => {
        expect(shouldExcludeByFrontmatter({ a: 1 }, ["", "  "])).toBe(false);
    });

    it("returns false with no rules", () => {
        expect(shouldExcludeByFrontmatter({ noindex: true }, [])).toBe(false);
    });
});

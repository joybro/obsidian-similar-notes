import { describe, it, expect } from "vitest";
import { parseTrigger } from "../semanticLinkTrigger";

describe("parseTrigger (spec item 1: trigger parsing)", () => {
    it("matches the trigger at the start and returns the query + start offset", () => {
        expect(parseTrigger(";;abc", ";;")).toEqual({ query: "abc", startCh: 0 });
    });

    it("uses the LAST trigger occurrence on the line", () => {
        expect(parseTrigger("text ab;;cd", ";;")).toEqual({ query: "cd", startCh: 7 });
    });

    it("keeps spaces in the query (multi-word descriptions)", () => {
        expect(parseTrigger(";;book with zombie", ";;")).toEqual({
            query: "book with zombie",
            startCh: 0,
        });
    });

    it("returns a match with an empty query right after the trigger", () => {
        expect(parseTrigger(";;", ";;")).toEqual({ query: "", startCh: 0 });
    });

    it("returns null when the trigger is absent", () => {
        expect(parseTrigger("no trigger here", ";;")).toBeNull();
    });

    it("supports a custom trigger string", () => {
        expect(parseTrigger("@@hi", "@@")).toEqual({ query: "hi", startCh: 0 });
    });

    it("returns null for an empty trigger (feature disabled)", () => {
        expect(parseTrigger("anything", "")).toBeNull();
    });

    it("returns null for a trigger starting with '[' (would collide with [[)", () => {
        expect(parseTrigger("[[abc", "[[")).toBeNull();
    });
});

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("obsidian", () => ({
    EditorSuggest: class {
        app: unknown;
        context: unknown = null;
        constructor(app: unknown) {
            this.app = app;
        }
    },
    // Minimal trailing-debounce mock: each call resets the timer and only the
    // last invocation's args run, mirroring Obsidian's debounce(fn, ms, true).
    debounce: (fn: (...args: never[]) => void, timeout: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lastArgs: never[];
        const debounced = (...args: never[]) => {
            lastArgs = args;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => fn(...lastArgs), timeout);
        };
        debounced.cancel = () => {
            if (timer) clearTimeout(timer);
        };
        debounced.run = () => undefined;
        return debounced;
    },
    TFile: class TFile {
        path: string;
        basename: string;
        constructor(path = "") {
            this.path = path;
            this.basename = path.replace(/\.md$/, "");
        }
    },
}));

import { TFile } from "obsidian";
import { SimilarNote } from "@/domain/model/SimilarNote";
import {
    SemanticLinkSuggest,
    DEBOUNCE_MS,
    MIN_SEARCH_LENGTH,
} from "../SemanticLinkSuggest";

function makeNote(title: string): SimilarNote {
    return new SimilarNote(title, `${title}.md`, 0.9, "", title);
}

function makeSuggest(opts: {
    trigger?: string;
    service?: unknown;
    app?: unknown;
} = {}) {
    const settingsService = {
        get: () => ({ semanticLinkTrigger: opts.trigger ?? ";;" }),
    };
    return new SemanticLinkSuggest(
        (opts.app ?? {}) as never,
        (opts.service ?? {}) as never,
        settingsService as never
    );
}

afterEach(() => {
    vi.useRealTimers();
});

describe("SemanticLinkSuggest.onTrigger (spec item 1)", () => {
    it("triggers on the configured prefix and returns the query + range", () => {
        const suggest = makeSuggest({ trigger: ";;" });
        const editor = { getLine: () => ";;frank" };
        const info = suggest.onTrigger({ line: 2, ch: 7 } as never, editor as never, null);
        expect(info).toEqual({
            start: { line: 2, ch: 0 },
            end: { line: 2, ch: 7 },
            query: "frank",
        });
    });

    it("returns null when the trigger is disabled (empty)", () => {
        const suggest = makeSuggest({ trigger: "" });
        const editor = { getLine: () => "anything" };
        expect(
            suggest.onTrigger({ line: 0, ch: 8 } as never, editor as never, null)
        ).toBeNull();
    });
});

describe("SemanticLinkSuggest.getSuggestions (spec item 2)", () => {
    it("returns [] without searching below the minimum query length", async () => {
        const service = { findSimilarNotesFromText: vi.fn() };
        const suggest = makeSuggest({ service });
        const short = "a".repeat(MIN_SEARCH_LENGTH - 1);
        expect(await suggest.getSuggestions({ query: short } as never)).toEqual([]);
        expect(service.findSimilarNotesFromText).not.toHaveBeenCalled();
    });

    it("debounces then resolves with the service's similarNotes for a valid query", async () => {
        vi.useFakeTimers();
        const notes = [makeNote("Frankenstein")];
        const service = {
            findSimilarNotesFromText: vi.fn(async () => ({
                similarNotes: notes,
                tokenCount: 0,
                maxTokens: 0,
                isOverLimit: false,
            })),
        };
        const suggest = makeSuggest({ service });
        const p = suggest.getSuggestions({ query: "frank" } as never);
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        expect(await p).toBe(notes);
        expect(service.findSimilarNotesFromText).toHaveBeenCalledWith("frank");
    });

    it("cancels the superseded search and only runs the latest query", async () => {
        vi.useFakeTimers();
        const service = {
            findSimilarNotesFromText: vi.fn(async (q: string) => ({
                similarNotes: [makeNote(q)],
                tokenCount: 0,
                maxTokens: 0,
                isOverLimit: false,
            })),
        };
        const suggest = makeSuggest({ service });
        // The superseded call's promise is intentionally never resolved.
        void suggest.getSuggestions({ query: "frank" } as never);
        const latest = suggest.getSuggestions({ query: "franke" } as never);
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

        expect((await latest).map((n) => n.title)).toEqual(["franke"]);
        expect(service.findSimilarNotesFromText).toHaveBeenCalledTimes(1);
        expect(service.findSimilarNotesFromText).toHaveBeenCalledWith("franke");
    });
});

describe("SemanticLinkSuggest.selectSuggestion (spec item: insert)", () => {
    it("replaces the trigger range with the resolved wikilink + trailing space", () => {
        const replaceRange = vi.fn();
        const setCursor = vi.fn();
        const app = {
            vault: {
                getAbstractFileByPath: (p: string) => new TFile(p),
            },
            metadataCache: { fileToLinktext: () => "Frankenstein" },
        };
        const suggest = makeSuggest({ app });
        suggest.context = {
            editor: { replaceRange, setCursor },
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 7 },
            file: { path: "src.md" },
            query: "frank",
        } as never;

        suggest.selectSuggestion(
            new SimilarNote("Frankenstein", "Frankenstein.md", 0.9, "", ""),
            {} as never
        );

        expect(replaceRange).toHaveBeenCalledWith(
            "[[Frankenstein]] ",
            { line: 0, ch: 0 },
            { line: 0, ch: 7 }
        );
    });
});

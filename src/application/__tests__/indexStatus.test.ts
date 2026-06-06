import { describe, expect, test } from "vitest";
import { computeIndexStatus, visibleErroredEntries } from "../indexStatus";

describe("computeIndexStatus (indexing-status spec §3)", () => {
    const all = ["a.md", "b.md", "c.md", "d.md", "e.md"];

    test("Excluded counts only glob-excluded files, not errored/pending (#46-A regression)", () => {
        // a.md excluded by glob; b.md errored; c.md indexed; d.md & e.md pending
        const status = computeIndexStatus(all, ["a.md"], ["c.md"], ["b.md"]);
        expect(status.excluded).toBe(1); // only the glob match — NOT total - indexed
        expect(status.errored).toBe(1);
        expect(status.indexed).toBe(1);
        expect(status.pending).toBe(2);
    });

    test("the four buckets plus total are consistent (sum to total)", () => {
        const status = computeIndexStatus(all, ["a.md"], ["c.md"], ["b.md"]);
        expect(status.total).toBe(5);
        expect(
            status.excluded + status.errored + status.indexed + status.pending
        ).toBe(5);
    });

    test("precedence excluded > errored: a file that is both excluded and errored counts as Excluded", () => {
        const status = computeIndexStatus(all, ["b.md"], [], ["b.md"]);
        expect(status.excluded).toBe(1);
        expect(status.errored).toBe(0); // b.md absorbed by the higher-precedence Excluded bucket
    });

    test("precedence errored > indexed: a previously-indexed file that errored counts as Errored, not Indexed", () => {
        // c.md is in BOTH the indexed set (stale embedding kept) and the errored set
        const status = computeIndexStatus(all, [], ["c.md"], ["c.md"]);
        expect(status.errored).toBe(1);
        expect(status.indexed).toBe(0);
    });

    test("empty vault yields all-zero counts", () => {
        const status = computeIndexStatus([], [], [], []);
        expect(status).toEqual({
            total: 0,
            excluded: 0,
            errored: 0,
            indexed: 0,
            pending: 0,
        });
    });
});

describe("visibleErroredEntries — errored list mirrors the count's precedence", () => {
    const entries = {
        "Excalidraw/Monzo.md": { error: "too big" },
        "Notes/a.md": { error: "boom" },
        "Notes/gone.md": { error: "boom" },
    };

    test("drops errored entries for now-excluded paths (so list matches 'Errored: N' stat)", () => {
        const vaultPaths = [
            "Excalidraw/Monzo.md",
            "Notes/a.md",
            "Notes/gone.md",
        ];
        const visible = visibleErroredEntries(entries, vaultPaths, [
            "Excalidraw/",
        ]);
        expect(Object.keys(visible)).toEqual(["Notes/a.md", "Notes/gone.md"]);
    });

    test("drops errored entries for paths no longer in the vault", () => {
        // "Notes/gone.md" was deleted — not in vaultPaths anymore.
        const vaultPaths = ["Excalidraw/Monzo.md", "Notes/a.md"];
        const visible = visibleErroredEntries(entries, vaultPaths, []);
        expect(Object.keys(visible)).toEqual([
            "Excalidraw/Monzo.md",
            "Notes/a.md",
        ]);
    });

    test("keeps a genuinely errored, included, present file", () => {
        const visible = visibleErroredEntries(
            { "Notes/a.md": { error: "boom" } },
            ["Notes/a.md"],
            ["Excalidraw/"]
        );
        expect(Object.keys(visible)).toEqual(["Notes/a.md"]);
    });
});

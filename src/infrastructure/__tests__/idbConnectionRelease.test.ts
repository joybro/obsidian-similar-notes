import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IndexedDBChunkStorage } from "../IndexedDBChunkStorage";
import { IndexedDBErroredStorage } from "../IndexedDBErroredStorage";
import { IndexedDBMTimeStorage } from "../IndexedDBMTimeStorage";

// An instance of the plugin that was turned off may still hold its
// connections (Obsidian keeps an open sidebar view, and with it the old
// instance, alive). A connection that ignores "versionchange" blocks a
// deleteDatabase or a version upgrade, and every later open queues behind
// the blocked request, so the next instance never finishes loading.
const storages = [
    ["chunks", "similar-notes", () => new IndexedDBChunkStorage()],
    ["mtimes", "similar-notes-mtimes", () => new IndexedDBMTimeStorage()],
    ["errored notes", "similar-notes-errored", () => new IndexedDBErroredStorage()],
] as const;

let sequence = 0;

const within = <T>(promise: Promise<T>, ms = 1000): Promise<T | "timed out"> =>
    Promise.race([
        promise,
        new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), ms)),
    ]);

describe.each(storages)("the %s database connection", (_label, suffix, create) => {
    it("gives way to a deleteDatabase while it is still open", async () => {
        const vaultId = `release-${sequence++}`;
        const old = create();
        await old.init(vaultId);
        const deleted = new Promise<string>((resolve) => {
            const request = indexedDB.deleteDatabase(`${vaultId}-${suffix}`);
            request.onsuccess = () => resolve("deleted");
            request.onerror = () => resolve("error");
        });
        expect(await within(deleted)).toBe("deleted");
    });

    it("does not keep the next instance from opening after the database is deleted", async () => {
        const vaultId = `release-${sequence++}`;
        await create().init(vaultId);
        indexedDB.deleteDatabase(`${vaultId}-${suffix}`);
        const next = create();
        expect(await within(next.init(vaultId).then(() => "opened"))).toBe("opened");
        await next.close();
    });
});

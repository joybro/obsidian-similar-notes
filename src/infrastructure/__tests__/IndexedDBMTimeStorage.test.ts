import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    IndexedDBMTimeStorage,
    type MTimeEntry,
} from "../IndexedDBMTimeStorage";
import { IndexedNoteMTimeStore } from "../IndexedNoteMTimeStore";

let vaultSequence = 0;

function getBackingStorage(store: IndexedNoteMTimeStore): IndexedDBMTimeStorage {
    return (
        store as unknown as {
            storage: IndexedDBMTimeStorage;
        }
    ).storage;
}

function deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
            reject(new Error(`Database deletion blocked: ${name}`));
    });
}

describe("IndexedDBMTimeStorage", () => {
    let vaultId: string;
    let storages: IndexedDBMTimeStorage[];
    let stores: IndexedNoteMTimeStore[];

    const createStorage = (): IndexedDBMTimeStorage => {
        const storage = new IndexedDBMTimeStorage();
        storages.push(storage);
        return storage;
    };

    const createStore = (): IndexedNoteMTimeStore => {
        const store = new IndexedNoteMTimeStore();
        stores.push(store);
        return store;
    };

    beforeEach(() => {
        vaultId = `mtime-test-${vaultSequence++}`;
        storages = [];
        stores = [];
    });

    afterEach(async () => {
        for (const store of stores) {
            getBackingStorage(store).close();
        }
        for (const storage of storages) {
            storage.close();
        }
        await deleteDatabase(`${vaultId}-similar-notes-mtimes`);
    });

    it("persists complete entries across reloads", async () => {
        let storage = createStorage();
        await storage.init(vaultId);
        await storage.set("folder/note.md", 123, "v1:abc123");
        storage.close();

        storage = createStorage();
        await storage.init(vaultId);

        const expected: MTimeEntry = {
            path: "folder/note.md",
            mtime: 123,
            indexableTextHash: "v1:abc123",
        };
        expect(await storage.get("folder/note.md")).toEqual(expected);
        expect(await storage.getAll()).toEqual({
            "folder/note.md": expected,
        });
    });

    it("loads legacy records without a hash", async () => {
        const storage = createStorage();
        await storage.init(vaultId);
        await storage.set("legacy.md", 456);

        expect(await storage.get("legacy.md")).toEqual({
            path: "legacy.md",
            mtime: 456,
        });
        expect((await storage.getAll())["legacy.md"].indexableTextHash).toBe(
            undefined
        );
    });

    it("moves complete metadata between paths", async () => {
        const storage = createStorage();
        await storage.init(vaultId);
        await storage.set("old.md", 100, "v1:old");

        await storage.move("old.md", "new.md", 200, "v1:old");

        expect(await storage.get("old.md")).toBeUndefined();
        expect(await storage.get("new.md")).toEqual({
            path: "new.md",
            mtime: 200,
            indexableTextHash: "v1:old",
        });
    });

    it("deletes and clears complete metadata records", async () => {
        const storage = createStorage();
        await storage.init(vaultId);
        await storage.set("one.md", 1, "v1:one");
        await storage.set("two.md", 2, "v1:two");

        await storage.delete("one.md");
        expect(await storage.get("one.md")).toBeUndefined();
        expect(await storage.get("two.md")).toBeDefined();

        await storage.clear();
        expect(await storage.getAll()).toEqual({});
    });

    it("restores complete and legacy entries into the in-memory store", async () => {
        const storage = createStorage();
        await storage.init(vaultId);
        await storage.set("hashed.md", 10, "v1:hash");
        await storage.set("legacy.md", 20);
        storage.close();

        const store = createStore();
        await store.init(vaultId);

        expect(store.getMTime("hashed.md")).toBe(10);
        expect(store.getIndexableTextHash("hashed.md")).toBe("v1:hash");
        expect(store.getMTime("legacy.md")).toBe(20);
        expect(store.getIndexableTextHash("legacy.md")).toBeUndefined();
        expect(store.getAllPaths()).toEqual(
            expect.arrayContaining(["hashed.md", "legacy.md"])
        );
        expect(store.getCurrentIndexedNoteCount()).toBe(2);
    });

    it("keeps a stored hash when the compatibility mtime API is used", async () => {
        const store = createStore();
        await store.init(vaultId);
        await store.setMetadata("note.md", 10, "v1:hash");

        await store.setMTime("note.md", 20);

        expect(store.getMTime("note.md")).toBe(20);
        expect(store.getIndexableTextHash("note.md")).toBe("v1:hash");
        expect(await getBackingStorage(store).get("note.md")).toEqual({
            path: "note.md",
            mtime: 20,
            indexableTextHash: "v1:hash",
        });
    });

    it("carries or overrides hashes while moving store metadata", async () => {
        const store = createStore();
        await store.init(vaultId);
        await store.setMetadata("old.md", 10, "v1:old");

        await store.moveMetadata("old.md", "new.md", 20);
        expect(store.getMTime("old.md")).toBeUndefined();
        expect(store.getIndexableTextHash("new.md")).toBe("v1:old");

        await store.moveMetadata("new.md", "overridden.md", 30, "v1:new");
        expect(store.getIndexableTextHash("overridden.md")).toBe("v1:new");
        expect(store.getCurrentIndexedNoteCount()).toBe(1);
        expect(await getBackingStorage(store).getAll()).toEqual({
            "overridden.md": {
                path: "overridden.md",
                mtime: 30,
                indexableTextHash: "v1:new",
            },
        });
    });

    it("removes hashes from memory and storage on delete and clear", async () => {
        const store = createStore();
        await store.init(vaultId);
        await store.setMetadata("one.md", 1, "v1:one");
        await store.setMetadata("two.md", 2, "v1:two");

        await store.deleteMTime("one.md");
        expect(store.getIndexableTextHash("one.md")).toBeUndefined();
        expect(await getBackingStorage(store).get("one.md")).toBeUndefined();

        await store.clear();
        expect(store.getAllPaths()).toEqual([]);
        expect(store.getCurrentIndexedNoteCount()).toBe(0);
        expect(await getBackingStorage(store).getAll()).toEqual({});
    });

    it("keeps the indexed-note count correct for concurrent writes to one path", async () => {
        const store = createStore();
        await store.init(vaultId);

        await Promise.all([
            store.setMetadata("same.md", 1, "v1:first"),
            store.setMetadata("same.md", 2, "v1:second"),
        ]);

        expect(store.getAllPaths()).toEqual(["same.md"]);
        expect(store.getCurrentIndexedNoteCount()).toBe(1);

        await Promise.all([
            store.deleteMTime("same.md"),
            store.deleteMTime("same.md"),
        ]);

        expect(store.getAllPaths()).toEqual([]);
        expect(store.getCurrentIndexedNoteCount()).toBe(0);
    });

    it("mutates the cache only after persistent writes succeed", async () => {
        const store = createStore();
        await store.init(vaultId);
        const storage = getBackingStorage(store);
        vi.spyOn(storage, "set").mockRejectedValueOnce(
            new Error("write failed")
        );

        await expect(
            store.setMetadata("failed.md", 1, "v1:failed")
        ).rejects.toThrow("write failed");

        expect(store.getMTime("failed.md")).toBeUndefined();
        expect(store.getIndexableTextHash("failed.md")).toBeUndefined();
        expect(store.getCurrentIndexedNoteCount()).toBe(0);
    });

    it("keeps old cached metadata when a persistent move fails", async () => {
        const store = createStore();
        await store.init(vaultId);
        await store.setMetadata("old.md", 1, "v1:old");
        const storage = getBackingStorage(store);
        vi.spyOn(storage, "move").mockRejectedValueOnce(
            new Error("move failed")
        );

        await expect(
            store.moveMetadata("old.md", "new.md", 2)
        ).rejects.toThrow("move failed");

        expect(store.getMTime("old.md")).toBe(1);
        expect(store.getIndexableTextHash("old.md")).toBe("v1:old");
        expect(store.getMTime("new.md")).toBeUndefined();
        expect(store.getCurrentIndexedNoteCount()).toBe(1);
    });
});

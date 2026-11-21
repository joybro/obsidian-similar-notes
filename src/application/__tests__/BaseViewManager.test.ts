import { MarkdownView } from "obsidian";
import type { App, Component, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { BaseViewManager } from "../BaseViewManager";

function leafWith(path: string): WorkspaceLeaf {
    const view = new MarkdownView();
    view.file = { path };
    const leaf = { view } as unknown as WorkspaceLeaf;
    view.leaf = leaf;
    return leaf;
}

function managerFor(leaves: WorkspaceLeaf[]) {
    const app = {
        workspace: { getLeavesOfType: () => leaves },
    } as unknown as App;
    const createView = vi.fn(async () => ({ unload: vi.fn() }) as unknown as Component);
    const manager = new BaseViewManager<Component>(app, {
        shouldCreateView: (v: MarkdownView) => !!v.file,
        createView,
    });
    return { manager, createView };
}

describe("BaseViewManager.attachToOpenLeaves", () => {
    it("attaches a view to every open note restored at startup", async () => {
        const leaves = [leafWith("a.md"), leafWith("b.md")];
        const { manager } = managerFor(leaves);

        await manager.attachToOpenLeaves();

        for (const leaf of leaves) {
            expect(manager.hasView(leaf.view as MarkdownView)).toBe(true);
        }
    });

    it("keeps a view created by an event during startup instead of adding a second one", async () => {
        const leaf = leafWith("a.md");
        const { manager, createView } = managerFor([leaf]);
        await manager.onActiveLeafChange(leaf);

        await manager.attachToOpenLeaves();

        expect(createView).toHaveBeenCalledTimes(1);
    });
});

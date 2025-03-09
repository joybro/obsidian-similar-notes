import type { App } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type SimilarNotesPlugin from "../../SimilarNotesPlugin";
import { SimilarNotesSettingTab } from "../SimilarNotesSettingTab";

// Mock createRoot from react-dom/client
vi.mock("react-dom/client", () => ({
    createRoot: vi.fn(() => ({
        render: vi.fn(),
        unmount: vi.fn(),
    })),
}));

describe("SimilarNotesSettingTab", () => {
    let app: App;
    let plugin: SimilarNotesPlugin;
    let settingTab: SimilarNotesSettingTab;

    beforeEach(() => {
        // Mock App
        app = {
            workspace: {},
        } as App;

        // Mock Plugin
        plugin = {} as SimilarNotesPlugin;

        settingTab = new SimilarNotesSettingTab(app, plugin);

        // Mock containerEl with HTMLElement properties
        const mockDiv = document.createElement("div");
        settingTab.containerEl = {
            ...mockDiv,
            empty: vi.fn(),
            createDiv: vi.fn(() => document.createElement("div")),
        } as unknown as HTMLElement;
    });

    test("display() clears container and creates React root", () => {
        settingTab.display();

        const containerEl = settingTab.containerEl as unknown as {
            empty: () => void;
            createDiv: () => HTMLElement;
        };
        expect(containerEl.empty).toHaveBeenCalled();
        expect(containerEl.createDiv).toHaveBeenCalled();
    });

    test("hide() unmounts React root", () => {
        // First display to create root
        settingTab.display();

        // Then hide
        settingTab.hide();

        // Root should be null after hiding
        // Using unknown cast to access private property
        expect((settingTab as unknown as { root: unknown }).root).toBeNull();
    });
});

import type { App } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type SimilarNotesPlugin from "../../similarNotesPlugin";
import { SimilarNotesSettingTab } from "../SimilarNotesSettingTab";

// Mock must be defined before any imports
vi.mock("react-dom/client", () => {
    const mockRender = vi.fn();
    const mockUnmount = vi.fn();
    const mockCreateRoot = vi.fn(() => ({
        render: mockRender,
        unmount: mockUnmount,
    }));

    return {
        createRoot: mockCreateRoot,
        mockRender,
        mockUnmount,
    };
});

// Import the mocked functions
const { mockRender, mockUnmount } = vi.mocked(await import("react-dom/client"));

describe("SimilarNotesSettingTab", () => {
    let app: App;
    let plugin: SimilarNotesPlugin;
    let settingTab: SimilarNotesSettingTab;

    beforeEach(() => {
        // Clear all mocks before each test
        vi.clearAllMocks();

        // Mock App
        app = {
            workspace: {},
        } as App;

        // Mock Plugin with required methods
        plugin = {
            getSettings: vi.fn().mockReturnValue({
                dbPath: ".obsidian/similar-notes.json",
                autoSaveInterval: 5,
            }),
            updateSettings: vi.fn(),
            reindexNotes: vi.fn(),
        } as unknown as SimilarNotesPlugin;

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
        expect(mockRender).toHaveBeenCalled();
    });

    test("hide() unmounts React root", () => {
        // First display to create root
        settingTab.display();

        // Then hide
        settingTab.hide();

        // Root should be null after hiding
        expect(mockUnmount).toHaveBeenCalled();
        expect((settingTab as unknown as { root: unknown }).root).toBeNull();
    });

    test("settings changes are propagated to plugin", async () => {
        settingTab.display();

        // Get the onSettingChange callback from the most recent render call
        const lastRenderCall = mockRender.mock.lastCall?.[0];
        const onSettingChange = lastRenderCall?.props?.onSettingChange;

        // Call onSettingChange with test values
        await onSettingChange("dbPath", "/new/path.json");

        // Verify updateSettings was called with correct value
        expect(plugin.updateSettings).toHaveBeenCalledWith({
            dbPath: "/new/path.json",
        });
    });
});

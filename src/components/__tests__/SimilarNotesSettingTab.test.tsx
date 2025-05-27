import type { App } from "obsidian";
import { Setting } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type MainPlugin from "../../main";
import { SimilarNotesSettingTab } from "../SimilarNotesSettingTab";

// Define the MockSetting type
interface MockSetting {
    containerEl: HTMLElement;
    setName: ReturnType<typeof vi.fn>;
    setDesc: ReturnType<typeof vi.fn>;
    setHeading: ReturnType<typeof vi.fn>;
    addText: ReturnType<typeof vi.fn>;
    addButton: ReturnType<typeof vi.fn>;
    addToggle: ReturnType<typeof vi.fn>;
    addDropdown: ReturnType<typeof vi.fn>;
}

// Define the MockSettingImpl class
class MockSettingImpl {
    constructor(containerEl: HTMLElement) {
        this.containerEl = containerEl;
    }

    containerEl: HTMLElement;

    setName(name: string) {
        return this;
    }

    setDesc(desc: string) {
        return this;
    }

    setHeading() {
        return this;
    }

    addText(
        callback: (text: {
            setValue: (value: string) => void;
            onChange: (value: string) => void;
        }) => void
    ) {
        const mockText = {
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn(),
        };
        callback(mockText);
        return this;
    }

    addButton(
        callback: (button: {
            setButtonText: (text: string) => void;
            onClick: () => void;
        }) => void
    ) {
        const mockButton = {
            setButtonText: vi.fn().mockReturnThis(),
            onClick: vi.fn(),
        };
        callback(mockButton);
        return this;
    }

    addToggle(
        callback: (toggle: {
            setValue: (value: boolean) => void;
            onChange: (value: boolean) => void;
        }) => void
    ) {
        const mockToggle = {
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn(),
        };
        callback(mockToggle);
        return this;
    }

    addDropdown(
        callback: (dropdown: {
            addOption: (value: string, display: string) => void;
            setValue: (value: string) => void;
            onChange: (value: string) => void;
        }) => void
    ) {
        const mockDropdown = {
            addOption: vi.fn().mockReturnThis(),
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn(),
        };
        callback(mockDropdown);
        return this;
    }
}

// Mock the Obsidian module
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("obsidian");

    const MockSettingClass = vi
        .fn()
        .mockImplementation((containerEl: HTMLElement) => {
            const instance = new MockSettingImpl(containerEl);
            vi.spyOn(instance, "setName");
            vi.spyOn(instance, "setDesc");
            vi.spyOn(instance, "setHeading");
            vi.spyOn(instance, "addText");
            vi.spyOn(instance, "addButton");
            vi.spyOn(instance, "addToggle");
            vi.spyOn(instance, "addDropdown");
            return instance as unknown as MockSetting;
        });

    return {
        ...actual,
        Setting: MockSettingClass,
        Modal: class {
            constructor(app: App) {
                this.app = app;
            }
            app: App;
            open(): void {}
            close(): void {}
        },
        PluginSettingTab: class {
            constructor(app: App, plugin: MainPlugin) {
                this.app = app;
                this.plugin = plugin;
            }
            app: App;
            plugin: MainPlugin;
            containerEl: HTMLElement;
            display(): void {}
            hide(): void {}
        },
    };
});

describe("SimilarNotesSettingTab", () => {
    let app: App;
    let plugin: MainPlugin;
    let settingTab: SimilarNotesSettingTab;
    let mockSettingInstances: MockSetting[];
    let settingsService: import("@/application/SettingsService").SettingsService;

    beforeEach(() => {
        // Clear all mocks before each test
        vi.clearAllMocks();
        mockSettingInstances = [];

        // Mock App
        app = {
            workspace: {},
        } as App;

        // Mock SettingsService
        settingsService = {
            get: vi.fn().mockReturnValue({
                dbPath: ".obsidian/similar-notes.json",
                autoSaveInterval: 5,
                includeFrontmatter: false,
            }),
            update: vi.fn(),
        } as unknown as import("@/application/SettingsService").SettingsService;

        // Mock Plugin with required methods
        plugin = {
            reindexNotes: vi.fn(),
        } as unknown as MainPlugin;

        settingTab = new SimilarNotesSettingTab(plugin, settingsService);

        // Mock containerEl with HTMLElement properties
        const mockDiv = document.createElement("div");
        settingTab.containerEl = {
            ...mockDiv,
            empty: vi.fn(),
        } as unknown as HTMLElement;

        // Store mock Setting instances
        const originalSetting = Setting as unknown as ReturnType<typeof vi.fn>;
        originalSetting.mockImplementation((containerEl: HTMLElement) => {
            const instance = new MockSettingImpl(containerEl);
            const spiedInstance = {
                ...instance,
                setName: vi.fn().mockReturnThis(),
                setDesc: vi.fn().mockReturnThis(),
                setHeading: vi.fn().mockReturnThis(),
                addText: vi
                    .fn()
                    .mockImplementation(instance.addText.bind(instance)),
                addButton: vi
                    .fn()
                    .mockImplementation(instance.addButton.bind(instance)),
                addToggle: vi
                    .fn()
                    .mockImplementation(instance.addToggle.bind(instance)),
                addDropdown: vi
                    .fn()
                    .mockImplementation(instance.addDropdown.bind(instance)),
            } as MockSetting;
            mockSettingInstances.push(spiedInstance);
            return spiedInstance;
        });
    });

    test("display() clears container and creates settings", () => {
        settingTab.display();

        // Verify container was cleared
        expect(settingTab.containerEl.empty).toHaveBeenCalled();

        // Verify Setting was called for each setting
        expect(Setting).toHaveBeenCalledTimes(12);
    });

    test("settings changes are propagated to plugin", async () => {
        settingTab.display();

        // Get the first Setting instance
        const mockSetting = mockSettingInstances[0];

        // Get the mock text component from addText call
        const mockText = {
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn(),
        };

        // Get the onChange callback that was passed to addText
        const onChangeCallback = mockSetting.addText.mock.calls[0][0];
        onChangeCallback(mockText);

        // Simulate text change
        const onChangeHandler = mockText.onChange.mock.calls[0][0];
        await onChangeHandler("/new/path.json");

        // Verify update was called with correct value
        expect(settingsService.update).toHaveBeenCalledWith({
            dbPath: "/new/path.json",
        });
    });

    test("reindex button triggers reindexNotes", async () => {
        settingTab.display();

        // Get the correct Setting instance for reindex button (index 8)
        const mockSetting = mockSettingInstances[8];

        // Get the mock button component from addButton call
        const mockButton = {
            setButtonText: vi.fn().mockReturnThis(),
            onClick: vi.fn(),
        };

        // Get the onClick callback that was passed to addButton
        const onClickCallback = mockSetting.addButton.mock.calls[0][0];
        onClickCallback(mockButton);

        // Simulate button click
        const onClickHandler = mockButton.onClick.mock.calls[0][0];
        await onClickHandler();

        // Verify reindexNotes was called
        expect(plugin.reindexNotes).toHaveBeenCalled();
    });

    // Test for the includeFrontmatter toggle
    test("includeFrontmatter toggle is rendered and updates settings", async () => {
        // Patch settingsService.get to include includeFrontmatter
        settingsService.get = vi.fn().mockReturnValue({
            dbPath: ".obsidian/similar-notes.json",
            autoSaveInterval: 5,
            includeFrontmatter: false,
        });
        settingTab.display();

        // The correct setting should be the toggle (index 7)
        const mockSetting = mockSettingInstances[7];
        expect(mockSetting.setName).toHaveBeenCalledWith(
            "Include frontmatter in indexing and search"
        );
        expect(mockSetting.setDesc).toHaveBeenCalledWith(
            "If enabled, the frontmatter of each note will be included in the similarity index and search."
        );
        // Simulate toggle change
        const onChangeCallback = mockSetting.addToggle.mock.calls[0][0];
        const mockToggle = {
            setValue: vi.fn().mockReturnThis(),
            onChange: vi.fn(),
        };
        onChangeCallback(mockToggle);
        const onChangeHandler = mockToggle.onChange.mock.calls[0][0];
        await onChangeHandler(true);
        expect(settingsService.update).toHaveBeenCalledWith({
            includeFrontmatter: true,
        });
    });
});

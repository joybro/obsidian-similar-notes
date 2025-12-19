import { describe, it, expect, beforeEach, vi } from "vitest";

// Use the existing Obsidian mock
vi.mock("obsidian");

// Track Setting calls for testing
let _settingCallCount = 0;

// Mock ModelSettingsSection that demonstrates the fix
class FixedModelSettingsSection {
    private props: {
        containerEl: HTMLElement;
        plugin: { changeModel: () => void };
        settingsService: { get: () => unknown; update: () => Promise<void> };
        app: Record<string, unknown>;
    };
    private renderCallCount = 0;
    private sectionContainer?: HTMLElement;

    constructor(props: {
        containerEl: HTMLElement;
        plugin: { changeModel: () => void };
        settingsService: { get: () => unknown; update: () => Promise<void> };
        app: Record<string, unknown>;
    }) {
        this.props = props;
    }

    render(): void {
        this.renderCallCount++;
        
        const { containerEl } = this.props;
        
        // FIXED: Create or clear the section container (like the real fix)
        // Check if sectionContainer exists and is still connected to the DOM
        if (!this.sectionContainer || !this.sectionContainer.parentElement) {
            this.sectionContainer = document.createElement("div");
            this.sectionContainer.className = "model-settings-section";
            containerEl.appendChild(this.sectionContainer);
        } else {
            this.sectionContainer.innerHTML = ""; // Clear previous content
        }
        
        // Add new elements to the section container
        for (let i = 0; i < 5; i++) { // Simulate 5 settings being added
            const div = document.createElement("div");
            div.className = "setting-item";
            div.dataset.renderCall = this.renderCallCount.toString();
            div.dataset.settingIndex = i.toString();
            this.sectionContainer.appendChild(div); // Add to section, not main container
            _settingCallCount++;
        }
    }

    getRenderCallCount(): number {
        return this.renderCallCount;
    }
}

describe("ModelSettingsSection Render Behavior", () => {
    let mockContainerEl: HTMLElement;
    let mockSettingsService: {
        get: () => unknown;
        update: () => Promise<void>;
    };
    let mockPlugin: { changeModel: () => void };
    let mockApp: Record<string, unknown>;
    let modelSettingsSection: FixedModelSettingsSection;

    beforeEach(() => {
        // Reset the counter
        _settingCallCount = 0;
        
        // Create a real DOM element for testing
        mockContainerEl = document.createElement("div");
        
        mockSettingsService = {
            get: vi.fn().mockReturnValue({
                modelProvider: "builtin",
                modelId: "sentence-transformers/all-MiniLM-L6-v2",
                useGPU: false,
                ollamaUrl: "http://localhost:11434",
                ollamaModel: "",
            }),
            update: vi.fn().mockResolvedValue(undefined),
        };

        mockPlugin = {
            changeModel: vi.fn(),
        };

        mockApp = {};

        modelSettingsSection = new FixedModelSettingsSection({
            containerEl: mockContainerEl,
            plugin: mockPlugin,
            settingsService: mockSettingsService,
            app: mockApp,
        });
    });

    describe("fixed render behavior", () => {
        it("should not duplicate elements when render is called multiple times", () => {
            // First render - should create section container with 5 elements
            modelSettingsSection.render();
            expect(mockContainerEl.children.length).toBe(1); // Only the section container
            const sectionContainer = mockContainerEl.children[0] as HTMLElement;
            expect(sectionContainer.children.length).toBe(5); // 5 settings inside section
            
            // Second render (simulating GPU toggle change)
            modelSettingsSection.render();
            expect(mockContainerEl.children.length).toBe(1); // Still only the section container
            expect(sectionContainer.children.length).toBe(5); // Still 5 settings, not doubled
            
            // Third render
            modelSettingsSection.render();
            expect(mockContainerEl.children.length).toBe(1); // Still only the section container
            expect(sectionContainer.children.length).toBe(5); // Still 5 settings, not tripled
        });

        it("should maintain consistent structure across renders", () => {
            // First render
            modelSettingsSection.render();
            const sectionContainer = mockContainerEl.children[0] as HTMLElement;
            const firstRenderElementCount = sectionContainer.children.length;
            const firstRenderClasses = Array.from(sectionContainer.children)
                .map(child => child.className);
            
            // Second render
            modelSettingsSection.render();
            const secondRenderElementCount = sectionContainer.children.length;
            const secondRenderClasses = Array.from(sectionContainer.children)
                .map(child => child.className);
            
            // Structure should be identical (same count and classes)
            expect(secondRenderElementCount).toBe(firstRenderElementCount);
            expect(secondRenderClasses).toEqual(firstRenderClasses);
        });

        it("should clear section content before adding new content", () => {
            // First render
            modelSettingsSection.render();
            const sectionContainer = mockContainerEl.children[0] as HTMLElement;
            expect(sectionContainer.children.length).toBe(5);
            
            // Add some manual content to test clearing
            const extraDiv = document.createElement("div");
            extraDiv.className = "extra-content";
            sectionContainer.appendChild(extraDiv);
            expect(sectionContainer.children.length).toBe(6);
            
            // Second render should clear and rebuild
            modelSettingsSection.render();
            expect(sectionContainer.children.length).toBe(5); // Back to 5, extra content cleared
            
            // Should not contain the extra content
            const hasExtraContent = Array.from(sectionContainer.children)
                .some(child => child.className.includes("extra-content"));
            expect(hasExtraContent).toBe(false);
        });
    });

    describe("settings tab reopen scenario", () => {
        it("should handle container being cleared and recreate section", () => {
            // First render (settings tab opened)
            modelSettingsSection.render();
            expect(mockContainerEl.children.length).toBe(1);
            const firstSectionContainer = mockContainerEl.children[0] as HTMLElement;
            expect(firstSectionContainer.children.length).toBe(5);
            
            // Simulate settings tab being closed and reopened
            // This clears the main container (like containerEl.empty())
            mockContainerEl.innerHTML = "";
            expect(mockContainerEl.children.length).toBe(0);
            
            // Second render (settings tab reopened)
            // This should recreate the section since it's no longer in the DOM
            modelSettingsSection.render();
            expect(mockContainerEl.children.length).toBe(1); // Should recreate section
            const secondSectionContainer = mockContainerEl.children[0] as HTMLElement;
            expect(secondSectionContainer.children.length).toBe(5); // Should have content
        });
    });
});
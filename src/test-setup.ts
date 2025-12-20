import "@testing-library/jest-dom";
import { TextEncoder } from "node:util";
import { vi } from "vitest";

// Setup any global test configurations here
vi.mock("obsidian", () => {
    return {
        TFile: class TFile {
            path: string;
            basename: string;
            extension: string;

            constructor(path: string) {
                this.path = path;
                const parts = path.split(".");
                this.extension = parts.pop() || "";
                this.basename = parts.join(".");
            }
        },
        PluginSettingTab: class PluginSettingTab {
            app: unknown;
            containerEl: HTMLElement;

            constructor(app: unknown, _plugin: unknown) {
                this.app = app;
                this.containerEl = document.createElement("div");
            }

            display(): void {
                // Mock implementation
            }
            hide(): void {
                // Mock implementation
            }
        },
    };
});

// Add TextEncoder to the global scope
global.TextEncoder = TextEncoder;

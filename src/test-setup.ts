import "@testing-library/jest-dom";
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
            app: any;
            containerEl: HTMLElement;

            constructor(app: any, plugin: any) {
                this.app = app;
                this.containerEl = document.createElement("div");
            }

            display(): void {}
            hide(): void {}
        },
    };
});

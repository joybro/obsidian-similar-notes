import { describe, expect, test } from "vitest";
import {
    formatEnvironmentInfoAsMarkdown,
    type EnvironmentInfo,
    type SystemInfo,
} from "../environmentInfo";

function makeInfo(system: SystemInfo): EnvironmentInfo {
    return {
        platform: "Desktop (Linux)",
        obsidianVersion: "1.12.7",
        pluginVersion: "1.6.0",
        modelProvider: "builtin",
        modelId: "Built-in (sentence-transformers/all-MiniLM-L6-v2)",
        webGPU: false,
        system,
        chunkSettings: {
            includeFrontmatter: false,
            excludeFolderPatterns: [],
            excludeRegexPatternsCount: 0,
        },
    };
}

describe("formatEnvironmentInfoAsMarkdown: system info in bug reports", () => {
    test("renders CPU (with arch) and Memory when available (desktop)", () => {
        const md = formatEnvironmentInfoAsMarkdown(
            makeInfo({ totalMemoryGB: 16, cpuCores: 8, arch: "x64" })
        );
        expect(md).toContain("- **CPU**: 8 cores (x64)");
        expect(md).toContain("- **Memory**: 16 GB");
    });

    test("omits CPU and Memory lines when unavailable (e.g. mobile)", () => {
        const md = formatEnvironmentInfoAsMarkdown(
            makeInfo({ totalMemoryGB: null, cpuCores: null, arch: null })
        );
        expect(md).not.toContain("**CPU**");
        expect(md).not.toContain("**Memory**");
        // Other fields still present.
        expect(md).toContain("- **Platform**: Desktop (Linux)");
        expect(md).toContain("- **Plugin**: v1.6.0");
    });

    test("renders CPU without arch suffix when arch is null", () => {
        const md = formatEnvironmentInfoAsMarkdown(
            makeInfo({ totalMemoryGB: 32, cpuCores: 4, arch: null })
        );
        expect(md).toContain("- **CPU**: 4 cores");
        expect(md).not.toContain("4 cores (");
    });
});

import { Platform } from "obsidian";
import type { SimilarNotesSettings } from "@/application/SettingsService";

export interface SystemInfo {
    totalMemoryGB: number | null;
    cpuCores: number | null;
    arch: string | null;
}

export interface EnvironmentInfo {
    platform: string;
    obsidianVersion: string;
    pluginVersion: string;
    modelProvider: string;
    modelId: string;
    webGPU: boolean;
    system: SystemInfo;
    chunkSettings: {
        includeFrontmatter: boolean;
        excludeFolderPatterns: string[];
        excludeRegexPatternsCount: number;
    };
}

/**
 * Total RAM, logical CPU count, and architecture, for bug reports (the
 * built-in WASM model's failures are memory-sensitive, so RAM is the key
 * signal). Desktop-only: `os` is a Node builtin present in Obsidian's Electron
 * runtime and marked external in the esbuild config, so it resolves to Node at
 * runtime. Required lazily (not a top-level import) so the mobile build never
 * executes the require and fails to load. Falls back to nulls on any error.
 */
function collectSystemInfo(): SystemInfo {
    const empty: SystemInfo = {
        totalMemoryGB: null,
        cpuCores: null,
        arch: null,
    };
    if (!Platform.isDesktopApp) {
        return empty;
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const os = require("os") as typeof import("os");
        return {
            totalMemoryGB: Math.round(os.totalmem() / 1024 ** 3),
            cpuCores: os.cpus().length,
            arch: os.arch(),
        };
    } catch {
        return empty;
    }
}

function getPlatformString(): string {
    if (Platform.isMobileApp) {
        if (Platform.isIosApp) {
            return "Mobile (iOS)";
        }
        if (Platform.isAndroidApp) {
            return "Mobile (Android)";
        }
        return "Mobile";
    }

    if (Platform.isDesktopApp) {
        if (Platform.isMacOS) {
            return "Desktop (macOS)";
        }
        if (Platform.isWin) {
            return "Desktop (Windows)";
        }
        if (Platform.isLinux) {
            return "Desktop (Linux)";
        }
        return "Desktop";
    }

    return "Unknown";
}

function getModelDisplayName(settings: SimilarNotesSettings): string {
    if (settings.modelProvider === "ollama") {
        return `Ollama (${settings.ollamaModel || "not configured"})`;
    }
    return `Built-in (${settings.modelId})`;
}

export function collectEnvironmentInfo(
    obsidianVersion: string,
    pluginVersion: string,
    settings: SimilarNotesSettings
): EnvironmentInfo {
    return {
        platform: getPlatformString(),
        obsidianVersion,
        pluginVersion,
        modelProvider: settings.modelProvider,
        modelId: getModelDisplayName(settings),
        webGPU: settings.useGPU,
        system: collectSystemInfo(),
        chunkSettings: {
            includeFrontmatter: settings.includeFrontmatter,
            excludeFolderPatterns: settings.excludeFolderPatterns,
            excludeRegexPatternsCount: settings.excludeRegexPatterns.length,
        },
    };
}

export function formatEnvironmentInfoAsMarkdown(info: EnvironmentInfo): string {
    const lines = ["### Environment", `- **Platform**: ${info.platform}`];

    // System lines only render on platforms where we could read them (desktop).
    if (info.system.cpuCores !== null) {
        const arch = info.system.arch ? ` (${info.system.arch})` : "";
        lines.push(`- **CPU**: ${info.system.cpuCores} cores${arch}`);
    }
    if (info.system.totalMemoryGB !== null) {
        lines.push(`- **Memory**: ${info.system.totalMemoryGB} GB`);
    }

    lines.push(
        `- **Obsidian**: v${info.obsidianVersion}`,
        `- **Plugin**: v${info.pluginVersion}`,
        "",
        "### Settings",
        `- **Model**: ${info.modelId}`,
        `- **WebGPU**: ${info.webGPU ? "Enabled" : "Disabled"}`,
        `- **Include Frontmatter**: ${info.chunkSettings.includeFrontmatter ? "Yes" : "No"}`
    );

    return lines.join("\n");
}

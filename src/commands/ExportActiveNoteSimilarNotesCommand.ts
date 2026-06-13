import type { SimilarNoteCoordinator } from "@/application/SimilarNoteCoordinator";
import log from "loglevel";
import { Notice as ObsidianNotice, type App, type Plugin } from "obsidian";
import type { Command } from "./Command";

const EXPORT_FILE_NAME = "similar-notes-export.json";

/**
 * Version of the agent-export JSON contract (see docs/agent-export.md).
 * Bump when the payload shape changes so external agents can branch on it.
 */
const SCHEMA_VERSION = 1;

type ErrorCode = "NO_ACTIVE_FILE" | "SEARCH_FAILED";

export class ExportActiveNoteSimilarNotesCommand implements Command {
    id = "export-active-note-similar-notes";
    name = "Export similar notes for active note";

    constructor(
        private app: App,
        private similarNoteCoordinator: SimilarNoteCoordinator,
        private pluginId: string
    ) {}

    register(plugin: Plugin): void {
        plugin.addCommand({
            id: this.id,
            name: this.name,
            callback: async () => {
                try {
                    const path = await this.run();
                    new ObsidianNotice(`Similar notes exported to ${path}`);
                } catch (error) {
                    log.error("Failed to export similar notes:", error);
                    new ObsidianNotice(
                        `Failed to export similar notes: ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                }
            },
        });
    }

    private async run(): Promise<string> {
        const exportPath = await this.resolveExportPath();
        const file = this.app.workspace.getActiveFile();

        if (!file || file.extension !== "md") {
            await this.writeError(
                exportPath,
                "NO_ACTIVE_FILE",
                "No active markdown file"
            );
            throw new Error("No active markdown file");
        }

        try {
            const entries =
                await this.similarNoteCoordinator.getSimilarNotes(file);
            const results = entries.map((entry) => ({
                path: entry.file.path,
                title: entry.title,
                score: entry.similarity,
                excerpt: entry.preview,
                linked: entry.isLinked,
            }));

            await this.writePayload(exportPath, {
                version: SCHEMA_VERSION,
                ok: true,
                sourcePath: file.path,
                generatedAt: new Date().toISOString(),
                results,
            });

            return exportPath;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            await this.writeError(exportPath, "SEARCH_FAILED", message);
            throw error;
        }
    }

    private async writeError(
        exportPath: string,
        code: ErrorCode,
        error: string
    ): Promise<void> {
        await this.writePayload(exportPath, {
            version: SCHEMA_VERSION,
            ok: false,
            code,
            error,
            generatedAt: new Date().toISOString(),
        });
    }

    private async resolveExportPath(): Promise<string> {
        const pluginDataDir = `${this.app.vault.configDir}/plugins/${this.pluginId}`;
        if (!(await this.app.vault.adapter.exists(pluginDataDir))) {
            await this.app.vault.adapter.mkdir(pluginDataDir);
        }
        return `${pluginDataDir}/${EXPORT_FILE_NAME}`;
    }

    /**
     * Write atomically: render to a temp file, then move it onto the target.
     * An agent polling the export therefore never observes a half-written
     * file. Falls back to remove-then-rename for platforms whose rename does
     * not overwrite an existing destination.
     */
    private async writePayload(
        exportPath: string,
        payload: Record<string, unknown>
    ): Promise<void> {
        const adapter = this.app.vault.adapter;
        const tmpPath = `${exportPath}.tmp`;
        await adapter.write(tmpPath, JSON.stringify(payload, null, 2));
        try {
            await adapter.rename(tmpPath, exportPath);
        } catch {
            if (await adapter.exists(exportPath)) {
                await adapter.remove(exportPath);
            }
            await adapter.rename(tmpPath, exportPath);
        }
    }
}

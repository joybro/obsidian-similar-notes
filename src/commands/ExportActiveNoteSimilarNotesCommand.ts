import type { SimilarNoteCoordinator } from "@/application/SimilarNoteCoordinator";
import log from "loglevel";
import { Notice as ObsidianNotice, type App, type Plugin } from "obsidian";
import type { Command } from "./Command";

const EXPORT_FILE_NAME = "agent-similar-notes.json";

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
            await this.writePayload(exportPath, {
                ok: false,
                error: "No active markdown file",
            });
            throw new Error("No active markdown file");
        }

        try {
            const entries = await this.similarNoteCoordinator.getSimilarNotes(file);
            const results = entries.map((entry) => ({
                path: entry.file.path,
                title: entry.title,
                score: entry.similarity,
                excerpt: entry.preview,
            }));

            await this.writePayload(exportPath, {
                ok: true,
                sourcePath: file.path,
                generatedAt: new Date().toISOString(),
                results,
            });

            return exportPath;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            await this.writePayload(exportPath, {
                ok: false,
                error: message,
            });
            throw error;
        }
    }

    private async resolveExportPath(): Promise<string> {
        const pluginDataDir = `${this.app.vault.configDir}/plugins/${this.pluginId}`;
        if (!(await this.app.vault.adapter.exists(pluginDataDir))) {
            await this.app.vault.adapter.mkdir(pluginDataDir);
        }
        return `${pluginDataDir}/${EXPORT_FILE_NAME}`;
    }

    private async writePayload(
        exportPath: string,
        payload: Record<string, unknown>
    ): Promise<void> {
        await this.app.vault.adapter.write(
            exportPath,
            JSON.stringify(payload, null, 2)
        );
    }
}

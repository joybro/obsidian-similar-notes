import log from "loglevel";
import type { DataAdapter } from "obsidian";

/**
 * Move a data file to its new location when only the old one exists.
 * Failures are logged, not thrown: the plugin starts without the old data.
 */
export async function migrateDataFile(
    adapter: DataAdapter,
    oldPath: string,
    newPath: string
): Promise<void> {
    try {
        if ((await adapter.exists(oldPath)) && !(await adapter.exists(newPath))) {
            log.info(`Migrating file from ${oldPath} to ${newPath}`);
            const data = await adapter.read(oldPath);
            await adapter.write(newPath, data);
            await adapter.remove(oldPath);
            log.info(`Successfully migrated file to plugin folder`);
        }
    } catch (error) {
        log.error(`Failed to migrate file from ${oldPath} to ${newPath}:`, error);
    }
}

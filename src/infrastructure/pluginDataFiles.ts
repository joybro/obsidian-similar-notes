import log from "loglevel";
import type { Vault } from "obsidian";

export async function ensurePluginDataDir(
    vault: Vault,
    pluginId: string
): Promise<string> {
    const pluginDataDir = `${vault.configDir}/plugins/${pluginId}`;
    if (!(await vault.adapter.exists(pluginDataDir))) {
        await vault.adapter.mkdir(pluginDataDir);
    }
    return pluginDataDir;
}

export async function migrateDataFile(
    vault: Vault,
    oldPath: string,
    newPath: string
): Promise<void> {
    try {
        if (
            (await vault.adapter.exists(oldPath)) &&
            !(await vault.adapter.exists(newPath))
        ) {
            log.info(`Migrating file from ${oldPath} to ${newPath}`);
            const data = await vault.adapter.read(oldPath);
            await vault.adapter.write(newPath, data);
            await vault.adapter.remove(oldPath);
            log.info("Successfully migrated file to plugin folder");
        }
    } catch (error) {
        log.error(`Failed to migrate file from ${oldPath} to ${newPath}:`, error);
    }
}

// Obsidian runtime APIs the plugin uses that are not in obsidian.d.ts.
// Typing them here replaces per-call @ts-expect-error (Obsidian's automated
// plugin review flags the untyped calls as unsafe member access).
import "obsidian";

declare module "obsidian" {
    interface App {
        /** Stable per-vault id, used to namespace IndexedDB stores. */
        appId: string;
        commands: {
            executeCommandById(commandId: string): boolean;
        };
        setting: {
            open(): void;
            openTabById(tabId: string): void;
        };
    }
}

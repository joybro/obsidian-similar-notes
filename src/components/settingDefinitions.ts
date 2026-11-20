import {
    SettingGroup,
    type Setting,
    type SettingDefinitionGroup,
    type SettingDefinitionRender,
} from "obsidian";

/** Builds one settings row imperatively (sets its own name, desc and controls). */
export type SettingBuilder = (setting: Setting) => void;

/**
 * One row of the settings tab: a `render` setting definition (Obsidian 1.13+)
 * wrapping an existing builder. `name`/`aliases` are what Obsidian's settings
 * search indexes; the builder still calls setName/setDesc itself so the
 * pre-1.13 `display()` path renders the same row (settings-search spec rule 6).
 */
export type SettingRow = SettingDefinitionRender & {
    /**
     * Render key for rows that share a name (each provider has its own
     * "Model", "API key", ...). Not in the public types (obsidian 1.14.4), but
     * Obsidian 1.15.1 keys a row by `id`, else by `name`, and logs "duplicate
     * setting key" for repeats in one list. An app that ignores `id` falls back
     * to name keys (settings-search spec rule 7).
     */
    id?: string;
};

/** A heading plus its rows: one `SettingGroup` on screen. */
export type SettingRowGroup = SettingDefinitionGroup & { items: SettingRow[] };

/**
 * A row without a name of its own (preview boxes, the regex tester). Kept out
 * of search: there is no name to match and no copy to add.
 */
export function unnamedRow(render: SettingBuilder): SettingRow {
    return { name: "", searchable: false, render };
}

function isVisible(visible: boolean | (() => boolean) | undefined): boolean {
    if (visible === undefined) return true;
    return typeof visible === "function" ? visible() : visible;
}

/**
 * Renders setting definition groups imperatively, the way the tab rendered
 * before Obsidian 1.13: one `SettingGroup` per visible group with its heading,
 * one `addSetting` per visible row. This is the `display()` fallback for
 * Obsidian 1.11 and 1.12; 1.13+ renders the same definitions itself.
 */
export function renderSettingGroups(
    containerEl: HTMLElement,
    groups: SettingRowGroup[]
): void {
    for (const group of groups) {
        if (!isVisible(group.visible)) continue;
        const settingGroup = new SettingGroup(containerEl);
        if (group.heading) settingGroup.setHeading(group.heading);
        for (const row of group.items) {
            if (!isVisible(row.visible)) continue;
            settingGroup.addSetting((setting) => {
                row.render(setting, settingGroup);
            });
        }
    }
}

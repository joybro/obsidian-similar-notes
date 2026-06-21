import { type App, type Plugin, type TFile } from "obsidian";

/**
 * Register the editor-drop handler that inserts a wiki-style link when a
 * Similar Notes recommendation is dragged into the editor. Inserts at the drop
 * position when CodeMirror exposes one, otherwise at the cursor.
 */
export function registerEditorDropHandler(plugin: Plugin): void {
    const app: App = plugin.app;

    plugin.registerEvent(
        app.workspace.on("editor-drop", (evt, editor, info) => {
            const plainText = evt.dataTransfer?.getData("text/plain");

            // Check if this looks like a wiki-style link from Similar Notes
            if (!plainText || !/^\[\[.+\]\]$/.test(plainText)) return;

            // Extract path from [[path]] and resolve the file
            const notePath = plainText.slice(2, -2);
            const file = app.vault.getAbstractFileByPath(notePath);
            if (!file) return;

            evt.preventDefault();

            // Compute link text respecting Obsidian's "New link format" setting
            const sourcePath = info?.file?.path ?? "";
            const linktext = app.metadataCache.fileToLinktext(
                file as TFile,
                sourcePath
            );
            const linkMarkup = `[[${linktext}]]`;

            // Try to insert at drop position using CodeMirror's posAtCoords
            // @ts-expect-error - Accessing internal CodeMirror EditorView
            const editorView = info?.editor?.cm;
            if (editorView?.posAtCoords) {
                const pos = editorView.posAtCoords({
                    x: evt.clientX,
                    y: evt.clientY,
                });
                if (pos !== null) {
                    editorView.dispatch({
                        changes: { from: pos, insert: linkMarkup },
                    });
                    return;
                }
            }

            // Fallback: insert at cursor position
            editor.replaceSelection(linkMarkup);
        })
    );
}

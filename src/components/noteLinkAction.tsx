import type { App, MarkdownView, TFile, Workspace } from "obsidian";
import { Notice } from "obsidian";
import { useRef } from "react";
import { logRejection } from "@/utils/logRejection";
import { getTargetMarkdownView } from "@/utils/viewUtils";

/**
 * Append a link to `target` at the end of `source`.
 *
 * When `source` is open in an editor in source mode (including Live Preview),
 * the link goes through the editor so unsaved edits are kept. Otherwise the
 * file is rewritten with `vault.process`.
 */
export async function appendNoteLink(
    app: App,
    workspace: Workspace,
    preferredView: MarkdownView | null,
    source: TFile,
    target: TFile
): Promise<void> {
    const link = app.fileManager.generateMarkdownLink(target, source.path);
    // From the sidebar there is no preferred view, and the click has made the
    // sidebar the active leaf: look for the note's editor in the main area.
    const activeView = preferredView ?? getTargetMarkdownView(workspace);

    if (activeView?.file === source && activeView.getMode() === "source") {
        const editor = activeView.editor;
        const lastLine = editor.lastLine();
        const line = editor.getLine(lastLine);
        editor.replaceRange(`${line ? "\n" : ""}${link}\n`, {
            line: lastLine,
            ch: line.length,
        });
        return;
    }

    await app.vault.process(source, (content) =>
        `${content}${content && !content.endsWith("\n") ? "\n" : ""}${link}\n`
    );
}

interface UseAddNoteLinkOptions {
    leaf: MarkdownView;
    workspace: Workspace;
    viewType: "sidebar" | "bottom";
    /** The note the current results were computed for. */
    sourceFile: TFile | null;
    /** Called after the link is written, while the same note is still shown. */
    markLinked: (target: TFile) => void;
}

/**
 * Click handler for a result's Link button. Refuses to write when the results
 * are stale (the view moved to another note) and ignores repeated clicks while
 * the same link is still being written.
 */
export function useAddNoteLink({
    leaf,
    workspace,
    viewType,
    sourceFile,
    markLinked,
}: UseAddNoteLinkOptions): (target: TFile) => void {
    const pendingLinksRef = useRef(new Set<string>());

    const addLink = async (target: TFile) => {
        const source = sourceFile;
        if (!source || leaf.file !== source) {
            new Notice("The current note has changed. Wait for similar notes to refresh.");
            return;
        }
        const key = `${source.path}\0${target.path}`;
        if (pendingLinksRef.current.has(key)) return;
        pendingLinksRef.current.add(key);

        try {
            await appendNoteLink(
                leaf.app,
                workspace,
                viewType === "bottom" ? leaf : null,
                source,
                target
            );
            if (leaf.file === source) markLinked(target);
        } catch (error) {
            console.error("Failed to add a similar note link", error);
            new Notice("Could not add the link to the current note.");
        } finally {
            pendingLinksRef.current.delete(key);
        }
    };

    return (target: TFile) => {
        logRejection(addLink(target), "add similar note link");
    };
}

export const AddLinkButton = ({
    title,
    onClick,
}: {
    title: string;
    onClick: () => void;
}) => (
    <button
        type="button"
        className="similar-notes-add-link"
        aria-label={`Add link to ${title} at the end of this note`}
        title="Add link at the end of this note"
        onClick={(e) => {
            e.stopPropagation();
            onClick();
        }}
    >
        Link
    </button>
);

import type { MarkdownView, TFile, Workspace } from "obsidian";
import { Menu } from "obsidian";
import { useEffect, useState } from "react";
import type { Observable } from "rxjs";

export interface SimilarNoteEntry {
    file: TFile;
    title: string;
    similarity: number;
}

export interface NoteBottomViewModel {
    currentFile: TFile | null;
    similarNoteEntries: SimilarNoteEntry[];
}

interface SimilarNotesHeaderProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
}

interface SimilarNotesContentProps {
    similarNotes: SimilarNoteEntry[];
    onNoteClick: (e: React.MouseEvent, file: TFile) => void;
    onContextMenu: (e: React.MouseEvent, file: TFile) => void;
    isCollapsed: boolean;
}

interface NoteBottomViewProps {
    workspace: Workspace;
    vaultName: string;
    leaf: MarkdownView;
    bottomViewModelSubject$: Observable<NoteBottomViewModel>;
}

// Header Component
const SimilarNotesHeader: React.FC<SimilarNotesHeaderProps> = ({
    collapsed,
    onToggleCollapse,
}) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            onToggleCollapse();
            e.preventDefault();
        }
    };

    return (
        <div
            className="similar-notes-header nav-header"
            onClick={onToggleCollapse}
            onKeyDown={handleKeyDown}
        >
            <div
                className={`similar-notes-title tree-item-itself is-clickable ${
                    collapsed ? "is-collapsed" : ""
                }`}
            >
                <div className="similar-notes-title-text">Similar notes</div>
            </div>
        </div>
    );
};

// Content Component
const SimilarNotesContent: React.FC<SimilarNotesContentProps> = ({
    similarNotes,
    onNoteClick,
    onContextMenu,
    isCollapsed,
}) => {
    if (isCollapsed) {
        return null;
    }

    if (similarNotes.length === 0) {
        return (
            <div className="similar-notes-empty">No similar notes found</div>
        );
    }

    return (
        <div className="similar-notes-content">
            {similarNotes.map((note, i) => {
                return (
                    <div
                        key={note.file.path}
                        className="similar-notes-item tree-item-self is-clickable"
                        draggable="true"
                        onClick={(e) => onNoteClick(e, note.file)}
                        onKeyDown={() => {}}
                        onContextMenu={(e) => onContextMenu(e, note.file)}
                    >
                        <div className="tree-item-inner">{note.title}</div>
                        <div className="tree-item-flair-outer">
                            <div className="tree-item-flair">
                                {note.similarity.toFixed(2)}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// Main Component
const NoteBottomViewReact: React.FC<NoteBottomViewProps> = ({
    workspace,
    vaultName,
    leaf,
    bottomViewModelSubject$,
}) => {
    const [collapsed, setCollapsed] = useState(false);
    const [similarNotes, setSimilarNotes] = useState<SimilarNoteEntry[]>([]);

    const handleNewViewModel = (model: NoteBottomViewModel) => {
        if (leaf.file !== model.currentFile) {
            return;
        }

        setSimilarNotes(model.similarNoteEntries);
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies(handleNewViewModel):
    useEffect(() => {
        const sub = bottomViewModelSubject$.subscribe(handleNewViewModel);
        return () => sub.unsubscribe();
    }, [bottomViewModelSubject$]);

    const openNote = (file: TFile, newTab = false) => {
        workspace.openLinkText(file.path, "", newTab);
    };

    const handleNoteClick = (e: React.MouseEvent, file: TFile) => {
        e.preventDefault();
        openNote(file, e.ctrlKey || e.metaKey);
    };

    const handleContextMenu = (e: React.MouseEvent, file: TFile) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((item) =>
            item.setTitle("Open link").onClick(() => {
                openNote(file, false);
            })
        );
        menu.addItem((item) =>
            item.setTitle("Open in new tab").onClick(() => {
                openNote(file, true);
            })
        );
        menu.addSeparator();
        menu.addItem((item) =>
            item.setTitle("Copy Obsidian URL").onClick(() => {
                const uri = `obsidian://open?vault=${vaultName}&file=${file.path}`;
                navigator.clipboard.writeText(uri);
            })
        );
        menu.showAtMouseEvent(e.nativeEvent);
    };

    const toggleCollapse = () => {
        setCollapsed(!collapsed);
    };

    return (
        <div className="similar-notes-container">
            <SimilarNotesHeader
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
            />
            <SimilarNotesContent
                similarNotes={similarNotes}
                onNoteClick={handleNoteClick}
                onContextMenu={handleContextMenu}
                isCollapsed={collapsed}
            />
        </div>
    );
};

export default NoteBottomViewReact;

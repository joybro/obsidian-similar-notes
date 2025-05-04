import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { MarkdownView } from "obsidian";
import { useEffect, useState } from "react";
import type { Observable } from "rxjs";

export interface SimilarNoteEntry {
    file: TFile;
    title: string;
    similarity: number;
}

export interface NoteBottomViewModel {
    currentFile: TFile;
    similarNoteEntries: SimilarNoteEntry[];
}

interface SimilarNotesHeaderProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
}

interface SimilarNotesContentProps {
    similarNotes: SimilarNoteEntry[];
    onNoteClick: (file: TFile) => void;
    isCollapsed: boolean;
}

interface SimilarNotesViewProps {
    app: App;
    leaf: WorkspaceLeaf;
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
                const handleKeyDown = (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                        onNoteClick(note.file);
                        e.preventDefault();
                    }
                };

                return (
                    <div
                        key={note.file.path}
                        className="similar-notes-item tree-item-self is-clickable"
                        draggable="true"
                        onClick={() => onNoteClick(note.file)}
                        onKeyDown={handleKeyDown}
                    >
                        <div className="tree-item-inner">{note.title}</div>
                        <div className="tree-item-flair-outer">
                            {note.similarity.toFixed(2)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// Main Component
const SimilarNotesViewReact: React.FC<SimilarNotesViewProps> = ({
    app,
    leaf,
    bottomViewModelSubject$,
}) => {
    const [collapsed, setCollapsed] = useState(false);
    const [similarNotes, setSimilarNotes] = useState<SimilarNoteEntry[]>([]);

    const handleNewModel = (model: NoteBottomViewModel) => {
        if (!(leaf.view instanceof MarkdownView)) {
            throw new Error("Leaf is not a MarkdownView");
        }

        if (leaf.view.file !== model.currentFile) {
            return;
        }

        setSimilarNotes(model.similarNoteEntries);
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies(handleNewModel):
    useEffect(() => {
        const sub = bottomViewModelSubject$.subscribe(handleNewModel);
        return () => sub.unsubscribe();
    }, [bottomViewModelSubject$]);

    const handleNoteClick = (file: TFile) => {
        app.workspace.getLeaf().openFile(file);
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
                isCollapsed={collapsed}
            />
        </div>
    );
};

export default SimilarNotesViewReact;

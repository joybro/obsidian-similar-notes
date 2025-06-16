import type { MarkdownView, TFile, Workspace } from "obsidian";
import { Menu } from "obsidian";
import { useEffect, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import type { Observable } from "rxjs";

export interface SimilarNoteEntry {
    file: TFile;
    title: string;
    similarity: number;
    preview: string;
    sourceChunk?: string;
}

export interface NoteBottomViewModel {
    currentFile: TFile | null;
    similarNoteEntries: SimilarNoteEntry[];
}

interface SimilarNotesHeaderProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
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
            className="tree-item-self is-clickable"
            onClick={onToggleCollapse}
            onKeyDown={handleKeyDown}
        >
            <div
                className={`similar-notes-title tree-item-itself is-clickable ${
                    collapsed ? "is-collapsed" : ""
                }`}
            >
                <div className="tree-item-inner">Similar notes</div>
            </div>
        </div>
    );
};

const SearchResultPreview = ({
    preview,
    sourceChunk,
    isOpen,
}: {
    preview: string;
    sourceChunk?: string;
    isOpen: boolean;
}) => {
    const nodeRef = useRef<HTMLDivElement>(null);
    const duration = 100;

    const onEnter = () => {
        const el = nodeRef.current;
        if (el) {
            el.style.height = "0px";
            el.style.overflow = "hidden";
        }
    };

    const onEntering = () => {
        const el = nodeRef.current;
        if (el) {
            el.style.height = `${el.scrollHeight}px`;
        }
    };

    const onEntered = () => {
        const el = nodeRef.current;
        if (el) {
            el.style.height = "";
            el.style.overflow = "";
        }
    };

    const onExit = () => {
        const el = nodeRef.current;
        if (el) {
            el.style.height = `${el.scrollHeight}px`;
            el.style.overflow = "hidden";
        }
    };

    const onExiting = () => {
        const el = nodeRef.current;
        if (el) {
            el.style.height = "0px";
        }
    };

    const onExited = () => {
        const el = nodeRef.current;
        if (el) {
            el.style.height = "";
            el.style.overflow = "";
        }
    };

    return (
        <CSSTransition
            in={isOpen}
            timeout={duration}
            classNames="dynamic"
            nodeRef={nodeRef}
            onEnter={onEnter}
            onEntering={onEntering}
            onEntered={onEntered}
            onExit={onExit}
            onExiting={onExiting}
            onExited={onExited}
            unmountOnExit
        >
            <div
                ref={nodeRef}
                className="search-result-file-matches"
                style={{
                    transition: `height ${duration}ms cubic-bezier(0.02, 0.01, 0.47, 1)`,
                }}
            >
                <div className="search-result-file-match tappable">
                    {preview}
                </div>
                {sourceChunk && (
                    <div className="search-result-file-match tappable">
                        <div
                            style={{ fontWeight: "bold", textAlign: "center" }}
                        >
                            Source
                        </div>
                        <div style={{ textAlign: "left" }}>{sourceChunk}</div>
                    </div>
                )}
            </div>
        </CSSTransition>
    );
};

const SearchResult = ({
    note,
    onNoteClick,
    onContextMenu,
}: {
    note: SimilarNoteEntry;
    onNoteClick: (e: React.MouseEvent, file: TFile) => void;
    onContextMenu: (e: React.MouseEvent, file: TFile) => void;
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true);

    const toggleCollapse = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsCollapsed((prev) => !prev);
    };

    return (
        <div
            className={
                isCollapsed
                    ? "tree-item search-result is-collapsed"
                    : "tree-item search-result"
            }
        >
            <div
                className="tree-item-self search-result-file-title is-clickable"
                draggable="true"
                onClick={(e) => onNoteClick(e, note.file)}
                onKeyDown={() => {}}
                onContextMenu={(e) => onContextMenu(e, note.file)}
            >
                <div
                    className={
                        isCollapsed
                            ? "tree-item-icon collapse-icon is-collapsed"
                            : "tree-item-icon collapse-icon"
                    }
                    onKeyDown={() => {}}
                    onClick={toggleCollapse}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="svg-icon right-triangle"
                    >
                        <title>collapse-icon</title>
                        <path d="M3 8L12 17L21 8" />
                    </svg>
                </div>
                <div className="tree-item-inner">{note.title}</div>
                <div className="tree-item-flair-outer">
                    <div className="tree-item-flair">
                        {note.similarity.toFixed(2)}
                    </div>
                </div>
            </div>
            <SearchResultPreview
                preview={note.preview}
                sourceChunk={note.sourceChunk}
                isOpen={!isCollapsed}
            />
        </div>
    );
};

const SearchResultsContainer = ({
    similarNotes,
    onNoteClick,
    onContextMenu,
}: {
    similarNotes: SimilarNoteEntry[];
    onNoteClick: (e: React.MouseEvent, file: TFile) => void;
    onContextMenu: (e: React.MouseEvent, file: TFile) => void;
}) => {
    if (similarNotes.length === 0) {
        return (
            <div className="search-result-container">
                <div className="search-empty-state">
                    No similar notes found.
                </div>
            </div>
        );
    }

    return (
        <div className="search-result-container">
            <div className="search-results-children">
                {similarNotes.map((note, i) => (
                    <SearchResult
                        key={note.file.path}
                        note={note}
                        onNoteClick={onNoteClick}
                        onContextMenu={onContextMenu}
                    />
                ))}
            </div>
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
        <>
            <div className="nav-header" />
            <div className="similar-notes-pane">
                <SimilarNotesHeader
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapse}
                />
                {!collapsed && (
                    <SearchResultsContainer
                        similarNotes={similarNotes}
                        onNoteClick={handleNoteClick}
                        onContextMenu={handleContextMenu}
                    />
                )}
            </div>
        </>
    );
};

export default NoteBottomViewReact;

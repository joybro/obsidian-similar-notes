import { getNoteDisplayText } from "@/utils/displayUtils";
import type { SearchMode } from "@/domain/model/SearchMode";
import type { MarkdownView, TFile, Workspace } from "obsidian";
import { Menu } from "obsidian";
import { useEffect, useLayoutEffect, useState } from "react";
import type { Observable } from "rxjs";

export interface SimilarNoteEntry {
    file: TFile;
    title: string;
    similarity: number;
    preview: string;
    sourceChunk?: string;
    isLinked: boolean;
}

export interface NoteBottomViewModel {
    currentFile: TFile | null;
    similarNoteEntries: SimilarNoteEntry[];
    noteDisplayMode: "title" | "path" | "smart";
    sidebarResultCount: number;
    bottomResultCount: number;
    searchMode: SearchMode;
    codeModeEnabled: boolean;
}

interface SimilarNotesHeaderProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
    searchMode: SearchMode;
    codeModeEnabled: boolean;
    onSearchModeChange?: (mode: SearchMode) => void;
}

export type ViewType = "sidebar" | "bottom";

interface NoteBottomViewProps {
    workspace: Workspace;
    vaultName: string;
    leaf: MarkdownView;
    bottomViewModelSubject$: Observable<NoteBottomViewModel>;
    viewType: ViewType;
    onSearchModeChange?: (mode: SearchMode) => void;
}

// Header Component
const SimilarNotesHeader: React.FC<SimilarNotesHeaderProps> = ({
    collapsed,
    onToggleCollapse,
    searchMode,
    codeModeEnabled,
    onSearchModeChange,
}) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            onToggleCollapse();
            e.preventDefault();
        }
    };

    return (
        <div className="similar-notes-header tree-item-self">
            <div
                className={`similar-notes-title tree-item-itself is-clickable ${
                    collapsed ? "is-collapsed" : ""
                }`}
                onClick={onToggleCollapse}
                onKeyDown={handleKeyDown}
            >
                <div className="tree-item-inner">Similar notes</div>
            </div>
            {codeModeEnabled && !collapsed ? (
                <div
                    className="similar-notes-mode-switcher"
                    role="group"
                    aria-label="Similarity mode"
                >
                    {(["notes", "code"] as const).map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            className={searchMode === mode ? "is-active" : ""}
                            aria-pressed={searchMode === mode}
                            onClick={() => onSearchModeChange?.(mode)}
                        >
                            {mode === "notes" ? "Notes" : "Code"}
                        </button>
                    ))}
                </div>
            ) : null}
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
    // CSS-only animation approach, no need for React Transition Group
    return (
        <div
            className={`search-result-file-matches ${
                !isOpen ? "is-collapsed" : ""
            }`}
        >
            <div className="search-result-file-match tappable">{preview}</div>
            {sourceChunk && (
                <div className="search-result-file-match tappable">
                    <div style={{ fontWeight: "bold", textAlign: "center" }}>
                        Source
                    </div>
                    <div style={{ textAlign: "left" }}>{sourceChunk}</div>
                </div>
            )}
        </div>
    );
};

const SearchResult = ({
    note,
    onNoteClick,
    onContextMenu,
    noteDisplayMode,
    allSimilarNotes,
}: {
    note: SimilarNoteEntry;
    onNoteClick: (e: React.MouseEvent, file: TFile) => void;
    onContextMenu: (e: React.MouseEvent, file: TFile) => void;
    noteDisplayMode: "title" | "path" | "smart";
    allSimilarNotes: SimilarNoteEntry[];
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true);
    // Separate state to control whether the component is rendered in the DOM
    const [shouldRender, setShouldRender] = useState(false);
    // Additional state for animation when expanding
    const [isAnimating, setIsAnimating] = useState(false);

    // Animation duration (must match the value in styles.css)
    const animationDuration = 200;

    // Execute when isCollapsed state changes
    // Using useLayoutEffect to synchronize animation states before paint
    // This pattern is intentional for animation synchronization
    useLayoutEffect(() => {
        if (isCollapsed) {
            // When collapsing: Start the animation
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsAnimating(true);

            // Remove from DOM after animation completes
            const timer = setTimeout(() => {
                setShouldRender(false);
                setIsAnimating(false);
            }, animationDuration);
            return () => clearTimeout(timer);
        }
        // When expanding:
        // 1. First render in collapsed state
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShouldRender(true);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsAnimating(true);

        // 2. Start animation in the next frame
        const timer = setTimeout(() => {
            setIsAnimating(false);
        }, 20); // Short delay to ensure browser has time to render the collapsed state
        return () => clearTimeout(timer);
    }, [isCollapsed]);

    const toggleCollapse = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsCollapsed((prev) => !prev);
    };

    const handleDragStart = (e: React.DragEvent) => {
        // Set full path (with .md) so the drop handler can resolve the file
        // and compute the proper link text via fileToLinktext
        const linkText = `[[${note.file.path}]]`;
        e.dataTransfer.setData("text/plain", linkText);
        e.dataTransfer.setData("text/html", `<a href="${note.file.path}">${linkText}</a>`);

        e.dataTransfer.effectAllowed = "all";
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
                onDragStart={handleDragStart}
                onClick={(e) => onNoteClick(e, note.file)}
                onKeyDown={undefined}
                onContextMenu={(e) => onContextMenu(e, note.file)}
            >
                <div
                    className={
                        isCollapsed
                            ? "tree-item-icon collapse-icon is-collapsed"
                            : "tree-item-icon collapse-icon"
                    }
                    onKeyDown={undefined}
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
                <div className="tree-item-inner" title={note.file.path}>
                    {note.isLinked && (
                        <span
                            className="similar-notes-linked-tag"
                            aria-label="Already linked"
                            title="Already linked"
                        >
                            linked
                        </span>
                    )}
                    {getNoteDisplayText(
                        note.file,
                        note.title,
                        { noteDisplayMode },
                        allSimilarNotes.map((entry) => entry.file)
                    )}
                </div>
                <div className="tree-item-flair-outer">
                    <div className="tree-item-flair">
                        {note.similarity.toFixed(2)}
                    </div>
                </div>
            </div>
            {shouldRender && (
                <SearchResultPreview
                    preview={note.preview}
                    sourceChunk={note.sourceChunk}
                    isOpen={!isAnimating}
                />
            )}
        </div>
    );
};

const SearchResultsContainer = ({
    similarNotes,
    onNoteClick,
    onContextMenu,
    noteDisplayMode,
    searchMode,
}: {
    similarNotes: SimilarNoteEntry[];
    onNoteClick: (e: React.MouseEvent, file: TFile) => void;
    onContextMenu: (e: React.MouseEvent, file: TFile) => void;
    noteDisplayMode: "title" | "path" | "smart";
    searchMode: SearchMode;
}) => {
    if (similarNotes.length === 0) {
        return (
            <div className="search-result-container">
                <div className="search-empty-state">
                    {searchMode === "code"
                        ? "No similar code blocks found."
                        : "No similar notes found."}
                </div>
            </div>
        );
    }

    return (
        <div className="search-result-container">
            <div className="search-results-children">
                {similarNotes.map((note) => (
                    <SearchResult
                        key={note.file.path}
                        note={note}
                        onNoteClick={onNoteClick}
                        onContextMenu={onContextMenu}
                        noteDisplayMode={noteDisplayMode}
                        allSimilarNotes={similarNotes}
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
    viewType,
    onSearchModeChange,
}) => {
    const [collapsed, setCollapsed] = useState(false);
    const [similarNotes, setSimilarNotes] = useState<SimilarNoteEntry[]>([]);
    const [noteDisplayMode, setNoteDisplayMode] = useState<
        "title" | "path" | "smart"
    >("title");
    const [searchMode, setSearchMode] = useState<SearchMode>("notes");
    const [codeModeEnabled, setCodeModeEnabled] = useState(false);

    useEffect(() => {
        const sub = bottomViewModelSubject$.subscribe((model: NoteBottomViewModel) => {
            if (leaf.file !== model.currentFile) {
                return;
            }

            const limit = viewType === "sidebar"
                ? model.sidebarResultCount
                : model.bottomResultCount;
            setSimilarNotes(model.similarNoteEntries.slice(0, limit));
            setNoteDisplayMode(model.noteDisplayMode);
            setSearchMode(model.searchMode);
            setCodeModeEnabled(model.codeModeEnabled);
        });
        return () => sub.unsubscribe();
    }, [bottomViewModelSubject$, leaf.file, viewType]);

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
        setCollapsed((current) => !current);
    };

    return (
        <>
            <div className="nav-header" />
            <div className="similar-notes-pane">
                <SimilarNotesHeader
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapse}
                    searchMode={searchMode}
                    codeModeEnabled={codeModeEnabled}
                    onSearchModeChange={onSearchModeChange}
                />
                {!collapsed && (
                    <SearchResultsContainer
                        similarNotes={similarNotes}
                        onNoteClick={handleNoteClick}
                        onContextMenu={handleContextMenu}
                        noteDisplayMode={noteDisplayMode}
                        searchMode={searchMode}
                    />
                )}
            </div>
        </>
    );
};

export default NoteBottomViewReact;

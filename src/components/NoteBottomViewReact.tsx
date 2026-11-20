import { getNoteDisplayText } from "@/utils/displayUtils";
import type { HoverParent, MarkdownView, TFile, Workspace } from "obsidian";
import { Menu } from "obsidian";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Observable } from "rxjs";
import { AddLinkButton, useAddNoteLink } from "./noteLinkAction";
import { triggerHoverLink } from "./hoverLinkPreview";
import { logRejection } from "@/utils/logRejection";

export interface SimilarNoteEntry {
    file: TFile;
    title: string;
    similarity: number;
    preview: string;
    sourceChunk?: string;
    isLinked: boolean;
}

/**
 * Why the results list is empty, so the panel can say something true
 * (docs/panel-empty-states-spec.md). Undefined means "not computed" and
 * reads like "none".
 */
export type EmptyReason =
    | { kind: "unwritten" }
    | { kind: "excluded-cloud"; provider: "OpenAI" | "Gemini" }
    | { kind: "embedding-failed" }
    | { kind: "below-threshold"; threshold: number }
    | { kind: "indexing"; remaining: number }
    | { kind: "none" };

export function emptyStateText(reason: EmptyReason | undefined): string {
    switch (reason?.kind) {
        case "unwritten":
            return "Write a few lines and similar notes will appear here.";
        case "excluded-cloud":
            return `This note is excluded from the index, so it isn't sent to ${reason.provider}.`;
        case "embedding-failed":
            return "Couldn't analyze this note. Check the model in Settings, then reopen the note.";
        case "below-threshold":
            return `No notes above the minimum similarity (${reason.threshold.toFixed(2)}).`;
        case "indexing": {
            const n = reason.remaining.toLocaleString("en-US");
            const noun = reason.remaining === 1 ? "note" : "notes";
            return `Indexing your vault: ${n} ${noun} left. Results fill in as notes are indexed.`;
        }
        default:
            return "No similar notes found.";
    }
}

export interface NoteBottomViewModel {
    currentFile: TFile | null;
    similarNoteEntries: SimilarNoteEntry[];
    showLinkButton: boolean;
    emptyReason?: EmptyReason;
    noteDisplayMode: "title" | "path" | "smart";
    sidebarResultCount: number;
    bottomResultCount: number;
}

interface SimilarNotesHeaderProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
}

export type ViewType = "sidebar" | "bottom";

interface NoteBottomViewProps {
    workspace: Workspace;
    vaultName: string;
    leaf: MarkdownView;
    bottomViewModelSubject$: Observable<NoteBottomViewModel>;
    viewType: ViewType;
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
    onNoteHover,
    onContextMenu,
    onAddLink,
    noteDisplayMode,
    allSimilarNotes,
}: {
    note: SimilarNoteEntry;
    onNoteClick: (e: React.MouseEvent, file: TFile) => void;
    onNoteHover: (e: React.MouseEvent, file: TFile) => void;
    onContextMenu: (e: React.MouseEvent, file: TFile) => void;
    /** Present only when the Link button setting is on. */
    onAddLink?: (file: TFile) => void;
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
            // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect -- animation state must flip in the same layout pass
            setIsAnimating(true);

            // Remove from DOM after animation completes
            const timer = window.setTimeout(() => {
                setShouldRender(false);
                setIsAnimating(false);
            }, animationDuration);
            return () => window.clearTimeout(timer);
        }
        // When expanding:
        // 1. First render in collapsed state
        // eslint-disable-next-line @eslint-react/set-state-in-effect -- animation state must flip in the same layout pass
        setShouldRender(true);
        // eslint-disable-next-line @eslint-react/set-state-in-effect -- animation state must flip in the same layout pass
        setIsAnimating(true);

        // 2. Start animation in the next frame
        const timer = window.setTimeout(() => {
            setIsAnimating(false);
        }, 20); // Short delay to ensure browser has time to render the collapsed state
        return () => window.clearTimeout(timer);
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
                onMouseOver={(e) => onNoteHover(e, note.file)}
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
                <div className={`tree-item-flair-outer${onAddLink && !note.isLinked ? " similar-notes-result-actions" : ""}`}>
                    {onAddLink && !note.isLinked && (
                        <AddLinkButton title={note.title} onClick={() => onAddLink(note.file)} />
                    )}
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
    emptyReason,
    onNoteClick,
    onNoteHover,
    onContextMenu,
    onAddLink,
    noteDisplayMode,
}: {
    similarNotes: SimilarNoteEntry[];
    emptyReason?: EmptyReason;
    onNoteClick: (e: React.MouseEvent, file: TFile) => void;
    onNoteHover: (e: React.MouseEvent, file: TFile) => void;
    onContextMenu: (e: React.MouseEvent, file: TFile) => void;
    /** Present only when the Link button setting is on. */
    onAddLink?: (file: TFile) => void;
    noteDisplayMode: "title" | "path" | "smart";
}) => {
    if (similarNotes.length === 0) {
        return (
            <div className="search-result-container">
                <div
                    className={
                        // A confirmed failure that won't clear by itself reads red;
                        // fixed guidance and self-resolving states stay grey.
                        emptyReason?.kind === "embedding-failed"
                            ? "search-empty-state is-error"
                            : "search-empty-state"
                    }
                >
                    {emptyStateText(emptyReason)}
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
                        onNoteHover={onNoteHover}
                        onContextMenu={onContextMenu}
                        onAddLink={onAddLink}
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
}) => {
    const [collapsed, setCollapsed] = useState(false);
    const [similarNotes, setSimilarNotes] = useState<SimilarNoteEntry[]>([]);
    const [emptyReason, setEmptyReason] = useState<EmptyReason | undefined>();
    const [sourceFile, setSourceFile] = useState<TFile | null>(null);
    const [showLinkButton, setShowLinkButton] = useState(false);
    const [noteDisplayMode, setNoteDisplayMode] = useState<
        "title" | "path" | "smart"
    >("title");

    useEffect(() => {
        const sub = bottomViewModelSubject$.subscribe((model: NoteBottomViewModel) => {
            if (leaf.file !== model.currentFile) {
                return;
            }

            const limit = viewType === "sidebar"
                ? model.sidebarResultCount
                : model.bottomResultCount;
            setSourceFile(model.currentFile);
            setShowLinkButton(model.showLinkButton);
            setSimilarNotes(model.similarNoteEntries.slice(0, limit));
            setEmptyReason(model.emptyReason);
            setNoteDisplayMode(model.noteDisplayMode);
        });
        return () => sub.unsubscribe();
    }, [bottomViewModelSubject$, leaf.file, viewType]);

    const openNote = (file: TFile, newTab = false) => {
        logRejection(workspace.openLinkText(file.path, "", newTab), "open note");
    };

    const handleNoteClick = (e: React.MouseEvent, file: TFile) => {
        e.preventDefault();
        openNote(file, e.ctrlKey || e.metaKey);
    };

    const handleAddLink = useAddNoteLink({
        leaf,
        workspace,
        viewType,
        sourceFile,
        markLinked: (target) => setSimilarNotes((notes) =>
            notes.map((note) =>
                note.file.path === target.path ? { ...note, isLinked: true } : note
            )
        ),
    });

    // Page Preview only reads/writes `.hoverPopover` on the parent, so a plain
    // stable object is a sufficient HoverParent for this React component.
    const hoverParentRef = useRef<HoverParent>({ hoverPopover: null });

    const handleNoteHover = (e: React.MouseEvent, file: TFile) => {
        triggerHoverLink(
            workspace,
            e.nativeEvent,
            hoverParentRef.current,
            e.currentTarget as HTMLElement,
            file.path
        );
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
                logRejection(navigator.clipboard.writeText(uri), "copy Obsidian URL");
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
                        emptyReason={emptyReason}
                        onNoteClick={handleNoteClick}
                        onNoteHover={handleNoteHover}
                        onContextMenu={handleContextMenu}
                        onAddLink={showLinkButton ? handleAddLink : undefined}
                        noteDisplayMode={noteDisplayMode}
                    />
                )}
            </div>
        </>
    );
};

export default NoteBottomViewReact;

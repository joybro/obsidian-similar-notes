import { getNoteDisplayText } from "@/utils/displayUtils";
import type { App, TFile } from "obsidian";
import { Modal, Notice } from "obsidian";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { SearchMode } from "@/domain/model/SearchMode";
import type { TextSearch } from "@/domain/service/TextSearchService";
import {
    createNoteFromQuery,
    handleSemanticSearchKey,
    insertLinkForNote,
} from "./semanticSearchActions";
import {
    MIN_SEARCH_LENGTH,
    useSemanticSearch,
} from "./useSemanticSearch";

// Platform-specific modifier keys
const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const MOD_KEY = isMac ? "\u2318" : "Ctrl";
const ALT_KEY = isMac ? "\u2325" : "Alt";

const SearchInstructions: React.FC = () => (
    <div className="prompt-instructions">
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">↑↓</span>
            <span>to navigate</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">↵</span>
            <span>to open</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">{MOD_KEY} ↵</span>
            <span>to open in new tab</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">shift ↵</span>
            <span>to create note</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">{ALT_KEY} ↵</span>
            <span>to insert as link</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">esc</span>
            <span>to dismiss</span>
        </div>
    </div>
);

interface SearchResultItemProps {
    note: SimilarNote;
    file: TFile | null;
    isSelected: boolean;
    noteDisplayMode: "title" | "path" | "smart";
    allFiles: TFile[];
    onSelect: () => void;
    onOpen: (newTab: boolean) => void;
    onInsertLink: () => void;
}

const SearchResultItem: React.FC<SearchResultItemProps> = ({
    note,
    file,
    isSelected,
    noteDisplayMode,
    allFiles,
    onSelect,
    onOpen,
    onInsertLink,
}) => {
    const itemRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isSelected && itemRef.current) {
            itemRef.current.scrollIntoView({ block: "nearest" });
        }
    }, [isSelected]);

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (e.altKey) {
            onInsertLink();
        } else {
            onOpen(e.metaKey || e.ctrlKey);
        }
    };

    const displayText = file
        ? getNoteDisplayText(file, note.title, { noteDisplayMode }, allFiles)
        : note.title;

    return (
        <div
            ref={itemRef}
            className={`suggestion-item mod-complex ${isSelected ? "is-selected" : ""}`}
            onClick={handleClick}
            onMouseEnter={onSelect}
        >
            <div className="suggestion-content">
                <div className="suggestion-title">{displayText}</div>
            </div>
            <div className="suggestion-aux">
                <span className="suggestion-flair semantic-search-score">
                    {note.similarity.toFixed(2)}
                </span>
            </div>
        </div>
    );
};

interface SemanticSearchContentProps {
    app: App;
    textSearchService: TextSearch;
    codeSearchService?: TextSearch;
    codeModeEnabled: boolean;
    noteDisplayMode: "title" | "path" | "smart";
    onClose: () => void;
}

const SearchModeSwitcher: React.FC<{
    searchMode: SearchMode;
    onChange: (mode: SearchMode) => void;
}> = ({ searchMode, onChange }) => (
    <div
        className="semantic-search-mode-switcher"
        role="group"
        aria-label="Semantic search mode"
    >
        {(["notes", "code"] as const).map((mode) => (
            <button
                key={mode}
                type="button"
                className={searchMode === mode ? "is-active" : ""}
                aria-pressed={searchMode === mode}
                onClick={() => onChange(mode)}
            >
                {mode === "notes" ? "Notes" : "Code"}
            </button>
        ))}
    </div>
);

const SemanticSearchContent: React.FC<SemanticSearchContentProps> = ({
    app,
    textSearchService,
    codeSearchService,
    codeModeEnabled,
    noteDisplayMode,
    onClose,
}) => {
    const [searchMode, setSearchMode] = useState<SearchMode>("notes");
    const {
        query, setQuery,
        results,
        selectedIndex,
        setSelectedIndex,
        isSearching,
        tokenWarning,
        invalidateSearch,
    } = useSemanticSearch(textSearchService, codeSearchService, searchMode);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const resultFiles = useMemo(() => {
        return results.map((note) => {
            const file = app.vault.getAbstractFileByPath(note.path);
            return file instanceof app.vault.adapter.constructor
                ? null
                : (file as TFile | null);
        });
    }, [results, app.vault]);

    const allFiles = useMemo(() => {
        return resultFiles.filter((f): f is TFile => f !== null);
    }, [resultFiles]);

    const openNote = useCallback(
        (index: number, newTab: boolean) => {
            const note = results[index];
            if (!note) return;

            app.workspace.openLinkText(note.path, "", newTab);
            onClose();
        },
        [results, app.workspace, onClose]
    );

    const insertLink = useCallback(
        (index: number) => {
            const note = results[index];
            if (!note) return;
            const inserted = insertLinkForNote(app, note.path);
            if (!inserted) {
                new Notice(
                    "Similar Notes: open a note in edit mode to insert a link"
                );
            }
            // Intentionally do NOT close the modal — allow inserting several links.
        },
        [results, app]
    );

    const createNote = useCallback(async () => {
        const created = await createNoteFromQuery(app, query);
        if (created) onClose();
    }, [app, query, onClose]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            handleSemanticSearchKey(e, {
                resultCount: results.length,
                moveSelection: (delta) =>
                    setSelectedIndex((prev) => {
                        const next = prev + delta;
                        if (next < 0) return 0;
                        if (next > results.length - 1) return results.length - 1;
                        return next;
                    }),
                open: (newTab) => openNote(selectedIndex, newTab),
                insertLink: () => insertLink(selectedIndex),
                createNote: () => {
                    void createNote();
                },
                close: onClose,
            });
        },
        [results, selectedIndex, setSelectedIndex, openNote, insertLink, createNote, onClose]
    );
    const changeSearchMode = useCallback(
        (mode: SearchMode) => {
            if (mode === searchMode) return;
            invalidateSearch();
            setSearchMode(mode);
        },
        [invalidateSearch, searchMode]
    );

    return (
        <div className="semantic-search-wrapper" onKeyDown={handleKeyDown}>
            {codeModeEnabled && codeSearchService ? (
                <SearchModeSwitcher
                    searchMode={searchMode}
                    onChange={changeSearchMode}
                />
            ) : null}
            <div className="prompt-input-container">
                <input
                    ref={inputRef}
                    type="text"
                    className="prompt-input"
                    placeholder={
                        searchMode === "code"
                            ? "Search fenced code blocks..."
                            : "Search by semantic similarity..."
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                {isSearching && <div className="semantic-search-spinner" />}
            </div>

            {tokenWarning && (
                <div className="semantic-search-warning">{tokenWarning}</div>
            )}

            <div className="prompt-results">
                {query.length > 0 && query.length < MIN_SEARCH_LENGTH && (
                    <div className="prompt-empty-state">
                        Type at least {MIN_SEARCH_LENGTH} characters to search
                    </div>
                )}
                {query.length >= MIN_SEARCH_LENGTH &&
                    !isSearching &&
                    results.length === 0 && (
                    <div className="prompt-empty-state">
                        {searchMode === "code"
                            ? "No similar code blocks found"
                            : "No similar notes found"}
                    </div>
                )}
                {results.map((note, index) => {
                    const file = app.vault.getAbstractFileByPath(note.path) as TFile | null;
                    return (
                        <SearchResultItem
                            key={note.path}
                            note={note}
                            file={file}
                            isSelected={index === selectedIndex}
                            noteDisplayMode={noteDisplayMode}
                            allFiles={allFiles}
                            onSelect={() => setSelectedIndex(index)}
                            onOpen={(newTab) => openNote(index, newTab)}
                            onInsertLink={() => insertLink(index)}
                        />
                    );
                })}
            </div>

            <SearchInstructions />
        </div>
    );
};

export class SemanticSearchModal extends Modal {
    private root: Root | null = null;
    private textSearchService: TextSearch;
    private codeSearchService?: TextSearch;
    private codeModeEnabled: boolean;
    private noteDisplayMode: "title" | "path" | "smart";

    constructor(
        app: App,
        textSearchService: TextSearch,
        noteDisplayMode: "title" | "path" | "smart",
        codeSearchService?: TextSearch,
        codeModeEnabled = false
    ) {
        super(app);
        this.textSearchService = textSearchService;
        this.noteDisplayMode = noteDisplayMode;
        this.codeSearchService = codeSearchService;
        this.codeModeEnabled = codeModeEnabled;
    }

    onOpen() {
        const { modalEl } = this;

        // Remove modal class and add prompt class to match Quick Switcher styling
        modalEl.removeClass("modal");
        modalEl.addClass("prompt");
        modalEl.addClass("semantic-search-modal");

        // Remove unnecessary modal elements to match Quick Switcher structure
        modalEl.querySelector(".modal-close-button")?.remove();
        modalEl.querySelector(".modal-header")?.remove();
        modalEl.querySelector(".modal-content")?.remove();

        // Render directly to modalEl (like Quick Switcher)
        this.root = createRoot(modalEl);
        this.root.render(
            <SemanticSearchContent
                app={this.app}
                textSearchService={this.textSearchService}
                codeSearchService={this.codeSearchService}
                codeModeEnabled={this.codeModeEnabled}
                noteDisplayMode={this.noteDisplayMode}
                onClose={() => this.close()}
            />
        );
    }

    onClose() {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
        const { contentEl } = this;
        contentEl.empty();
    }
}

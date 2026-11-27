import { getNoteDisplayText } from "@/utils/displayUtils";
import type { App } from "obsidian";
import { Modal, Notice, Platform, TFile } from "obsidian";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { TextSearchService } from "@/domain/service/TextSearchService";
import {
    createNoteFromQuery,
    handleSemanticSearchKey,
    insertLinkForNote,
} from "./semanticSearchActions";
import { logRejection } from "@/utils/logRejection";

const MIN_SEARCH_LENGTH = 3;
const DEBOUNCE_MS = 300;

// Platform-specific modifier keys
const isMac = Platform.isMacOS;
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
    textSearchService: TextSearchService;
    noteDisplayMode: "title" | "path" | "smart";
    /** Close after opening a note or creating one. */
    onClose: () => void;
    /** Close without acting (Esc). */
    onDismiss: () => void;
}

function useSemanticSearch(textSearchService: TextSearchService) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SimilarNote[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isSearching, setIsSearching] = useState(false);
    // The query whose search last finished without error. "No similar notes
    // found" is only true for that query; while a newer query waits for its debounced search,
    // nothing is known about it yet.
    const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
    const [tokenWarning, setTokenWarning] = useState<string | null>(null);
    const debounceRef = useRef<number | null>(null);
    // A provider that is down fails every debounced search, so a notice per
    // failure would stack while the user types. Say it once per open modal
    // (this hook's state dies with the modal), and again only after a search
    // succeeds. No global cooldown: reopening after a settings change must be
    // able to say it again.
    const failureNoticeShownRef = useRef(false);

    const performSearch = useCallback(
        async (searchQuery: string) => {
            if (searchQuery.length < MIN_SEARCH_LENGTH) {
                setResults([]);
                setTokenWarning(null);
                return;
            }

            setIsSearching(true);
            try {
                const searchResult =
                    await textSearchService.findSimilarNotesFromText(searchQuery);

                if (searchResult.isOverLimit) {
                    setTokenWarning(
                        `Text truncated: ${searchResult.tokenCount}→${searchResult.maxTokens} tokens`
                    );
                } else {
                    setTokenWarning(null);
                }
                setResults(searchResult.similarNotes);
                setSelectedIndex(0);
                setSearchedQuery(searchQuery);
                failureNoticeShownRef.current = false;
            } catch (error) {
                console.error("Search error:", error);
                setResults([]);
                // A failed search found nothing out about this query, so it
                // must not read as "No similar notes found": leave
                // searchedQuery unset for it and say the search failed.
                setSearchedQuery(null);
                if (!failureNoticeShownRef.current) {
                    failureNoticeShownRef.current = true;
                    new Notice(
                        "Similar Notes: search failed. Check your model settings and try again."
                    );
                }
            } finally {
                setIsSearching(false);
            }
        },
        [textSearchService]
    );

    useEffect(() => {
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => void performSearch(query), DEBOUNCE_MS);
        return () => {
            if (debounceRef.current) window.clearTimeout(debounceRef.current);
        };
    }, [query, performSearch]);

    return { query, setQuery, results, selectedIndex, setSelectedIndex, isSearching, searchedQuery, tokenWarning };
}

const SemanticSearchContent: React.FC<SemanticSearchContentProps> = ({
    app,
    textSearchService,
    noteDisplayMode,
    onClose,
    onDismiss,
}) => {
    const { query, setQuery, results, selectedIndex, setSelectedIndex, isSearching, searchedQuery, tokenWarning } =
        useSemanticSearch(textSearchService);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const resultFiles = useMemo(() => {
        return results.map((note) => {
            const file = app.vault.getAbstractFileByPath(note.path);
            return file instanceof TFile ? file : null;
        });
    }, [results, app.vault]);

    const allFiles = useMemo(() => {
        return resultFiles.filter((f): f is TFile => f !== null);
    }, [resultFiles]);

    const openNote = useCallback(
        (index: number, newTab: boolean) => {
            const note = results[index];
            if (!note) return;

            logRejection(app.workspace.openLinkText(note.path, "", newTab), "open note");
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
                close: onDismiss,
            });
        },
        [results, selectedIndex, setSelectedIndex, openNote, insertLink, createNote, onDismiss]
    );

    return (
        <div className="semantic-search-wrapper" onKeyDown={handleKeyDown}>
            <div className="prompt-input-container">
                <input
                    ref={inputRef}
                    type="text"
                    className="prompt-input"
                    placeholder="Search by semantic similarity..."
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
                    searchedQuery === query &&
                    results.length === 0 && (
                    <div className="prompt-empty-state">No similar notes found</div>
                )}
                {results.map((note, index) => {
                    const found = app.vault.getAbstractFileByPath(note.path);
                    const file = found instanceof TFile ? found : null;
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

export interface SemanticSearchModalOptions {
    /**
     * Runs after the modal closes without opening or creating a note
     * (Esc, click outside), so the caller can take focus back.
     */
    onDismissed?: () => void;
}

export class SemanticSearchModal extends Modal {
    private root: Root | null = null;
    private textSearchService: TextSearchService;
    private noteDisplayMode: "title" | "path" | "smart";
    private options: SemanticSearchModalOptions;
    private actedOn = false;

    constructor(
        app: App,
        textSearchService: TextSearchService,
        noteDisplayMode: "title" | "path" | "smart",
        options: SemanticSearchModalOptions = {}
    ) {
        super(app);
        this.textSearchService = textSearchService;
        this.noteDisplayMode = noteDisplayMode;
        this.options = options;
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
                noteDisplayMode={this.noteDisplayMode}
                onClose={() => {
                    this.actedOn = true;
                    this.close();
                }}
                onDismiss={() => this.close()}
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
        const { onDismissed } = this.options;
        if (!this.actedOn && onDismissed) {
            // After Obsidian finishes its own close handling.
            window.setTimeout(onDismissed, 0);
        }
    }
}

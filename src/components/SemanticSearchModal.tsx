import { getNoteDisplayText } from "@/utils/displayUtils";
import type { App, TFile } from "obsidian";
import { MarkdownView, Modal } from "obsidian";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { TextSearchService } from "@/domain/service/TextSearchService";

const MIN_SEARCH_LENGTH = 3;
const DEBOUNCE_MS = 300;

// Platform-specific modifier keys
const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const MOD_KEY = isMac ? "\u2318" : "Ctrl";
const SHIFT_KEY = isMac ? "\u21E7" : "Shift";

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
            <span className="prompt-instruction-command">{SHIFT_KEY} ↵</span>
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
        if (e.shiftKey) {
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
    onClose: () => void;
}

function useSemanticSearch(textSearchService: TextSearchService) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SimilarNote[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isSearching, setIsSearching] = useState(false);
    const [tokenWarning, setTokenWarning] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            } catch (error) {
                console.error("Search error:", error);
                setResults([]);
            } finally {
                setIsSearching(false);
            }
        },
        [textSearchService]
    );

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => performSearch(query), DEBOUNCE_MS);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, performSearch]);

    return { query, setQuery, results, selectedIndex, setSelectedIndex, isSearching, tokenWarning };
}

const SemanticSearchContent: React.FC<SemanticSearchContentProps> = ({
    app,
    textSearchService,
    noteDisplayMode,
    onClose,
}) => {
    const { query, setQuery, results, selectedIndex, setSelectedIndex, isSearching, tokenWarning } =
        useSemanticSearch(textSearchService);
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

            const view = app.workspace.getActiveViewOfType(MarkdownView);
            if (!view?.editor) return;

            view.editor.replaceSelection(`[[${note.path}]]`);
            onClose();
        },
        [results, app.workspace, onClose]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedIndex((prev) =>
                        prev < results.length - 1 ? prev + 1 : prev
                    );
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
                    break;
                case "Enter":
                    e.preventDefault();
                    if (results.length > 0) {
                        if (e.shiftKey) {
                            insertLink(selectedIndex);
                        } else {
                            openNote(selectedIndex, e.metaKey || e.ctrlKey);
                        }
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    onClose();
                    break;
            }
        },
        [setSelectedIndex, results, selectedIndex, openNote, insertLink, onClose]
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
                    results.length === 0 && (
                    <div className="prompt-empty-state">No similar notes found</div>
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
    private textSearchService: TextSearchService;
    private noteDisplayMode: "title" | "path" | "smart";

    constructor(
        app: App,
        textSearchService: TextSearchService,
        noteDisplayMode: "title" | "path" | "smart"
    ) {
        super(app);
        this.textSearchService = textSearchService;
        this.noteDisplayMode = noteDisplayMode;
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

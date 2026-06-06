import {
    debounce,
    EditorSuggest,
    type App,
    type Debouncer,
    type Editor,
    type EditorPosition,
    type EditorSuggestContext,
    type EditorSuggestTriggerInfo,
    type TFile,
} from "obsidian";
import log from "loglevel";
import type { SettingsService } from "@/application/SettingsService";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { TextSearchService } from "@/domain/service/TextSearchService";
import { parseTrigger } from "./semanticLinkTrigger";
import { resolveWikilink } from "./semanticSearchActions";

// 1 char is the smallest meaningful semantic query (0 chars = no query to rank
// against). The built-in `[[` opens at 0 chars because it does instant local
// fuzzy matching; a semantic query needs at least something to embed.
export const MIN_SEARCH_LENGTH = 1;
export const DEBOUNCE_MS = 300;

/**
 * Editor suggester that opens on a standalone, configurable trigger (default
 * `;;`), runs a semantic search over the vault, and inserts a `[[wikilink]]` to
 * the selected note. Uses a non-`[[` trigger on purpose: Obsidian's built-in
 * link suggester is index 0 of `editorSuggest.suggests` and always wins on `[[`.
 */
export class SemanticLinkSuggest extends EditorSuggest<SimilarNote> {
    /**
     * Trailing debounce over the expensive embedding search. Each keystroke
     * resets the timer; only the last invocation's callback fires, so superseded
     * `getSuggestions` promises are simply left pending (never resolved) rather
     * than resolving to `[]` — returning `[]` would make Obsidian close the
     * popup, causing flicker/disappearance during fast typing.
     */
    private readonly debouncedSearch: Debouncer<
        [EditorSuggestContext, (suggestions: SimilarNote[]) => void],
        void
    >;

    constructor(
        app: App,
        private readonly textSearchService: TextSearchService,
        private readonly settingsService: SettingsService
    ) {
        super(app);
        this.debouncedSearch = debounce(
            (context: EditorSuggestContext, cb: (suggestions: SimilarNote[]) => void) => {
                void this.runSearch(context.query).then(cb);
            },
            DEBOUNCE_MS,
            true
        );
    }

    onTrigger(
        cursor: EditorPosition,
        editor: Editor,
        _file: TFile | null
    ): EditorSuggestTriggerInfo | null {
        const trigger = this.settingsService.get().semanticLinkTrigger;
        const lineUpToCursor = editor.getLine(cursor.line).slice(0, cursor.ch);

        const match = parseTrigger(lineUpToCursor, trigger);
        if (!match) return null;

        return {
            start: { line: cursor.line, ch: match.startCh },
            end: cursor,
            query: match.query,
        };
    }

    getSuggestions(context: EditorSuggestContext): Promise<SimilarNote[]> {
        if (context.query.length < MIN_SEARCH_LENGTH) {
            return Promise.resolve([]);
        }
        // The debounce drops every call but the last; a superseded call's
        // `resolve` is never invoked, so its promise stays pending and Obsidian
        // keeps showing the current suggestions until fresh ones arrive.
        return new Promise((resolve) => {
            this.debouncedSearch(context, resolve);
        });
    }

    private async runSearch(query: string): Promise<SimilarNote[]> {
        try {
            const result = await this.textSearchService.findSimilarNotesFromText(query);
            return result.similarNotes;
        } catch (error) {
            log.error("[SemanticLinkSuggest] search failed", error);
            return [];
        }
    }

    renderSuggestion(note: SimilarNote, el: HTMLElement): void {
        el.addClass("suggestion-item", "mod-complex");
        const content = el.createDiv({ cls: "suggestion-content" });
        content.createDiv({ cls: "suggestion-title", text: note.title });
        const aux = el.createDiv({ cls: "suggestion-aux" });
        aux.createSpan({
            cls: "suggestion-flair semantic-search-score",
            text: note.similarity.toFixed(2),
        });
    }

    selectSuggestion(note: SimilarNote, _evt: MouseEvent | KeyboardEvent): void {
        const context = this.context;
        if (!context) return;

        const sourcePath = context.file?.path ?? "";
        const wikilink = resolveWikilink(this.app, note.path, sourcePath);
        if (!wikilink) return;

        const inserted = `${wikilink} `;
        context.editor.replaceRange(inserted, context.start, context.end);
        context.editor.setCursor({
            line: context.start.line,
            ch: context.start.ch + inserted.length,
        });
    }
}

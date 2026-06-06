import {
    EditorSuggest,
    type App,
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

export const MIN_SEARCH_LENGTH = 3;
export const DEBOUNCE_MS = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Editor suggester that opens on a standalone, configurable trigger (default
 * `;;`), runs a semantic search over the vault, and inserts a `[[wikilink]]` to
 * the selected note. Uses a non-`[[` trigger on purpose: Obsidian's built-in
 * link suggester is index 0 of `editorSuggest.suggests` and always wins on `[[`.
 */
export class SemanticLinkSuggest extends EditorSuggest<SimilarNote> {
    /** Monotonic token used to discard superseded (stale) async searches. */
    private searchToken = 0;

    constructor(
        app: App,
        private readonly textSearchService: TextSearchService,
        private readonly settingsService: SettingsService
    ) {
        super(app);
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

    async getSuggestions(context: EditorSuggestContext): Promise<SimilarNote[]> {
        const query = context.query;
        if (query.length < MIN_SEARCH_LENGTH) return [];

        const token = ++this.searchToken;
        await sleep(DEBOUNCE_MS);
        if (token !== this.searchToken) return []; // superseded while debouncing

        try {
            const result = await this.textSearchService.findSimilarNotesFromText(query);
            if (token !== this.searchToken) return []; // superseded during search
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

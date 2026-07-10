import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { SearchMode } from "@/domain/model/SearchMode";
import type { TextSearch } from "@/domain/service/TextSearchService";
import { useCallback, useEffect, useRef, useState } from "react";

export const MIN_SEARCH_LENGTH = 3;
const DEBOUNCE_MS = 300;

export function useSemanticSearch(
    textSearchService: TextSearch,
    codeSearchService: TextSearch | undefined,
    searchMode: SearchMode
) {
    const [query, setQueryState] = useState("");
    const [results, setResults] = useState<SimilarNote[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isSearching, setIsSearching] = useState(false);
    const [tokenWarning, setTokenWarning] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestSequenceRef = useRef(0);
    const activeSearchService =
        searchMode === "code" ? codeSearchService : textSearchService;
    const activeSearchServiceRef = useRef(activeSearchService);
    activeSearchServiceRef.current = activeSearchService;

    const invalidateSearch = useCallback(() => {
        requestSequenceRef.current += 1;
        setResults([]);
        setSelectedIndex(0);
        setTokenWarning(null);
        setIsSearching(false);
    }, []);
    const setQuery = useCallback(
        (value: string) => {
            invalidateSearch();
            setQueryState(value);
        },
        [invalidateSearch]
    );

    const performSearch = useCallback(
        async (searchQuery: string, requestSequence: number) => {
            if (
                requestSequence !== requestSequenceRef.current ||
                activeSearchServiceRef.current !== activeSearchService
            ) {
                return;
            }
            if (searchQuery.length < MIN_SEARCH_LENGTH) {
                setResults([]);
                setTokenWarning(null);
                setIsSearching(false);
                return;
            }
            if (!activeSearchService) {
                setResults([]);
                setTokenWarning("Code index is not available");
                setIsSearching(false);
                return;
            }

            setIsSearching(true);
            try {
                const searchResult =
                    await activeSearchService.findSimilarNotesFromText(
                        searchQuery
                    );
                if (
                    requestSequence !== requestSequenceRef.current ||
                    activeSearchServiceRef.current !== activeSearchService
                ) {
                    return;
                }
                setTokenWarning(
                    searchResult.isOverLimit
                        ? `Text truncated: ${searchResult.tokenCount}→${searchResult.maxTokens} tokens`
                        : null
                );
                setResults(searchResult.similarNotes);
                setSelectedIndex(0);
            } catch (error) {
                if (requestSequence !== requestSequenceRef.current) return;
                console.error("Search error:", error);
                setResults([]);
            } finally {
                if (requestSequence === requestSequenceRef.current) {
                    setIsSearching(false);
                }
            }
        },
        [activeSearchService]
    );

    useEffect(() => {
        const requestSequence = ++requestSequenceRef.current;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(
            () => performSearch(query, requestSequence),
            DEBOUNCE_MS
        );
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, performSearch]);

    return {
        query,
        setQuery,
        results,
        selectedIndex,
        setSelectedIndex,
        isSearching,
        tokenWarning,
        invalidateSearch,
    };
}

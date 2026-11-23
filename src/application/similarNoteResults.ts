import type { SimilarNoteEntry } from "@/components/NoteBottomViewReact";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { SimilarNoteSearchStatus } from "@/domain/service/SimilarNoteFinder";
import log from "loglevel";
import type { TFile, Vault } from "obsidian";

export interface SimilarNoteCacheEntry {
    mtime: number;
    notes: SimilarNoteEntry[];
    status: SimilarNoteSearchStatus;
    // Searched while other notes were still queued: the index was not
    // complete, so the list may be short. Dropped once nothing else is
    // queued for this path.
    partial: boolean;
}

const MAX_CACHE_SIZE = 20;

/** Search results per note path, oldest dropped past MAX_CACHE_SIZE. */
export class SimilarNoteCache {
    private readonly entries = new Map<string, SimilarNoteCacheEntry>();

    get(path: string): SimilarNoteCacheEntry | undefined {
        return this.entries.get(path);
    }

    has(path: string): boolean {
        return this.entries.has(path);
    }

    set(path: string, entry: SimilarNoteCacheEntry) {
        this.entries.set(path, entry);
        if (this.entries.size > MAX_CACHE_SIZE) {
            const oldestKey = this.entries.keys().next().value as
                | string
                | undefined;
            if (oldestKey !== undefined) this.entries.delete(oldestKey);
        }
    }

    delete(path: string) {
        this.entries.delete(path);
    }

    clear() {
        this.entries.clear();
    }

    /**
     * A list found on an incomplete index is not final: once nothing else is
     * queued for its note, drop it so the next open searches again.
     */
    dropCompletedPartial(pendingOtherThan: (path: string) => number) {
        for (const [path, entry] of this.entries) {
            if (entry.partial && pendingOtherThan(path) === 0) {
                this.entries.delete(path);
            }
        }
    }
}

/**
 * Turn the finder's results into panel rows. A result whose file is gone
 * from the vault (renamed or moved before the index caught up) is dropped.
 */
export function toSimilarNoteEntries(
    vault: Vault,
    similarNotes: SimilarNote[],
    showSourceChunk: boolean
): SimilarNoteEntry[] {
    const entries: SimilarNoteEntry[] = [];
    for (const similarNote of similarNotes) {
        const file: TFile | null = vault.getFileByPath(similarNote.path);
        if (file === null) {
            log.error(
                `Stale data detected: similar note not found in vault (path: ${similarNote.path}). ` +
                    `This may indicate the file was renamed/moved but the index was not updated.`
            );
            continue;
        }
        entries.push({
            file,
            title: similarNote.title,
            similarity: similarNote.similarity,
            preview: similarNote.similarChunk,
            sourceChunk: showSourceChunk ? similarNote.sourceChunk : undefined,
            isLinked: similarNote.isLinked,
        });
    }
    return entries;
}

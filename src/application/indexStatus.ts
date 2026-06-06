import { shouldExcludeFile } from "@/utils/folderExclusion";

export interface IndexStatusCounts {
    total: number;
    excluded: number;
    errored: number;
    indexed: number;
    pending: number;
}

/**
 * Assign every markdown path to exactly one bucket by precedence, so the counts
 * are mutually exclusive and sum to total (indexing-status spec §3):
 *
 *   Excluded (glob) > Errored > Indexed > Pending (remainder)
 *
 * "Pending" is the remainder — files neither excluded, errored, nor indexed
 * (new / not-yet-processed). Real-time queue depth is surfaced separately by
 * the status bar's live "N to index" indicator.
 *
 * @param allPaths        Every markdown file path in the vault
 * @param excludePatterns Glob patterns from settings.excludeFolderPatterns
 * @param indexedPaths    Paths present in the mtime store
 * @param erroredPaths    Paths present in the errored store
 */
export function computeIndexStatus(
    allPaths: string[],
    excludePatterns: string[],
    indexedPaths: string[],
    erroredPaths: string[]
): IndexStatusCounts {
    const indexedSet = new Set(indexedPaths);
    const erroredSet = new Set(erroredPaths);

    let excluded = 0;
    let errored = 0;
    let indexed = 0;
    let pending = 0;

    for (const path of allPaths) {
        if (shouldExcludeFile(path, excludePatterns)) {
            excluded++;
        } else if (erroredSet.has(path)) {
            errored++;
        } else if (indexedSet.has(path)) {
            indexed++;
        } else {
            pending++;
        }
    }

    return { total: allPaths.length, excluded, errored, indexed, pending };
}

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
 *   Excluded > Errored > Indexed > Pending (remainder)
 *
 * "Pending" is the remainder — files neither excluded, errored, nor indexed
 * (new / not-yet-processed). Real-time queue depth is surfaced separately by
 * the status bar's live "N to index" indicator.
 *
 * @param allPaths     Every markdown file path in the vault
 * @param isExcluded   Whether a path is excluded from indexing — composed from
 *                     path patterns and frontmatter rules by the caller
 *                     (frontmatter-exclusion spec §3)
 * @param indexedPaths Paths present in the mtime store
 * @param erroredPaths Paths present in the errored store
 */
export function computeIndexStatus(
    allPaths: string[],
    isExcluded: (path: string) => boolean,
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
        if (isExcluded(path)) {
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

/**
 * Filter a map of errored entries down to the ones that should actually be shown
 * as Errored in the UI — mirroring computeIndexStatus's precedence. An errored
 * store entry is hidden when its path is now excluded (the file is Excluded,
 * not Errored) or no longer exists in the vault (deleted). Without this, the
 * errored list/count would disagree with the "Errored: N" stat after a user
 * excludes a folder (e.g. Excalidraw/) that still has lingering entries.
 *
 * @param entries       Raw errored store map (path -> entry)
 * @param allVaultPaths Every markdown file path currently in the vault
 * @param isExcluded    Whether a path is excluded from indexing — same
 *                      composed predicate as computeIndexStatus
 */
export function visibleErroredEntries<T>(
    entries: Record<string, T>,
    allVaultPaths: string[],
    isExcluded: (path: string) => boolean
): Record<string, T> {
    const vault = new Set(allVaultPaths);
    return Object.fromEntries(
        Object.entries(entries).filter(
            ([path]) => vault.has(path) && !isExcluded(path)
        )
    );
}

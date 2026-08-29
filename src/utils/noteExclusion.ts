import { shouldExcludeFile } from "./folderExclusion";
import { shouldExcludeByFrontmatter } from "./frontmatterExclusion";

/** Resolves a note path to its parsed frontmatter (metadataCache-backed in
 * production; undefined when the file has none or the cache is cold). */
export type FrontmatterLookup = (
    path: string
) => Record<string, unknown> | undefined;

export interface NoteExclusionSettings {
    excludeFolderPatterns: string[];
    excludeFrontmatterRules: string[];
}

export type NoteExclusionSource = "path" | "frontmatter";

/**
 * Which exclusion mechanism removes this note from indexing, or null when the
 * note is included. Path patterns are checked first (frontmatter-exclusion
 * spec §3): cheaper, and the badge for a doubly-matched file reads "path".
 */
export function noteExclusionSource(
    path: string,
    settings: NoteExclusionSettings,
    getFrontmatter: FrontmatterLookup
): NoteExclusionSource | null {
    if (shouldExcludeFile(path, settings.excludeFolderPatterns)) {
        return "path";
    }
    if (
        shouldExcludeByFrontmatter(
            getFrontmatter(path),
            settings.excludeFrontmatterRules
        )
    ) {
        return "frontmatter";
    }
    return null;
}

export function isNoteExcluded(
    path: string,
    settings: NoteExclusionSettings,
    getFrontmatter: FrontmatterLookup
): boolean {
    return noteExclusionSource(path, settings, getFrontmatter) !== null;
}

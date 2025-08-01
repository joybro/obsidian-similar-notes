import type { TFile } from "obsidian";
import picomatch from "picomatch";

// Cache for compiled matchers to improve performance
const matcherCache = new Map<string, picomatch.Matcher>();

/**
 * Check if a file path matches any of the exclusion patterns.
 * Uses picomatch for standard glob pattern matching.
 * 
 * @param filePath The file path to check
 * @param patterns Array of glob patterns
 * @returns true if the file should be excluded
 */
export function shouldExcludeFile(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
        if (matchesGlobPattern(filePath, pattern)) {
            return true;
        }
    }
    return false;
}

/**
 * Filter markdown files based on exclusion patterns.
 * 
 * @param files Array of TFile objects
 * @param patterns Array of glob patterns to exclude
 * @returns Filtered array of files
 */
export function filterMarkdownFiles(files: TFile[], patterns: string[]): TFile[] {
    if (patterns.length === 0) {
        return files;
    }
    
    return files.filter(file => !shouldExcludeFile(file.path, patterns));
}

/**
 * Check if a path matches a glob pattern using picomatch.
 * 
 * @param path The file path to test
 * @param pattern The glob pattern
 * @returns true if the path matches the pattern
 */
export function matchesGlobPattern(path: string, pattern: string): boolean {
    // Handle empty pattern
    if (!pattern) return false;
    
    try {
        // Get cached matcher or create new one
        let matcher = matcherCache.get(pattern);
        if (!matcher) {
            // Handle trailing slash - match as directory prefix
            let adjustedPattern = pattern;
            if (pattern.endsWith('/')) {
                adjustedPattern = pattern + '**';
            }
            
            matcher = picomatch(adjustedPattern);
            matcherCache.set(pattern, matcher);
        }
        
        return matcher(path);
    } catch (e) {
        // If pattern is invalid, picomatch will throw
        // Return false for invalid patterns
        return false;
    }
}

/**
 * Validate if a glob pattern is valid.
 * 
 * @param pattern The glob pattern to validate
 * @returns true if the pattern is valid
 */
export function isValidGlobPattern(pattern: string): boolean {
    try {
        picomatch(pattern);
        return true;
    } catch (e) {
        return false;
    }
}
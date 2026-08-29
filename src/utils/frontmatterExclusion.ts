/**
 * Frontmatter-based file exclusion (frontmatter-exclusion spec §1).
 *
 * Rules come from settings.excludeFrontmatterRules, one per line:
 *   `key`        — exclude when the property exists and is not false/null
 *   `key: value` — exclude when the property equals the value, or the list
 *                  contains it
 *
 * Matching runs against Obsidian's parsed frontmatter
 * (metadataCache.getFileCache().frontmatter), never raw YAML text, so YAML
 * formatting variants (inline vs block lists, quoting) are irrelevant.
 */

interface FrontmatterRule {
    key: string;
    /** Undefined for bare-key rules. */
    value?: string;
}

function parseRule(line: string): FrontmatterRule | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
        return { key: trimmed };
    }

    const key = trimmed.slice(0, colonIndex).trim();
    if (!key) return null;

    return { key, value: stripQuotes(trimmed.slice(colonIndex + 1).trim()) };
}

/** Vault frontmatter often quotes link values (`- "[[Private]]"`), and users
 * copy that form into rules — unwrap one matching pair of quotes. */
function stripQuotes(value: string): string {
    if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

/** Obsidian tags are case-insensitive and may carry a leading `#`. */
function isTagKey(key: string): boolean {
    return key === "tag" || key === "tags";
}

function normalizeTag(value: string): string {
    return value.replace(/^#/, "").toLowerCase();
}

function valueMatches(
    fmValue: unknown,
    ruleValue: string,
    tagKey: boolean
): boolean {
    if (Array.isArray(fmValue)) {
        return fmValue.some((item) => valueMatches(item, ruleValue, tagKey));
    }
    const fmString = String(fmValue);
    if (tagKey) {
        return normalizeTag(fmString) === normalizeTag(ruleValue);
    }
    return fmString === ruleValue;
}

/**
 * Returns true when the note's parsed frontmatter matches any exclusion rule.
 */
export function shouldExcludeByFrontmatter(
    frontmatter: Record<string, unknown> | undefined,
    rules: string[]
): boolean {
    if (!frontmatter || rules.length === 0) return false;

    for (const line of rules) {
        const rule = parseRule(line);
        if (!rule) continue;
        if (!(rule.key in frontmatter)) continue;

        const fmValue = frontmatter[rule.key];
        if (rule.value === undefined) {
            // Bare key: present and not explicitly opted out.
            if (fmValue !== false && fmValue !== null) return true;
        } else if (valueMatches(fmValue, rule.value, isTagKey(rule.key))) {
            return true;
        }
    }
    return false;
}

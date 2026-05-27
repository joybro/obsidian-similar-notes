---
name: bump-version
description: Use when bumping to a stable X.Y.Z release (e.g., "release 1.3.0", "bump to 0.13.0", "prepare 2.0.0"). For beta/prerelease (X.Y.Z-beta.N), use the beta-release skill instead.
---

# Bump Version

## Overview

Standardized process for bumping to a stable release in projects with package.json and manifest.json (e.g., Obsidian plugins).

Pair skill: `beta-release` handles the prerelease cycle that may precede a stable bump.

## When to Use

- User asks to "bump version to X.Y.Z"
- User asks to "prepare release X.Y.Z"
- User asks to "release version X.Y.Z"
- User runs `/bump-version` or `/bump-version X.Y.Z`

If the target is a `X.Y.Z-beta.N` prerelease, use the `beta-release` skill instead — its manifest/release/issue handling is different.

## Process

### 0. Determine Version

- If version is provided as argument (e.g., `/bump-version 0.13.0`), use it
- If version is mentioned in user's message (e.g., "bump version to 0.13.0"), use it
- Otherwise, ask user: "What version should I bump to?"

**Check for a preceding beta cycle.** Read `package.json`'s current version: if it's `X.Y.Z-beta.N`, this stable bump is the close-out of a beta cycle and the CHANGELOG entry for `X.Y.Z` should already exist (drafted during the beta-release run). In that case **reuse and amend** the existing entry — add any follow-up fixes that landed during the beta — rather than writing it from scratch. Also remember `manifest.json` was held at the previous stable during the beta; this is the bump where it finally moves to `X.Y.Z`.

### 1. Update Version Files

Update the `version` field in:
- `package.json`
- `manifest.json` (if exists, e.g., Obsidian plugins)

### 2. Analyze Changes Since Last Release

Find the latest stable release tag (excludes beta/rc tags):
```bash
LAST_STABLE=$(git tag --list --sort=-v:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
git log --oneline ${LAST_STABLE}..HEAD
```

**IMPORTANT: User perspective, not commit history**

CHANGELOG is for end users, not developers. Write from the user's perspective:
- What new capabilities can they use?
- What existing behavior changed?
- What bugs that affected them are fixed?

**Do NOT include:**
- Internal refactoring (unless it affects users)
- Bug fixes for features introduced in the same release cycle
- Intermediate fixes made during development of a new feature
- Implementation details (API changes, code structure)

**Example - What to exclude:**
If commits show:
```
feat: add OpenAI integration
fix: OpenAI token limit error
fix: OpenAI settings UI positioning
refactor: use requestUrl API for OpenAI
```
Only the first commit matters for CHANGELOG. The fixes are for bugs introduced during development of the new feature - users never experienced them.

**Categorize changes into sections:**
- **Added**: New features users can now use
- **Changed**: Changes to existing functionality users will notice
- **Fixed**: Bug fixes for issues that existed in previous releases
- **Improved**: Performance or UX improvements users will notice

### 3. Update CHANGELOG.md

Follow [Keep a Changelog](https://keepachangelog.com) format:

```markdown
## [x.x.x] - YYYY-MM-DD

### Added
- New feature description (#issue)

### Changed
- Change description (#issue)

### Fixed
- Bug fix description (#issue)
```

Include issue/PR numbers where applicable: `(#123)`

### 4. Commit Changes

```bash
git commit -m "chore: bump version to X.Y.Z"
```

**Do NOT push** - let user review locally first.

### 5. After publish: announce on tracked issues

Once the maintainer has tagged + published the release (external-visible — they do this step, not you), close the loop on any issues this release addressed:

- `gh issue comment <N> -b "<short fix announcement with release link>"` for each tracked issue
- `gh issue close <N>` after the comment lands

If a beta cycle preceded this release, the same issues likely already have a BRAT-invite comment from the beta-release run — match that tone for the stable announcement (short, friendly, "@reporter, shipped in X.Y.Z, please update; thanks for the report").

These actions are external-visible — **require explicit user approval** before invoking `gh issue comment` / `gh issue close`. Read prior maintainer comments on the same thread (or in nearby issues) to match voice before posting.

## Common Mistakes

| Mistake | Solution |
|---------|----------|
| Including development-phase bug fixes | Only include fixes for bugs in previous releases |
| Copying commit messages directly | Summarize from user perspective |
| Including internal refactoring | Only include if it affects user experience |
| Pushing without user review | Always stop after commit |
| Missing manifest.json | Check if project has manifest.json before updating |
| Wrong changelog format | Use Keep a Changelog format consistently |
| Missing issue numbers | Include `(#123)` when commits reference issues |

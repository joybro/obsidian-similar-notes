---
name: bump-version
description: Use when asked to bump version, release a new version, or prepare a release
---

# Bump Version

## Overview

Standardized process for bumping versions in projects with package.json and manifest.json (e.g., Obsidian plugins).

## When to Use

- User asks to "bump version to x.x.x"
- User asks to "prepare release x.x.x"
- User asks to "release version x.x.x"
- User runs `/bump-version` or `/bump-version x.x.x`

## Process

### 0. Determine Version

- If version is provided as argument (e.g., `/bump-version 0.13.0`), use it
- If version is mentioned in user's message (e.g., "bump version to 0.13.0"), use it
- Otherwise, ask user: "What version should I bump to?"

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

Categorize changes into sections:
- **Added**: New features
- **Changed**: Changes to existing functionality
- **Fixed**: Bug fixes
- **Improved**: Performance or UX improvements
- **Other**: Miscellaneous changes

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
git commit -m "chore: bump version to x.x.x"
```

**Do NOT push** - let user review locally first.

## Common Mistakes

| Mistake | Solution |
|---------|----------|
| Pushing without user review | Always stop after commit |
| Missing manifest.json | Check if project has manifest.json before updating |
| Wrong changelog format | Use Keep a Changelog format consistently |
| Missing issue numbers | Include `(#123)` when commits reference issues |

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

Feature sessions maintain a `## [Unreleased]` section as work lands (see repo `CLAUDE.md` → Changelog). If one exists, **rename it** to `## [X.Y.Z] - YYYY-MM-DD` and add anything missed, rather than writing from scratch. Otherwise create the section.

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

**Verify each entry against the user-facing surface.** Commit descriptions tell *why* and *how* a change was made; CHANGELOG entries tell *what the user sees*. These diverge in small but visible ways — e.g. a UI control described as a "slider" that's actually `addText` (number input); a fix said to affect "the sidebar" that also affects the in-document panel; a setting whose label in code differs from the working name in the commit. Before finalizing each entry, open the component that implements the change and confirm: control type, exact label, and which views are affected. A 30-second read prevents a user-caught inaccuracy at review time.

### 4. Commit Changes

```bash
git commit -m "chore: bump version to X.Y.Z"
```

If the user only asked to *prepare* the bump, **stop here** and let them review + release. If the user delegated the release to you ("release it", "릴리즈까지 진행해줘"), continue to step 5.

### 5. Push, tag, and publish the release (only when the release is delegated to you)

CI builds the assets and creates a *draft*; you finish by publishing. This mirrors `beta-release` steps 4–5, but for a stable release **you publish it yourself** instead of handing off to the maintainer, and the body has **no** BRAT section.

```bash
git push origin main
git tag X.Y.Z
git push origin X.Y.Z          # triggers .github/workflows/release.yml
```

The tag push runs `release.yml` → `npm run build` → creates a **draft** release with assets `main.js`, `manifest.json`, `styles.css` (no body). Wait for it: `gh run watch <id>` or poll `gh run list --workflow=release.yml -L 1` until `completed success`.

Then publish, supplying release notes from the CHANGELOG entry — the `### Added/Changed/Improved/Fixed` sections only (write them to a temp file and pass `--notes-file`). Match the prior stable release's body format; **omit** the BRAT install block (that is beta-only):

```bash
gh release edit X.Y.Z -R <owner>/<repo> --notes-file <body.md> --draft=false --latest
```

Verify it went public and is marked Latest:

```bash
gh release list -R <owner>/<repo> -L 3      # X.Y.Z should show "Latest", not "Draft"/"Pre-release"
```

Gotchas:
- `gh release view --json isLatest` **errors** — `isLatest` is not a valid field for `release view`. Use `gh release list` (the "Latest" column) to confirm instead.
- This repo has two remotes (`origin` = the public `joybro/obsidian-similar-notes`, plus `novatera-io`). Tags, releases, and issues all live on the public repo — push the tag to `origin` and target that repo with `gh`.
- Publishing the release is external-visible, but the user delegating "release it" covers push + tag + publish. It does **not** auto-cover the issue announcements in step 6 — those ping reporters directly, so still confirm wording before posting.

### 6. After publish: announce on tracked issues

Once the release is published (step 5, or by the maintainer if the bump was only prepared), close the loop on any issues this release addressed:

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
| Pushing/publishing when the user only wanted a prepared bump | Stop after commit unless the release was delegated (step 5) |
| Publishing as draft or pre-release | Stable publish needs `--draft=false --latest`; verify via `gh release list` |
| Missing manifest.json | Check if project has manifest.json before updating |
| Wrong changelog format | Use Keep a Changelog format consistently |
| Missing issue numbers | Include `(#123)` when commits reference issues |

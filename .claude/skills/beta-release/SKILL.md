---
name: beta-release
description: Use when releasing a beta build of this Obsidian plugin for BRAT-based testing (e.g. "release 1.3.0-beta.1", "베타 릴리즈", "ship a beta via BRAT") — before the eventual stable release of the same X.Y.Z.
---

# Beta Release

## Overview

This plugin ships pre-release builds via BRAT so the maintainer (and any opted-in reporters) can test changes for a few days before stable. Stable users continue to receive only the version listed in `manifest.json` via Obsidian's community plugin store.

Pair skill: `bump-version` handles the *stable* bump that closes out the beta cycle.

## The pattern this repo uses

`manifest.json` stays at the previous stable. `package.json` carries the `X.Y.Z-beta.N` semver-prerelease. A tag `X.Y.Z-beta.N` triggers `release.yml`, which auto-creates a draft release; the maintainer publishes it manually with **Set as a pre-release** checked.

**Why this pattern (vs alternatives):**

- Obsidian's community plugin store reads `manifest.json` on the default branch — keeping it at the stable version is what blocks the beta from being pushed to all users.
- A survey of 8 popular plugins (excalidraw, obsidian-tasks, omnisearch, copilot, smart-connections, obsidian-git, folder-notes, dataview) found **only dataview** uses `manifest-beta.json`. **folder-notes** uses exactly this pattern (stable manifest + `-beta` tag + prerelease checkbox). No real "standard" — this pattern is the more common shape among plugins that operate a beta channel at all.
- BRAT fetches the release's `main.js` regardless of whether the asset `manifest.json` matches the tag; users still receive the beta build.

## When to Use

- User asks for "beta release", "release X.Y.Z-beta.N", "ship a beta", "BRAT 으로 테스트"
- A batch of fixes/features has landed on `main` and you want maintainer-only test exposure before stable

If the user just says "release 1.3.0" (no beta), use `bump-version` instead.

## Process

### 0. Sanity check before bumping

- Confirm `main` is the branch and has the work to ship.
- `git log --oneline <last-stable-tag>..HEAD` — eyeball the commit set.
- **Scan every commit message in that range for `Closes #N` / `Fixes #N` / `Resolves #N`.** If any appear, those issues will *auto-close* the moment you push to `main` from the beta-bump commit onward — which is wrong for a beta (the issue should close on stable, not on the beta build). If you find any, plan to reopen those issues after pushing (see step 6) and use `Refs #N` in future commits.

### 1. Determine the beta version

- Default `N=1` for the first beta of a given `X.Y.Z`. Subsequent betas of the same `X.Y.Z` increment `N`.
- If the user gives an explicit version (e.g. `/beta-release 1.3.0-beta.2`), use it.

### 2. Update files

- `package.json` → `"version": "X.Y.Z-beta.N"`
- `manifest.json` → **leave at the previous stable** (do not change)
- `CHANGELOG.md` → rename the existing `## [Unreleased]` section to `## [X.Y.Z] - YYYY-MM-DD` (the stable header, not `-beta.N`). **If a `## [X.Y.Z]` section already exists** — you're shipping beta.2+ of the same `X.Y.Z`, so an earlier beta already created it — do NOT rename; that would produce a duplicate `[X.Y.Z]`. Instead **merge** the `## [Unreleased]` entries into the existing `## [X.Y.Z]` section under the matching categories, then delete the now-empty `[Unreleased]` header (keep the existing date; `bump-version` finalizes it at stable). Feature sessions maintain `## [Unreleased]` as work lands (see repo `CLAUDE.md` → Changelog), so the entries should already be present — add any that were missed. Reuse the `[X.Y.Z]` section as-is for the eventual stable bump. Follow the existing categories (Added / Changed / Improved / Fixed) and reference issue numbers `(#N)`. Write from user perspective — see `bump-version` for the same conventions.

**Verify each entry against the user-facing surface before finalizing.** Commit descriptions tell *why* and *how* a change was made; CHANGELOG entries tell *what the user sees*. These diverge in small but visible ways — e.g. a UI control described as a "slider" that's actually `addText` (number input); a fix said to affect "the sidebar" that also affects the in-document panel; a setting whose label in code differs from the working name in the commit. For each entry, open the component that implements the change and confirm control type, exact label, and which views are affected. The same verified entry text feeds into the release body in step 5 — getting it right here means the release body is correct by construction.

### 3. Commit

```bash
git commit -m "chore: prepare X.Y.Z beta

- package.json: A.B.C -> X.Y.Z-beta.N
- manifest.json: stays at A.B.C so the community plugin store does not
  push the beta to stable users; BRAT testers receive this build via the
  X.Y.Z-beta.N prerelease.
- CHANGELOG entry for X.Y.Z is drafted in place and will be reused at
  stable release time."
```

### 4. Push and tag

```bash
git push origin main
git tag X.Y.Z-beta.N
git push origin X.Y.Z-beta.N
```

The push of the tag triggers `.github/workflows/release.yml` → builds with `npm run build` → creates a **draft** release with assets `main.js`, `manifest.json`, `styles.css`.

Wait for the workflow with `gh run watch <id>` (or `gh run list --workflow=release.yml --limit 1`).

### 5. Draft the release body and hand off to the maintainer

The maintainer publishes via the GitHub UI (so they visually confirm assets + flags). Provide a release body draft. Template:

```markdown
First beta of the X.Y.Z release — <one-line summary of the headline changes> (#refs).

## Installing via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin in Obsidian
2. Open BRAT settings → **Add Beta Plugin** → paste `joybro/obsidian-similar-notes`

## What's in this beta

<paste the CHANGELOG entry body here — Added / Changed / Improved / Fixed sections>

## Known limitation (optional)

<list anything unfixed, e.g. cannot-reproduce reports>
```

**Set the body on the draft yourself** — do not make the maintainer paste it. `gh release edit` modifies the draft's body only; it does NOT publish (the release stays `draft: true`):

```bash
gh release edit X.Y.Z-beta.N --notes-file <path-to-body.md>
```

Then hand the maintainer the draft URL and these steps:
1. Open the draft release and review the pre-filled body + assets
2. **Check "Set as a pre-release"** (folder-notes pattern — extra safety even with stable manifest)
3. Publish

The maintainer still publishes via the UI so they visually confirm assets + the prerelease checkbox. Do **not** call `gh release edit --draft=false` yourself unless the user explicitly asks; that is the publication step and surfaces an external-visible artifact.

### 6. Reopen auto-closed issues (if any)

For each issue your step 0 scan flagged: `gh issue reopen <N>`. Note in the BRAT-invite comment that it was reopened because auto-close fired off the beta.

### 7. Post BRAT-invite comments on relevant issues

For each issue addressed by this beta, post a short comment. Tone is short and friendly — see prior maintainer comments on the issue or in past resolved issues for voice match. Template:

```
Hi @<reporter>, <one-line summary of the fix/feature> in X.Y.Z-beta.N. <Optional: reopen explanation if applicable.>

If you want to try the beta before stable, install via BRAT:
1. Install the BRAT plugin
2. Add Beta Plugin → `joybro/obsidian-similar-notes`

Release notes: https://github.com/joybro/obsidian-similar-notes/releases/tag/X.Y.Z-beta.N

Will <ping again | close this> once X.Y.Z stable is out. Thanks!
```

If the issue covers multiple items, mirror them as a `- [x] / - [ ]` checklist so the reporter sees per-item status (esp. for unreproduced items).

Posting issue comments is external-visible — require explicit user approval before invoking `gh issue comment`.

### 8. After beta testing → stable

When the maintainer is satisfied:

- `manifest.json` A.B.C → X.Y.Z (this is what releases the plugin to all users)
- `package.json` X.Y.Z-beta.N → X.Y.Z
- `CHANGELOG.md` entry — reuse as-is, or amend if any follow-up fixes landed during the beta
- New commit `chore: bump version to X.Y.Z`, push
- `git tag X.Y.Z && git push origin X.Y.Z` → release workflow re-runs, draft created
- Publish (no prerelease checkbox this time)
- On each tracked issue: post a stable-shipped comment and `gh issue close <N>`

(`bump-version` skill covers the file-change mechanics; this step is what closes out the beta cycle.)

## Gotchas

| Gotcha | Why | Mitigation |
|---|---|---|
| `Closes #N` in a commit message auto-closes the issue on push, but you're only releasing a beta | GitHub keyword | Use `Refs #N` in commit messages while a stable hasn't shipped; reopen if it slipped through |
| Lint `max-lines` fails on long test files | The repo's `.eslintrc.json` had `max-lines: 400` applied globally until #39 cycle — test overrides now relax it | If it regresses, ensure `overrides[].files: ["**/__tests__/**", "**/*.test.ts(x)"]` still disables `max-lines` and `max-lines-per-function` |
| GitHub release page has no comment box | Releases are view-only — only issues/PRs accept comments | When writing release body or asking for feedback, point to `#<issue>` (not "leave a comment here") |
| Workflow creates the release as `draft: true, prerelease: false` | `release.yml` uses `gh release create --draft`, no `--prerelease` flag | Maintainer must tick "Set as a pre-release" before publishing. (Or amend `release.yml` to add `--prerelease` for `*-beta*` tags — not done yet) |
| BRAT testing on a different machine | The plugin needs to be installed via BRAT (not `install-local.sh`) when the test machine doesn't have the repo checkout | Confirm BRAT is installed on the test machine before betas are needed |

## Common mistakes

- Bumping `manifest.json` to the beta version → community plugin store would push the beta to all stable users. Always leave `manifest.json` at the previous stable until the stable release.
- Writing the CHANGELOG entry as `## [X.Y.Z-beta.N]` — use `## [X.Y.Z]` so it can be reused at stable without edits.
- Asking the maintainer to publish via `gh release edit` instead of the UI — small risk, but they lose the visual confirmation of assets/checkbox state. Hand off the UI flow unless they explicitly delegate.
- Posting BRAT-invite comments before the maintainer publishes the release (the URL in the comment will 404 until publish).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Similar Notes is an Obsidian plugin that provides semantic note recommendations using machine learning embeddings. By default it uses Transformers.js to generate embeddings locally without external API calls; remote embedding providers (Ollama, OpenAI-compatible incl. OpenRouter, Gemini) are also supported. Orama is used for vector search.

## Common Development Commands

### Build Commands

- `npm run dev` - Start development build with watch mode
- `npm run build` - Production build with TypeScript checking
- `npm install` - Install dependencies

### Testing

- `npm run test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test -- path/to/test` - Run specific test file

### Development Workflow

1. Run `npm run dev` to start the development build
2. The plugin will be built to `main.js`, `styles.css`, and `manifest.json`
3. Copy these files to your Obsidian vault's `.obsidian/plugins/similar-notes/` directory
4. Reload Obsidian or disable/enable the plugin to see changes

### Manual Verification (in-app testing)

When a change needs to be verified by hand in real Obsidian (e.g. memory/leak
behavior, focus handling, anything not coverable by Vitest):

1. `npm run install-local` — rebuilds and copies `main.js` / `manifest.json` /
   `styles.css` into the **Test_local** vault
   (`~/Obsidian/Test_local/.obsidian/plugins/similar-notes/`). This vault holds a
   plain **copy**, so a bare `npm run build` does NOT update it — always go through
   `install-local` (or `./scripts/install-local.sh` if already built).
2. In Obsidian, disable → re-enable the plugin (or restart) to load the new build.

This is the canonical manual-verification path.

#### Self-driven verification via the Obsidian CLI (command features)

For **command**-type features (anything triggered from the command palette) you don't
have to drive Obsidian by hand. Obsidian ships an official CLI (1.12.7+; register once
via Settings → General → Command line interface). After `install-local`, run the whole
loop from a shell:

```bash
obsidian vault=Test_local plugin:reload id=similar-notes        # load the fresh build
obsidian vault=Test_local open path="Some Note.md"              # set the active note
obsidian vault=Test_local command id=similar-notes:<command-id> # run the command
# then read whatever the command wrote (e.g. the export JSON)
```

- `vault=<name>` **must be the first parameter**. It targets that vault even with
  several vault windows open, so it won't touch your other vaults.
- Use `obsidian help` (subcommand) — `obsidian --help` is not recognized and hangs
  the shell instead of printing usage.
- Requires the Obsidian app already running with the target vault open.
- **macOS PATH gotcha:** the CLI binary lives inside the app bundle
  (`/Applications/Obsidian.app/Contents/MacOS/obsidian` — the same file as the GUI on
  case-insensitive APFS). Registration adds that dir to PATH via `~/.zprofile`, which a
  **non-login shell does not source**. If `obsidian` isn't found, prepend it:
  `PATH="$PATH:/Applications/Obsidian.app/Contents/MacOS"` (or call by full path).

#### UI verification without touching the mouse (eval + CDP)

For UI behavior the command CLI can't drive (hover, real typing), the CLI's developer
commands close the gap — verified end-to-end on the #55 hover-preview feature:

```bash
obsidian eval code="<js>"        # run JS in the app; app/document available; returns => result
obsidian dev:debug on            # attach CDP (dev:debug off when done)
obsidian dev:cdp method=Input.dispatchMouseEvent \
    params='{"type":"mouseMoved","x":763,"y":227,"modifiers":4}'   # modifiers:4 = Cmd
obsidian dev:cdp method=Input.insertText params='{"text":";;query"}'  # real typing
```

- **`element.dispatchEvent(new MouseEvent(...))` does NOT work for hover-preview-class
  features** — synthetic events are untrusted and filtered. CDP `Input.*` events are
  trusted; this is the difference that matters.
- Measure coordinates via `eval` (`getBoundingClientRect`), `scrollIntoView` first if
  off-screen, and re-measure right before dispatch (result lists re-render/re-order).
- Programmatic `editor.replaceRange` does not open an `EditorSuggest`; CDP
  `Input.insertText` after focusing the editor does.
- Run a **positive control** first against a core feature with the same mechanism
  (e.g. the embedded backlinks pane for hover preview) to validate the harness before
  trusting a negative result.
- `eval` gotcha: a literal `\n` inside `code=` is translated by the CLI and breaks the
  JS — use `String.fromCharCode(10)`.

## GitHub Interactions

- **Before merging an external PR, check that origin/main is not behind local main** (`git fetch origin && git log origin/main..main`). Local commits can accumulate unpushed, so a `gh pr merge` can land on a stale base and force a conflict rebase afterwards. If local is ahead, push first, then merge. (2026-08-29: PR #54 merged onto a base missing two local commits.)

## Changelog

`CHANGELOG.md` entries are written from the **user-facing surface** (what the user sees), not from commit logs — and they're written **while the feature is fresh, during the dev session**, not at release time. A later release session re-deriving the exact UI (trigger text, setting labels, affected views) from cold context is slower and error-prone.

- When you ship a user-facing feature or fix, add an entry under a `## [Unreleased]` section at the top of `CHANGELOG.md` before wrapping up the session — match the existing format: `**Title** (#N): what the user sees`, grouped under Added / Changed / Improved / Fixed.
- **Exception — a version is mid-beta:** while `X.Y.Z-beta.N` is the current version (check `package.json`) and `## [X.Y.Z]` already exists in the changelog, new entries go into that section directly, not `Unreleased` — they will ship in that version's stable release.
- Do **not** assign a version or date. The `beta-release` / `bump-version` skills rename `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD` at release time.
- Internal-only changes (refactors, test scaffolding, build config) need no entry.

## Architecture

**IMPORTANT**: Before designing or implementing features, read `docs/architecture.md` to understand the codebase structure, domain flow, and key services.

### Documentation conventions

- **Spec/design docs use a `-spec` suffix** and live in `docs/` (e.g. `docs/ollama-embedding-sizing-spec.md`). When logic is non-obvious from the code (a chosen constant, a tradeoff, why one approach over another), write the *rationale* in a `-spec` doc first, then link it from `docs/architecture.md`'s implementation-details list. Goal: a reader understands the design from the spec before reading the code.

## Testing Approach

- Tests use Vitest with React Testing Library
- Obsidian API is mocked by `src/__mocks__/obsidian.ts`, which the `obsidian` import resolves to via the alias in `vitest.config.ts` (the real `obsidian` package is types-only). Add missing exports (`Platform`, `TFile`, ...) THERE. Individual test files may still override it with their own `vi.mock("obsidian", factory)`
- Test files are colocated with source files in `__tests__` directories
- Focus on testing domain logic and services, not UI components

## Performance Considerations

- Embedding generation is CPU-intensive, hence the use of Web Workers
- Supports WebGPU acceleration when available
- Implements debouncing for note indexing to avoid excessive reprocessing
- Vector search is optimized through Orama's indexing

## Common Issues and Solutions

1. **Worker Loading**: If embedding service fails, check worker bundle generation in build config
2. **Model Download**: First-time model download can take time; check network connectivity
3. **Memory Usage**: Large vaults may consume significant memory for embeddings storage

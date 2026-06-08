# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Similar Notes is an Obsidian plugin that provides semantic note recommendations using machine learning embeddings. It uses Transformers.js to generate embeddings locally without external API calls, and Orama for vector search.

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

This is the canonical manual-verification path. (The `Young_Old` vault instead
symlinks its plugin folder to this repo root, so a `npm run build` + reload there
picks up changes without copying — but Test_local is the one to use by default.)

## Changelog

`CHANGELOG.md` entries are written from the **user-facing surface** (what the user sees), not from commit logs — and they're written **while the feature is fresh, during the dev session**, not at release time. A later release session re-deriving the exact UI (trigger text, setting labels, affected views) from cold context is slower and error-prone.

- When you ship a user-facing feature or fix, add an entry under a `## [Unreleased]` section at the top of `CHANGELOG.md` before wrapping up the session — match the existing format: `**Title** (#N): what the user sees`, grouped under Added / Changed / Improved / Fixed.
- Do **not** assign a version or date. The `beta-release` / `bump-version` skills rename `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD` at release time.
- Internal-only changes (refactors, test scaffolding, build config) need no entry.

## Architecture

**IMPORTANT**: Before designing or implementing features, read `docs/architecture.md` to understand the codebase structure, domain flow, and key services.

### Documentation conventions

- **Spec/design docs use a `-spec` suffix** and live in `docs/` (e.g. `docs/ollama-embedding-sizing-spec.md`). When logic is non-obvious from the code (a chosen constant, a tradeoff, why one approach over another), write the *rationale* in a `-spec` doc first, then link it from `docs/architecture.md`'s implementation-details list. Goal: a reader understands the design from the spec before reading the code.

## Testing Approach

- Tests use Vitest with React Testing Library
- Obsidian API is mocked in `__tests__/__mocks__/obsidian.ts`
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

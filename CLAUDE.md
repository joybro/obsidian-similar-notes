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

## Architecture

**IMPORTANT**: Before designing or implementing features, read `docs/architecture.md` to understand the codebase structure, domain flow, and key services.

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

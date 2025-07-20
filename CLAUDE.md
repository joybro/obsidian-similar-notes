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

## Architecture Overview

The codebase follows Domain-Driven Design (DDD) with clear separation of concerns:

### Core Domain Flow
1. **Note Processing**: When a note is opened/modified, it's chunked into smaller pieces using LangChain's text splitters
2. **Embedding Generation**: Chunks are processed through a Transformers.js model (runs in Web Worker for performance)
3. **Vector Storage**: Embeddings are stored in Orama vector database for fast similarity search
4. **Similar Note Finding**: When requested, performs vector search to find semantically similar notes
5. **UI Display**: Results shown in Obsidian's UI through React components

### Key Services and Their Responsibilities

- **EmbeddingService** (`domain/service/EmbeddingService.ts`): Manages ML model loading and text embedding generation. Uses Web Workers to avoid blocking the main thread.

- **NoteChunkingService** (`domain/service/NoteChunkingService.ts`): Splits notes into manageable chunks for embedding. Handles content exclusion based on RegExp patterns.

- **SimilarNoteFinder** (`domain/service/SimilarNoteFinder.ts`): Orchestrates the process of finding similar notes using vector search.

- **NoteIndexingScheduler** (`application/NoteIndexingScheduler.ts`): Manages background indexing of notes with debouncing and progress tracking.

### Important Implementation Details

1. **Web Workers**: Embedding generation runs in workers to prevent UI freezing. Worker code is in `src/adapter/worker/`.

2. **Model Loading**: ML models are downloaded from Hugging Face on first use. Two models available:
   - Default: `Xenova/all-MiniLM-L6-v2` (English-optimized)
   - Multilingual: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`

3. **Vector Database**: Orama is used for vector storage and search. Database is persisted and reloaded between sessions.

4. **Settings Storage**: Plugin settings are stored in Obsidian's data.json. UI for settings uses React components.

5. **Content Exclusion**: Supports RegExp patterns to exclude content from indexing (e.g., frontmatter, code blocks).

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
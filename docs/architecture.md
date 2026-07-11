# Architecture

The codebase follows Domain-Driven Design (DDD) with clear separation of concerns. Currently, the architecture is a hybrid of DDD and Hexagonal Architecture (Ports and Adapters pattern), which is subject to ongoing refactoring.

## Directory Structure

```
src/
├── adapter/              # External system adapters (API clients)
│   ├── gemini/          # Google Gemini embedding API client
│   ├── huggingface/     # Hugging Face model info client
│   ├── ollama/          # Ollama embedding API client
│   ├── openai/          # OpenAI-compatible embedding API client (incl. OpenRouter)
│   └── orama/           # Orama vector database integration (+ orama.worker.ts)
├── application/         # Application services and coordinators
├── commands/            # Command palette commands
├── components/          # React UI components and settings sections
├── constants/           # Application constants
├── domain/              # Core domain logic
│   ├── model/          # Domain models
│   ├── repository/     # Repository interfaces
│   └── service/        # Domain services, embedding providers (+ transformers.worker.ts)
├── editor/              # Editor integrations (drop handler)
├── infrastructure/      # Infrastructure implementations (Obsidian/IndexedDB-coupled)
├── lifecycle/           # Plugin version-upgrade handling
├── utils/               # Utility functions
├── __mocks__/           # obsidian module mock for tests (aliased in vitest.config.ts)
└── main.ts              # Plugin entry point
```

**Note on Architecture**: The current structure mixes DDD and Ports/Adapters patterns. This is not a strict requirement and is open to refactoring. Some inconsistencies exist (e.g., `adapter/orama` could be in `infrastructure`). Feel free to improve the structure when making changes.

## Core Domain Flow

1. **Note Processing**: When a note is opened/modified, it's chunked into smaller pieces using LangChain's text splitters
2. **Embedding Generation**: Chunks are processed through a Transformers.js model (runs in Web Worker for performance)
3. **Vector Storage**: Embeddings are stored in Orama vector database for fast similarity search
4. **Similar Note Finding**: When requested, performs vector search to find semantically similar notes
5. **UI Display**: Results shown in Obsidian's UI through React components

## Key Services and Their Responsibilities

### Domain Services
- **EmbeddingService** (`domain/service/EmbeddingService.ts`): Manages embedding generation behind the `EmbeddingProvider` abstraction. Providers: built-in Transformers.js (`TransformersEmbeddingProvider`, runs in a Web Worker), Ollama, OpenAI-compatible (incl. OpenRouter), and Gemini.
- **NoteChunkingService** (`domain/service/NoteChunkingService.ts`): Splits notes into manageable chunks for embedding. Handles content exclusion based on RegExp patterns.
- **SimilarNoteFinder** (`domain/service/SimilarNoteFinder.ts`): Orchestrates the process of finding similar notes using vector search.

### Application Services
- **NoteIndexingService** (`application/NoteIndexingService.ts`): Manages background indexing of notes with progress tracking.
- **SettingsService** (`application/SettingsService.ts`): Handles plugin settings management and persistence.
- **SimilarNoteCoordinator** (`application/SimilarNoteCoordinator.ts`): Coordinates similar note finding and UI updates.
- **LeafViewCoordinator** (`application/LeafViewCoordinator.ts`): Manages Obsidian leaf views and bottom panel display.

### Infrastructure
- **VaultNoteRepository** (`infrastructure/VaultNoteRepository.ts`): Implementation of NoteRepository for Obsidian vault.
- **OramaNoteChunkRepository** (`adapter/orama/OramaNoteChunkRepository.ts`): Vector database implementation using Orama.
- **IndexedNoteMTimeStore** (`infrastructure/IndexedNoteMTimeStore.ts`): Tracks file modification times for incremental indexing.

## Important Implementation Details

1. **Web Workers**: Built-in embedding generation and Orama search run in workers to prevent UI freezing. Worker code: `src/domain/service/transformers.worker.ts` (embedding) and `src/adapter/orama/orama.worker.ts` (vector DB). Workers are bundled separately (`node esbuild.config.mjs workers-only` — the `test` script runs this before vitest).

2. **Embedding providers**: The built-in provider downloads Transformers.js models from Hugging Face on first use (default `Xenova/all-MiniLM-L6-v2`, multilingual `Xenova/paraphrase-multilingual-MiniLM-L12-v2`). Remote providers — Ollama, OpenAI-compatible (incl. OpenRouter), Gemini — are configured in settings and implemented as `EmbeddingProvider`s (`domain/service/`) over API clients in `adapter/`.

3. **Vector Database**: Orama is used for vector storage and search. Database is persisted and reloaded between sessions.

4. **Ollama chunk sizing & batching**: Ollama rejects inputs longer than the model context, and a chunk's true token count can't be known cheaply before sending. The embedding-input ceiling is the smaller of a transport-payload ceiling and a context-window ceiling, with `truncate: true` as a hard backstop, and chunks are embedded in payload-bounded batches. The rationale (why the 0.5 safety factor, which ceiling binds per model) is non-obvious — see `docs/ollama-embedding-sizing-spec.md`.

5. **Semantic chunk size**: Chunk size is sized for retrieval granularity, not for the model's maximum input. It is capped at a fixed `SEMANTIC_CHUNK_TOKENS` (512) with the model's `getMaxTokens()` only as the upper bound (`LangchainNoteChunkingService`). Reusing the model ceiling as the chunk size made large-context models (bge-m3, OpenAI) produce coarse chunks that diluted topical signal and missed genuine matches — see `docs/semantic-chunk-size-spec.md` and `docs/adr/0002-semantic-chunk-size-cap.md`.

6. **Built-in embedding per-pass batch cap**: The built-in (Transformers.js / onnxruntime-web) embedder caps chunks per forward pass at `MAX_EMBED_BATCH_SIZE` (32) and runs sub-batches sequentially (`transformers.worker.ts`, `splitIntoBatches`/`embedInBatches` in `src/utils/batching.ts`). Embedding a large note's chunks in one pass overran the wasm32 ~4GB address space and aborted with a bare number (and then cascaded). Note: this is *not* a threading issue — the beta.4 single-thread pin was a no-op. See `docs/builtin-embedding-batch-cap-spec.md`.

7. **Indexable-text hash gate**: File mtimes select notes that may need indexing. Queued notes hash their effective text after frontmatter and regex exclusions; unchanged hashes skip chunking and embedding while still advancing the stored mtime. See `docs/indexable-text-hash-spec.md`.

8. **Honest indexing status**: Every markdown file is assigned to exactly one of Excluded / Errored / Pending / Indexed by precedence (`computeIndexStatus`, `src/application/indexStatus.ts`), replacing an old `total − indexed` guess that lumped errored files into "Excluded". Notes that fail processing retry in-session up to `MAX_ATTEMPTS` (3) before landing in a persistent `ErroredNoteStore`, and a terminally-errored note is not blindly re-queued on restart unless its content changed. See `docs/indexing-status-spec.md`.

9. **Settings Storage**: Plugin settings are stored in Obsidian's data.json. UI for settings uses React components.

   - **Sectioning**: The settings tab is divided into top-level sections using Obsidian's `SettingGroup` (`@since 1.11.0`) — one per area (e.g. Model, Index, Exclude folders from index, Exclude content from index, Display, Debug & Support). Each section is built by a `*SettingsSection` class (e.g. `IndexSettingsSection`) that returns `SettingBuilder` arrays.
   - **Use sibling groups, not sub-headings.** `SettingGroup` cannot nest, and inserting `Setting.setHeading()` divider rows *inside* a group renders poorly (tried more than once and reverted). To break a crowded section into sub-areas, add another sibling top-level `SettingGroup` instead of nesting or in-group headings.

10. **Content Exclusion**: Supports RegExp patterns to exclude content from indexing (e.g., frontmatter, code blocks).

11. **Command Palette**: Commands are implemented in `src/commands/` with an extensible structure for easy addition of new commands.

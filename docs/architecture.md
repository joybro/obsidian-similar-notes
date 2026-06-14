# Architecture

The codebase follows Domain-Driven Design (DDD) with clear separation of concerns. Currently, the architecture is a hybrid of DDD and Hexagonal Architecture (Ports and Adapters pattern), which is subject to ongoing refactoring.

## Directory Structure

```
src/
├── adapter/              # External system adapters
│   ├── orama/           # Orama vector database integration
│   └── worker/          # Web Worker implementations
├── application/         # Application services and coordinators
├── commands/            # Command palette commands
├── components/          # React UI components
├── constants/           # Application constants
├── domain/              # Core domain logic
│   ├── model/          # Domain models
│   ├── repository/     # Repository interfaces
│   └── service/        # Domain services
├── infrastructure/      # Infrastructure implementations
├── services/           # Legacy service layer (being refactored)
├── utils/              # Utility functions
└── main.ts             # Plugin entry point
```

**Note on Architecture**: The current structure mixes DDD and Ports/Adapters patterns. This is not a strict requirement and is open to refactoring. Some inconsistencies exist (e.g., `adapter/orama` could be in `infrastructure`, `services/` is legacy code being phased out). Feel free to improve the structure when making changes.

## Core Domain Flow

1. **Note Processing**: When a note is opened/modified, it's chunked into smaller pieces using LangChain's text splitters
2. **Embedding Generation**: Chunks are processed through a Transformers.js model (runs in Web Worker for performance)
3. **Vector Storage**: Embeddings are stored in Orama vector database for fast similarity search
4. **Similar Note Finding**: When requested, performs vector search to find semantically similar notes
5. **UI Display**: Results shown in Obsidian's UI through React components

## Key Services and Their Responsibilities

### Domain Services
- **EmbeddingService** (`domain/service/EmbeddingService.ts`): Manages ML model loading and text embedding generation. Uses Web Workers to avoid blocking the main thread.
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

1. **Web Workers**: Embedding generation runs in workers to prevent UI freezing. Worker code is in `src/adapter/worker/`.

2. **Model Loading**: ML models are downloaded from Hugging Face on first use. Two models available:
   - Default: `Xenova/all-MiniLM-L6-v2` (English-optimized)
   - Multilingual: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`

3. **Vector Database**: Orama is used for vector storage and search. Database is persisted and reloaded between sessions.

4. **Ollama chunk sizing & batching**: Ollama rejects inputs longer than the model context, and a chunk's true token count can't be known cheaply before sending. The embedding-input ceiling is the smaller of a transport-payload ceiling and a context-window ceiling, with `truncate: true` as a hard backstop, and chunks are embedded in payload-bounded batches. The rationale (why the 0.5 safety factor, which ceiling binds per model) is non-obvious — see `docs/ollama-embedding-sizing-spec.md`.

5. **Semantic chunk size**: Chunk size is sized for retrieval granularity, not for the model's maximum input. It is capped at a fixed `SEMANTIC_CHUNK_TOKENS` (512) with the model's `getMaxTokens()` only as the upper bound (`LangchainNoteChunkingService`). Reusing the model ceiling as the chunk size made large-context models (bge-m3, OpenAI) produce coarse chunks that diluted topical signal and missed genuine matches — see `docs/semantic-chunk-size-spec.md` and `docs/adr/0002-semantic-chunk-size-cap.md`.

5. **Settings Storage**: Plugin settings are stored in Obsidian's data.json. UI for settings uses React components.

   - **Sectioning**: The settings tab is divided into top-level sections using Obsidian's `SettingGroup` (`@since 1.11.0`) — one per area (e.g. Model, Index, Exclude folders from index, Exclude content from index, Display, Debug & Support). Each section is built by a `*SettingsSection` class (e.g. `IndexSettingsSection`) that returns `SettingBuilder` arrays.
   - **Use sibling groups, not sub-headings.** `SettingGroup` cannot nest, and inserting `Setting.setHeading()` divider rows *inside* a group renders poorly (tried more than once and reverted). To break a crowded section into sub-areas, add another sibling top-level `SettingGroup` instead of nesting or in-group headings.

5. **Content Exclusion**: Supports RegExp patterns to exclude content from indexing (e.g., frontmatter, code blocks).

6. **Command Palette**: Commands are implemented in `src/commands/` with a extensible structure for easy addition of new commands.

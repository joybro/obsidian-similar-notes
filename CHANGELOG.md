# Changelog

All notable changes to this project will be documented in this file.

## [1.6.0] - 2026-06-14

### Added

-   **Export similar notes for active note** (#47): New command **Similar Notes: Export similar notes for active note** writes the current note's similar-notes results to `.obsidian/plugins/similar-notes/similar-notes-export.json`. Lets external tools (e.g. coding agents) reuse the plugin's similarity search without touching embeddings or the index — open a note, run the command, read the JSON. Each result has `path`, `title`, `score`, `excerpt`, and `linked`; the payload carries a `version` for forward compatibility, is written atomically (no partial reads), and on failure reports a stable `code` (`NO_ACTIVE_FILE`, `SEARCH_FAILED`) alongside `ok: false`.

### Changed

-   **Already-linked notes now appear in Similar notes**: previously the panel hid any note the active note already linked to, so the most obvious matches were missing from recommendations. Linked notes now show, ranked by score alongside everything else, with a small muted "linked" tag marking them as already linked. The agent export gains a matching `linked` field per result.

### Improved

-   **Bug reports now include CPU and memory**: the "Copy environment info" output adds your CPU core count, architecture, and total RAM (desktop only). These help diagnose memory- and performance-sensitive issues with the built-in on-device model.

### Fixed

-   **Built-in model no longer crashes when indexing large notes** (with GPU acceleration off): the on-device model could fail with a bare number (e.g. `8934496`) in the Errored files list, and once it hit one problem note the rest of the vault tended to fail too. The cause was embedding all of a note's chunks in a single pass; on a large note (e.g. a long config or README) that one pass exceeded the on-device engine's memory limit and aborted it. That limit is fixed and independent of how much RAM you have, so a powerful desktop was affected just like a small machine. Notes are now embedded in smaller batches, so a single large note can no longer exhaust the limit. Any crash that still occurs now shows a readable message instead of a bare number. After updating, retry the affected notes (Index settings → Retry errored, or Reindex).
-   **Hiding the ribbon icon now sticks across restarts** (#50): if you hid the Similar Notes icon from the left ribbon (right-click → uncheck), it came back every time you reopened Obsidian. The icon was registered too late in startup to receive Obsidian's "hidden ribbon items" preference, so it always reappeared. It now registers early like core plugins, so a hidden icon stays hidden.
-   **Clicking the ribbon icon during startup no longer opens an empty pane** (#50): registering the icon early (above) briefly made it clickable before the plugin finished loading, which could open a blank Similar Notes pane. It now shows a "still loading" notice until the view is ready.
-   **"Copy environment info" now reports your current settings**: the Debug & Support "Copy to Clipboard" button captured settings once when the settings tab was opened, so after switching the model (or toggling an option like GPU / Include Frontmatter) the copied report showed a stale value, usually the model from one or two changes earlier. It now reads your settings at click time, so bug reports match what you actually have selected.
-   **Better recommendations for long, multi-topic notes on large-context models**: chunk size was tied to the embedding model's context window, so with a large-context model (e.g. Ollama `bge-m3`, OpenAI) a long note mixing several topics was split into chunks so coarse that any single topic's signal was averaged away. Genuinely related notes were then missed, or buried under unrelated notes that merely shared structure (tables, headings). Notes are now chunked at a focused semantic size regardless of the model. In testing, a long note covering many topics now surfaces a focused related note clearly at the top, with the matching passage as the excerpt, where before it ranked only marginally above unrelated notes. **Run a full reindex** (Index settings → Reindex) on existing vaults to apply the finer chunking.

## [1.5.0] - 2026-06-13

### Added

-   **Semantic Link Suggestions in the Editor** (#35): Type a trigger (default `;;`) followed by a description to get semantic note suggestions inline and insert a `[[link]]`
    -   Same inline dropdown as Obsidian's `[[` linker — type a rough description (e.g. `;;book with zombie`) and pick the note you meant, even when you've forgotten its exact title
    -   Selecting a result replaces the `;;…` text with a `[[wikilink]]` at your cursor
    -   New "Semantic link trigger" field under Display settings — change the trigger (e.g. `@@`) or leave it empty to disable. The trigger is standalone (not `[[`) so Obsidian's built-in link autocomplete is left untouched
-   **Errored notes are visible and retryable** (#45, #46): Notes that fail to index now appear under a new "Errored files" list in the Index settings, with the error reason — separate from excluded files. A "Retry errored" button (also in the status-bar menu and as a "Retry errored notes" command) re-attempts them after you fix the cause (e.g. switch model, restore Ollama). Editing a note retries it automatically.

### Changed

-   **Index settings reorganized**: The single crowded Index section is split into three focused sections. **Index** keeps statistics, indexing delay, Include frontmatter, Reindex, and the errored-files list (Reindex now sits after the two indexing options instead of between them). **Exclude folders from index** holds the folder/glob patterns, the excluded-files preview, and the Apply action (renamed from "Apply exclusion patterns" to **"Apply folder patterns"**, since it only adds/removes files by folder pattern — content patterns take effect on reindex). **Exclude content from index** holds the content-regex field and its RegExp tester (the field now appears above the tester, previously below it).
-   **Excalidraw excluded from indexing by default** (#46): New installs now skip the default `Excalidraw/` folder. Excalidraw drawings are stored as base64-compressed binary data that can't be embedded and isn't meaningful to search. Existing users' exclusion settings are unchanged — remove the pattern if you want those files indexed.

### Improved

-   **Faster Ollama indexing** (#46): A note's chunks are now embedded in batched requests instead of one network round-trip per chunk, so indexing on Ollama is quicker — most noticeable on large vaults and with small-context models (which split notes into many chunks).

### Fixed

-   **Non-English notes failing to index on Ollama** (#46): Notes with Korean/CJK (or other multi-byte) content could fail to index with an "input length exceeds the context" error. The chunk-size estimate assumed English-length tokens and packed far too much text into each chunk for the model's context window. The estimate is now based on UTF-8 byte length, so chunks stay within the model's limit regardless of script.
-   **Token-dense notes failing to index on Ollama** (#46): Notes packed with tables, numbers, code, or file paths could still fail with an "input length exceeds the context length" error — even after the byte-based estimate above — because that content tokenizes into more tokens than any byte estimate predicts, overflowing the model's context window. Two changes fix it: indexing now uses Ollama's modern `/api/embed` endpoint with truncation enabled, so an over-long chunk is trimmed to fit instead of failing the whole note; and chunk size is now capped against the model's real context length (read from the model info), not just an empirical size probe. For these documents, `bge-m3` (8K context) and `nomic-embed-text` (2K) have the most headroom.
-   **Honest indexing status** (#45, #46): Indexing failures are no longer hidden. The plugin previously reported the whole vault as indexed — and lumped failed notes into the "Excluded" count — even when notes had silently failed to index. The Index settings now show separate **Indexed / Errored / Excluded** counts, and the status bar shows how many notes errored. A note is retried a few times before being marked errored, and a terminally-errored note is no longer re-attempted on every restart (which previously crashed at the same point each launch).

## [1.4.0] - 2026-06-06

### Added

-   **Create Note from Semantic Search** (#37): Press Shift+Enter in the semantic search popup (Ctrl+Shift+O) to create a new note named after your query
    -   Mirrors Obsidian's Quick Switcher — type a rough title, create the note, refine the title later
    -   If a note with that name already exists, it opens the existing note instead of creating a duplicate

### Changed

-   **Semantic Search Shortcuts Reworked** (#37): Aligned with Obsidian's Quick Switcher
    -   "Insert as link" moved from Shift+Enter / Shift+Click to **Alt+Enter / Alt+Click** (Shift+Enter now creates a note)
    -   Inserting a link no longer closes the popup, so you can insert several links in a row (Alt+Enter, navigate, Alt+Enter, …) and press Esc when done

### Fixed

-   **Major Memory Leak on Reload** (#8): The embedding model's Web Worker was never terminated when the plugin unloaded or reloaded, leaving the loaded model in memory (potentially several GB) and accumulating across reloads. The worker is now terminated on unload, reclaiming that memory
-   **Ollama Server URL Input** (#43): The server URL field no longer loses focus after each typed character — you can now type the full URL normally

## [1.3.0] - 2026-05-30

### Added

-   **Minimum Similarity Threshold** (#39): Filter out low-relevance recommendations
    -   New "Minimum similarity" field under Display settings (0.00 – 1.00, default 0 keeps every result)
    -   Suggestions scoring below the threshold are hidden from both the sidebar and the in-document panel

### Changed

-   **New Plugin Icon** (#39): Ribbon, sidebar tab, and status bar now use a telescope icon
    -   Replaces the previous "files" icon, which visually collided with Obsidian's copy and insert-template buttons

### Improved

-   **Faster File Renames** (#39): Moving a file between folders no longer triggers full re-embedding
    -   Embeddings are now preserved on pure renames; only the indexed path is updated

### Fixed

-   **Sidebar Now Clears on Note Close** (#39): Stale recommendations no longer linger after closing the active note or switching to a non-markdown file
-   **Clear Error for Missing Local Models** (#38): Model loads that fail because ONNX files are missing now show an actionable error instead of a generic "Network error"

## [1.2.0] - 2026-02-09

### Added

-   **Insert as Link from Semantic Search**: Insert a `[[link]]` directly from the semantic search popup (Ctrl+Shift+O)
    -   Press Shift+Enter or Shift+Click to insert the selected note as a wiki link at your cursor position
    -   No need to remember exact note names — search semantically, then link directly

### Improved

-   **Smarter Link Format**: Inserted links now respect Obsidian's "New link format" setting
    -   Applies to both drag-and-drop and the new insert-as-link feature
    -   Uses shortest path when possible, or includes folder path only when needed to disambiguate duplicate names
-   **Default Note Display**: Note display mode now defaults to "smart" for better readability

## [1.1.0] - 2026-02-02

### Added

-   **Google Gemini Embedding Support**: Use Google's Gemini API for embeddings
    -   Support for gemini-embedding-001 model
    -   Real-time usage statistics with accurate token counting via Gemini's countTokens API

### Improved

-   **Embedding Performance**: Parallel processing and batching optimization
    -   Faster indexing of large vaults through optimized embedding generation
    -   More efficient API usage with batched requests
-   **Settings UI Stability**: Prevents input focus loss during real-time stats updates
    -   API usage statistics now update without disrupting user input
    -   Smoother experience when configuring settings while indexing is in progress
-   **Error Notifications**: Error messages now include the note name that caused the issue
    -   Makes it easier to identify and troubleshoot problematic notes
    -   Better context for debugging indexing failures

## [1.0.0] - 2026-02-01

### Added

-   **OpenAI Embeddings API Integration**: Use OpenAI's embedding models or any OpenAI-compatible API
    -   Support for text-embedding-3-small, text-embedding-3-large, and text-embedding-ada-002
    -   Compatible with any OpenAI-compatible API endpoints (e.g., Azure OpenAI, local servers)
    -   Custom model support for OpenAI-compatible APIs
    -   Real-time usage statistics tracking during indexing
    -   API usage stats display in settings (total tokens used)
-   **Configurable Indexing Delay**: New setting to control delay between indexing notes
    -   Helps prevent rate limiting when using cloud APIs
    -   Configurable from 0ms to 5000ms

### Changed

-   Default to OpenAI provider on mobile for new installations

### Fixed

-   Filter non-embedding models in Ollama model dropdown

### Improved

-   Consistent settings UI using Obsidian's SettingGroup API

## [0.12.0] - 2026-01-18

### Added

-   **Configurable Result Count**: Control how many similar notes are displayed
    -   Separate settings for sidebar and bottom panel
    -   Choose between 3, 5, 10, 15, or 20 results per view
-   GitHub issue templates for bug reports and feature requests

### Fixed

-   Retry button now only appears for Ollama connection errors

## [0.11.1] - 2026-01-04

### Added

-   Bug reporting button in settings
-   Clickable status bar menu with stats and actions
-   Note titles included in embeddings for better search (#26)

### Changed

-   Dragged links now insert at drop position instead of cursor (#23)
-   Improved status bar icon and tooltip
-   Added CI workflow, resolved ESLint warnings

## [0.11.0] - 2025-12-21

### Added

-   **Semantic Search**: New Quick Switcher-style modal for searching notes by meaning
    -   Press `Cmd/Ctrl + Shift + O` to open the semantic search modal
    -   Search across all indexed notes using natural language queries
    -   Results ranked by semantic similarity, not just keyword matching

### Changed

-   **Clearer Command Names**: Renamed commands for better clarity
    -   "Show Similar Notes" → "Show in sidebar"
    -   "Toggle in-document view" → "Toggle footer view"

## [0.10.5] - 2025-12-20

### Added

-   **Drag and Drop Support**: Drag similar notes to insert links directly into your documents
    -   Drag any similar note from the results to insert a `[[note-link]]` at the drop location
    -   Works in both sidebar and bottom view
-   **Model Information Display**: Settings now show detailed model information
    -   Built-in models display dimension, size, and language support
    -   Ollama models show embedding dimensions from the server
    -   Model info is cached to reduce API calls

### Other

-   Added ESLint configuration for code quality
-   Various code refactoring and type safety improvements

## [0.10.4] - 2025-12-14

### Fixed

-   **Skip Non-Markdown Files**: Binary files (images, PDFs, etc.) no longer trigger unnecessary embedding generation
    -   Previously, opening an image or PDF would attempt to embed the binary data as text
    -   Now only `.md` files are processed for similar notes lookup
    -   Eliminates wasted API calls and meaningless search results

### Improved

-   **Ollama Bug Workarounds**: Added automatic detection and workarounds for Ollama v0.12.5+ bugs
    -   Auto-detect max token limits to avoid random embedding failures
    -   Conservative token counting (3.5 chars/token) for better payload estimation
    -   Sequential processing to match Ollama's server-side queuing behavior
-   **Duplicate Embedding Prevention**: Check repository before generating new embeddings
    -   Avoids regenerating embeddings for already-indexed chunks
    -   Reduces unnecessary API calls during similar notes lookup
-   **Enhanced Logging**: Comprehensive logging for troubleshooting Ollama issues
    -   Payload sizes, token counts, and timing information logged
    -   Helps diagnose embedding failures and performance issues

## [0.10.3] - 2025-11-01

### Fixed

-   **File Rename/Move Handling**: Plugin now properly detects and handles file rename/move operations
    -   Automatically removes old path data from index when files are renamed or moved
    -   Re-indexes files at their new location
    -   Prevents stale data accumulation in the index

### Improved

-   **Ollama Error Notifications**: Added user-friendly error notifications for Ollama connection failures
    -   Clear notifications when Ollama server is unreachable
    -   Throttled notifications (1 per minute) to prevent spam
    -   Error states propagated to UI via observables
    -   Graceful error handling - indexing continues even when embedding fails
-   **Error Message Clarity**: All error notifications now include "Similar Notes:" prefix
    -   Makes it easy to identify which plugin the error is from
    -   Consistent error message format across the plugin
-   **Stale Data Logging**: Added error logging when similar notes reference non-existent files
    -   Helps diagnose cases where index contains outdated file references
    -   Logs include file path for easier debugging
    -   Makes it clear when fewer similar notes are shown due to stale data

## [0.10.2] - 2025-10-29

-   **Fix Reindex for 0.10.0 Users**: Extended automatic reindex to include users upgrading from v0.10.0
    -   v0.10.0 had migration issues that could result in corrupted data
    -   Users upgrading from v0.10.0 or earlier will now automatically trigger reindex
    -   Ensures all users have clean, valid IndexedDB data

## [0.10.1] - 2025-10-29

-   **Automatic Reindex on Upgrade**: Changed migration strategy to ensure data integrity
    -   Previous JSON storage format had issues where embeddings were not properly stored in some cases
    -   Instead of attempting to migrate potentially corrupted JSON data, plugin now automatically triggers full reindex on upgrade to v0.10.1
    -   All notes will be re-indexed with the new IndexedDB storage format
    -   Ensures all users start with clean, valid data in IndexedDB

## [0.10.0] - 2025-10-28

-   **IndexedDB Storage Migration**: Migrated from JSON file storage to IndexedDB for better performance and reliability
    -   Automatic one-time migration from JSON to IndexedDB on first load
    -   Original JSON files backed up with timestamp during migration
    -   Data automatically persists on write - removed auto-save interval setting
-   **Vault Isolation**: Each Obsidian vault now maintains its own separate IndexedDB instance
    -   Uses `app.appId` to create vault-specific databases
    -   Prevents data conflicts when using multiple vaults on the same device
-   **Chunk Validation**: Added validation to prevent corrupted data from being stored
    -   Validates embedding arrays before inserting into database
    -   Filters out invalid chunks during migration
-   **Multi-Device Usage**: Updated README to clarify that IndexedDB data does not sync across devices
    -   Each device maintains its own independent index
    -   Automatic re-indexing when opening vault on a new device

## [0.9.0] - 2025-08-05

-   **Database Location Change**: Moved database files from `.obsidian/` to `.obsidian/plugins/similar-notes/`
    -   Allows cleaner exclusion of plugin directory for users who sync `.obsidian` but not plugins
    -   Affected files: `similar-notes.json` and `similar-notes-file-mtimes.json`
-   **Folder/File Exclusions**: Added ability to exclude specific folders and files from indexing
    -   Configure excluded paths in settings
    -   Supports glob patterns for flexible exclusion rules
-   **Enhanced Index Statistics**: Settings now display additional index information
    -   Total chunk count across all indexed notes
    -   Database file size
    -   Number of excluded files based on exclusion rules

## [0.8.0] - 2025-07-28

-   **Mobile Support**: Plugin now fully works on Obsidian mobile apps (iOS/Android)
    -   All features function identically to desktop version
-   **Model Download Progress**: Real-time download progress indicator
    -   Shows percentage in status bar during model downloads
    -   Updates current model display in settings with download progress
-   **Enhanced Error Handling**: Improved error messages and recovery
    -   Model loading failures now display clear error reasons in settings
    -   User-friendly error messages for common issues (GPU, network, etc.)
-   **GPU Fallback**: Automatic CPU fallback when GPU acceleration fails
    -   Seamlessly retries with CPU mode on GPU errors
    -   Prompts to disable GPU setting after successful CPU fallback
    -   No manual intervention required for GPU-incompatible devices

## [0.7.1] - 2025-07-27

### Added

-   **Command Palette Integration**: Three new commands accessible via command palette (Cmd/Ctrl+P)
    -   **Show Similar Notes**: Opens the similar notes sidebar
    -   **Toggle in-document view**: Toggles the display of similar notes at the bottom of documents
    -   **Reindex all notes**: Forces a complete rebuild of the note index

### Changed

-   n/a

### Fixed

-   n/a

### Other

-   n/a

## [0.7.0] - 2025-07-25

### Added

-   **Similar Notes Sidebar**: New sidebar view accessible via ribbon icon
    -   Displays similar notes in Obsidian's right sidebar
    -   Automatically tracks the currently active file
    -   Same UI and functionality as bottom view but in a dedicated panel
    -   Toggleable independently from bottom view display
-   **Bottom View Toggle**: New setting to show/hide similar notes at the bottom of notes
    -   Located in Display section: "Show similar notes at the bottom of notes"
    -   Enabled by default for backward compatibility
    -   When disabled, similar notes are hidden from note bottoms but sidebar remains available

### Changed

-   **Architecture Improvements**: Major refactoring for better maintainability
    -   Introduced ViewManager abstraction for managing view lifecycles
    -   Improved dependency injection following SOLID principles
    -   Enhanced error handling with graceful degradation
    -   Better separation of concerns between components

### Fixed

-   **Error Handling**: Improved stability when views fail to create (e.g., missing backlinks container)

### Other

-   n/a

## [0.6.0] - 2025-07-24

### Added

-   **Configurable Note Display Modes**: Three options for how note names appear in similar notes results
    -   **Title only**: Show just the note title (default behavior)
    -   **Full path**: Display complete file path for all notes
    -   **Smart**: Show path only when duplicate note names exist, otherwise show title
-   **Tooltip Support**: Hover over any note title to see the full file path regardless of display mode
-   **New Display Settings Section**: Organized display-related options in a dedicated settings section
-   **Path Truncation**: Long file paths are automatically truncated with CSS ellipsis for better readability

### Changed

-   **Settings UI Reorganization**: Moved "Show source chunk in results" option from Debug section to the new Display section

### Fixed

-   **GPU Acceleration Toggle**: GPU acceleration setting changes now properly trigger model reload when Apply button is clicked

### Other

-   n/a

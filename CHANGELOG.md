# Changelog

All notable changes to this project will be documented in this file.

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

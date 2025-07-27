# Changelog

All notable changes to this project will be documented in this file.

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

# Changelog

All notable changes to this project will be documented in this file.

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

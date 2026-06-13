# Using the export command from an agent

Similar Notes exports the active note's similar-notes results to a JSON file via the `export-active-note-similar-notes` command. This guide shows how an external coding agent (Claude Code, opencode, Cursor, etc.) drives that export and consumes it, without touching embeddings, the index, or any plugin internals.

## Command

- Palette name: **Similar Notes: Export similar notes for active note**
- Command id: `similar-notes:export-active-note-similar-notes`

Running it writes the active markdown file's similar-notes results to:

```
<vault>/.obsidian/plugins/similar-notes/similar-notes-export.json
```

## Output

Success:

```json
{
  "version": 1,
  "ok": true,
  "sourcePath": "Projects/My Note.md",
  "generatedAt": "2026-06-09T12:34:56.000Z",
  "results": [
    {
      "path": "Knowledge/Related Note.md",
      "title": "Related Note",
      "score": 0.82,
      "excerpt": "matched chunk from similar note"
    }
  ]
}
```

- `version`: contract version (currently `1`). Bumped if the payload shape changes, so an agent can branch on it.
- `score`: higher = more similar. No fixed scale; compare within a single export.
- `excerpt`: chunk from the matched note that scored highest.
- `results`: pre-sorted by `score` desc. May be empty if the source note is not yet indexed — this is not an error.

The file is written atomically (rendered to a temp file, then moved into place), so a reader never observes a partially written file.

Failure (same file path):

```json
{ "version": 1, "ok": false, "code": "NO_ACTIVE_FILE", "error": "No active markdown file" }
```

- `code`: stable, machine-readable reason — one of `NO_ACTIVE_FILE` (no active markdown file when the command ran) or `SEARCH_FAILED` (the similarity search threw). Branch on `code`; the human-readable `error` string may change.

## Driving the command from an agent

The export always targets Obsidian's currently active markdown file. To run end-to-end from a script or agent:

1. **Make the target note active**, e.g. via the [Obsidian CLI](https://help.obsidian.md/cli):
   ```bash
   obsidian open path="Folder/Note.md"
   ```
2. **Trigger the command**:
   ```bash
   obsidian command id=similar-notes:export-active-note-similar-notes
   ```
3. **Read** `.obsidian/plugins/similar-notes/similar-notes-export.json` from the vault root.

Without the Obsidian CLI, any mechanism that activates a file and runs the command works (Advanced URI plugin, manual user trigger, etc.).

## Validation tips for agents

- Check `sourcePath` matches the note you intended.
- Check `generatedAt` is recent (within the last ~60s). A stale file means the command did not actually run for this invocation.

## Skill snippet

A minimal agent skill (works for Claude Code, opencode, and similar tools — drop into your agent's skills directory):

```markdown
---
name: finding-similar-notes
description: Find semantically similar notes for an Obsidian note via the Similar Notes plugin.
---
# Finding Similar Notes

Use when user asks for notes similar / related / semantically close to a given note. Needs the Similar Notes plugin enabled and the `obsidian` CLI with Obsidian running.

## Steps

1. Make target note active:
   `obsidian open path="Folder/Note.md"` (or `file="Note"` for wikilink-style lookup)
2. Trigger export:
   `obsidian command id=similar-notes:export-active-note-similar-notes`
3. Read `.obsidian/plugins/similar-notes/similar-notes-export.json` (vault-relative).

## Output

Success: `{ "version": 1, "ok": true, "sourcePath", "generatedAt", "results": [{ "path", "title", "score", "excerpt" }] }`. Pre-sorted by `score` desc.

Failure: `{ "version": 1, "ok": false, "code", "error" }`. `code` is `NO_ACTIVE_FILE` or `SEARCH_FAILED`.

## Validation

Confirm `sourcePath` matches the intended note and `generatedAt` is within the last ~60s.

## Don't

- Don't pass the target note to the command — it always uses the active file. Step 1 is required.
- Don't re-implement similarity search.
```

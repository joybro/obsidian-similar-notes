# UX map — Similar Notes

Format: limehouse `ux-map` skill (tasks, flows, screens; no visuals or copy).
Host app is Obsidian, so "screens" are the plugin's surfaces inside it: the
footer panel under a note, the sidebar view, the semantic-search modal, the
`;;` link suggestion popup, the status bar item and the settings tab. Feature
specs carry a "지도 변경분" (map delta) and the shipping change edits this file.

How each (screen, state) is reproduced is in **Reproduction** at the end:
there is no DEBUG screen-entry hook in the plugin, so pairs are opened in the
disposable **Test_local** vault through synthetic notes, settings and the
Obsidian CLI (`CLAUDE.md` § Manual Verification), and each pair is marked
`auto`, `manual` or `not reproducible`.

## 과업

- T1 reading or writing a note, see which other notes are about the same thing (to revisit or link them)
- T2 looking for a note whose title I don't remember, search the vault by meaning
- T3 while writing, insert a link to a related note without leaving the keyboard
- T4 after installing or changing the model, wait until the vault is indexed and know when it is ready
- T5 keep private notes or passages out of the index (rare)
- T6 let an external agent read the active note's similar notes (rare)
- T7 recover notes that failed to index (rare)
- T8 working across many notes, keep the similar-notes list open beside the editor

## 흐름

- T1: (open a note) → note-footer → hover-preview (Cmd+hover) → open result (click / Cmd-click new tab) or drag into editor (link) → note-footer of the opened note
- T8: command "Show in sidebar" or ribbon → sidebar → same actions as note-footer → note-footer of the opened note
- T2: Cmd+Shift+O → search-modal → type (required: ≥ min length) → pick result → (opened note)
- T3: type the trigger `;;` + words in the editor → link-suggest → pick → link inserted in the editor
- T4: install / Load & Apply in settings (load-model-modal) → status-bar (downloading → indexing → idle)
- T5: settings → Exclude files from index / Exclude content from index → Apply Rules → status-bar (indexing)
- T6: command "Export similar notes for active note" → JSON file `.obsidian/plugins/similar-notes/similar-notes-export.json` (no screen; contract in `docs/agent-export.md`)
- T7: status-bar menu (N errored) → command "Retry errored notes" → status-bar

## 화면

- 오류에서: every surface stays usable; an embedding or provider failure shows an Obsidian Notice and the status bar error state, and the user leaves by fixing the provider in settings, then Retry errored notes or reopening the note.

- screen: note-footer | states: empty, empty-excluded-note, partial-not-indexed, ideal, ideal-linked, ideal-collapsed, error-embedding
  - 무엇을 보여주나: under the open note, the top similar notes with score, optional source chunk, "linked" tag for notes already linked
  - 행동: open, open in new tab (Cmd-click), hover preview (Cmd+hover), drag into editor, right-click menu (Open link, Open in new tab, Copy Obsidian URL), collapse
  - empty: "No similar notes found" (nothing above the Minimum similarity threshold, or an empty vault)
  - empty-excluded-note: the open note is excluded; today it still embeds on the fly (frontmatter-exclusion spec §2.1, owner decision pending for cloud providers)
  - partial-not-indexed: the open note has no indexed chunks yet; results come from an on-the-fly embedding
  - error-embedding: on-the-fly embedding failed; Notice and empty list
  - → hover-preview (overlay): Cmd+hover a result
  - → note-footer (replace): open a result

- screen: sidebar | states: empty, ideal, ideal-linked
  - 무엇을 보여주나: same list as note-footer for the active note, in a right-sidebar leaf (sidebar result count setting)
  - 행동: same as note-footer
  - → hover-preview (overlay): Cmd+hover a result
  - → sidebar (back): close the leaf

- screen: hover-preview | states: ideal
  - 무엇을 보여주나: Obsidian's native page preview of the hovered result (Page Preview core plugin)
  - → note-footer (back): move the pointer away

- screen: search-modal | states: empty, partial-short-query, loading, ideal, empty-no-results, error-search
  - 무엇을 보여주나: query box and results ranked by meaning
  - 행동: type, move selection, open, create a note from the query
  - 오류에서: Notice, the modal stays open; edit the query or close
  - → search-modal (back): Esc

- screen: link-suggest | states: loading, ideal, empty-no-results
  - 무엇을 보여주나: popup under the cursor with notes similar to the words typed after the trigger
  - 행동: pick (inserts a link), Cmd+hover preview
  - → link-suggest (back): Esc or keep typing past the trigger

- screen: status-bar | states: ideal, loading-downloading, loading-indexing, partial-errored, error
  - 무엇을 보여주나: model download %, "N to index", or idle; menu with Indexed X/Y notes, errored count, model and provider
  - 행동: open the menu
  - 오류에서: the menu shows the last error; fix the provider in settings, then Retry errored notes

- screen: settings | states: ideal, ideal-mobile-warning, partial-unapplied-model, ideal-trigger-off
  - 무엇을 보여주나: model provider and model (Load & Apply), display options, link-suggestion trigger (empty trigger turns it off), index exclusions with preview and Apply Rules, usage stats, Reindex and Clear
  - 행동: change provider/model, Load & Apply, edit exclusions, Apply Rules, Reindex, Clear
  - → load-model-modal (modal): Load & Apply
  - → settings (back): close settings

- screen: load-model-modal | states: loading, ideal, error
  - 무엇을 보여주나: confirmation and progress for switching model (re-embeds the whole vault)
  - 오류에서: close and fix the model id or provider
  - → settings (back): close

## Reproduction (Test_local)

The vault `~/Obsidian/Test_local` is disposable test data. Never use the owner's own vault.

Install the build (the repo's `npm run install-local` calls `scripts/install-local.sh`, which is gitignored and exists only on the machine that made it; this is the same step):

```bash
npm run build
cp main.js manifest.json styles.css ~/Obsidian/Test_local/.obsidian/plugins/similar-notes/
PATH="$PATH:/Applications/Obsidian.app/Contents/MacOS"
obsidian vault=Test_local plugin:reload id=similar-notes
```

Synthetic repro for T1 note-footer `ideal` (requires the Obsidian app running with Test_local open):

```bash
V=~/Obsidian/Test_local
printf '# Coffee brewing\nPour-over coffee needs a medium-fine grind and 93C water.\n' > "$V/ux-coffee-a.md"
printf '# Espresso notes\nEspresso coffee uses a fine grind and high pressure.\n' > "$V/ux-coffee-b.md"
obsidian vault=Test_local open path="ux-coffee-a.md"
# wait for indexing (status bar idle), then count footer results:
obsidian vault=Test_local eval code="document.querySelectorAll('.search-result-file-title').length"
```

| Pair | How | Kind |
|---|---|---|
| note-footer ideal, ideal-linked | two related notes as above; for linked add `[[ux-coffee-b]]` to note a | auto |
| note-footer empty | Minimum similarity = 1 in settings, reopen the note | auto (settings via `data.json` + plugin:reload) |
| note-footer empty-excluded-note, partial-not-indexed | Path patterns `ux-*` in settings, Reindex, open note a | auto |
| note-footer error-embedding | provider OpenAI with an invalid key | manual (key entry) |
| note-footer ideal-collapsed, hover-preview | click the header; CDP `Input.dispatchMouseEvent` with Cmd (`CLAUDE.md` § UI verification) | auto (CDP) |
| sidebar * | command `similar-notes:show-similar-notes` then as note-footer | auto |
| search-modal * | command `similar-notes:semantic-search`, then CDP `Input.insertText` | auto (CDP) |
| link-suggest * | focus editor, CDP `Input.insertText` `;;coffee` | auto (CDP) |
| status-bar loading-downloading | first install of a builtin model not cached yet | manual (network, one-time) |
| status-bar loading-indexing, ideal | command `similar-notes:reindex-all-notes` | auto |
| status-bar partial-errored, error | invalid provider URL (Ollama on a closed port) | auto |
| settings ideal-mobile-warning | only on a phone (`Platform.isMobile`) | not reproducible on desktop |
| load-model-modal * | Load & Apply in settings | manual (button in settings UI) |

Status of this table (2026-11-19): written from the code at 17e83be..f02e85d; the commands above have not yet been run end to end against Test_local. Checked on the Mac mini the same day: Obsidian 1.15.1 was running, but `obsidian vault=Test_local eval …` answered "Command line interface is not enabled" (Settings → General → Advanced) and "Your Obsidian installer is out of date". Until the CLI is turned on there, every `auto` row runs only on a machine where it is enabled (the laptop path in `CLAUDE.md`); on the mini they are `manual`.

# UX map — Similar Notes

Format: tasks, flows and screens, without visuals or copy.
Host app is Obsidian, so "screens" are the plugin's surfaces inside it: the
footer panel under a note, the sidebar view, the semantic-search modal, the
`;;` link suggestion popup, the status bar item and the settings tab. Feature
specs carry a "지도 변경분" (map delta) and the shipping change edits this file.

How each (screen, state) is reproduced is in **Reproduction** at the end:
there is no DEBUG screen-entry hook in the plugin, so pairs are opened in the
disposable **PluginSandbox** vault through synthetic notes, settings and the
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
- T8 (read previews): sidebar → Expand all → sidebar (ideal-expanded, kept across note switches)
- T2 from the sidebar: sidebar → Semantic search button → search-modal → Esc → sidebar (focus back on the button)
- T2: Cmd+Shift+O → search-modal → type (required: ≥ min length) → pick result → (opened note)
- T3: type the trigger `;;` + words in the editor → link-suggest → pick → link inserted in the editor
- T4: install / Load & Apply in settings (load-model-modal) → status-bar (downloading → indexing → idle)
- T5: settings → Exclude files from index / Exclude content from index → Apply rules → status-bar (indexing)
- T6: command "Export similar notes for active note" → JSON file `.obsidian/plugins/similar-notes/similar-notes-export.json` (no screen; contract in `docs/agent-export.md`)
- T7: status-bar menu (N errored) → command "Retry errored notes" → status-bar

## 화면

- 오류에서: every surface stays usable; an embedding or provider failure shows an Obsidian Notice and the status bar error state, and the user leaves by fixing the provider in settings, then Retry errored notes or reopening the note.

- screen: note-footer | states: loading, loading-downloading, empty, empty-unwritten, empty-below-threshold, empty-excluded-note, loading-indexing, partial-not-indexed, ideal, ideal-linked, ideal-collapsed, error-embedding
  - 무엇을 보여주나: under the open note, the top similar notes with score, optional source chunk, "linked" tag for notes already linked
  - 행동: open, open in new tab (Cmd-click), hover preview (Cmd+hover), drag into editor, right-click menu (Open link, Open in new tab, Copy Obsidian URL), collapse
  - Each empty state is one grey line in the same place; only the text differs (`docs/panel-empty-states-spec.md`).
  - loading: nothing searched yet for this note (right after the plugin turns on, until the first result): "Looking for similar notes…"
  - loading-downloading: the built-in model is being downloaded; no search runs, also for notes opened meanwhile: "Downloading the model: N%. Similar notes will appear when it's ready." N follows the status bar's percent
  - empty: "No similar notes found." (the search ran, nothing came back, nothing is waiting to be indexed)
  - empty-unwritten: the note has no text (after exclusion patterns) and is not an excluded note under OpenAI or Gemini (that one shows empty-excluded-note): "Write a few lines and similar notes will appear here."
  - empty-below-threshold: results exist but all are under Minimum similarity: "No notes above the minimum similarity (0.50)."
  - empty-excluded-note: the open note is excluded and the provider is OpenAI or Gemini, so it is not embedded on the fly (frontmatter-exclusion spec §2.1): "This note is excluded from the index, so it isn't sent to OpenAI." (or Gemini); with a local provider it shows results like partial-not-indexed
  - loading-indexing: the search found nothing while notes are queued for indexing: "Indexing your vault: N notes left. Results fill in as notes are indexed." N follows the status bar's "N to index"; while it shows, the panel searches again at most every 10 s as N drops (results replace the line), and once more when the queue empties; a "No similar notes found." panel switches to this line when notes become queued
  - partial-not-indexed: the open note has no indexed chunks yet; results come from an on-the-fly embedding
  - error-embedding: on-the-fly embedding failed; Notice plus "Couldn't analyze this note. Check the model in Settings, then reopen the note."
  - → hover-preview (overlay): Cmd+hover a result
  - → note-footer (replace): open a result

- screen: sidebar | states: loading, loading-downloading, empty, empty-no-note, ideal, ideal-linked, ideal-expanded
  - 무엇을 보여주나: same list as note-footer for the active note, in a right-sidebar leaf (sidebar result count setting), under a toolbar row with two buttons (`docs/sidebar-toolbar-spec.md`)
  - 행동: same as note-footer; Expand all / Collapse all (hidden in empty); Semantic search…
  - empty-no-note: no note to follow (no markdown editor open, or the main-area tab used last is a canvas, PDF or image): "Open a note and similar notes will appear here."; the previous results are dropped
  - ideal: rows collapsed (default mode); per-row chevrons open single rows
  - ideal-expanded: after Expand all every row shows its preview; the mode stays when the active note changes, results refresh or Obsidian restarts (saved in the view state), until Collapse all. Per-row toggles hold while the same note's results refresh and reset on note switch
  - → hover-preview (overlay): Cmd+hover a result
  - → search-modal (modal): Semantic search button (Enter or Space too)
  - → sidebar (back): close the leaf

- screen: hover-preview | states: ideal
  - 무엇을 보여주나: Obsidian's native page preview of the hovered result (Page Preview core plugin)
  - → note-footer (back): move the pointer away

- screen: search-modal | states: empty, partial-short-query, loading, ideal, empty-no-results, error-search
  - 무엇을 보여주나: query box and results ranked by meaning
  - 행동: type, move selection, open, create a note from the query
  - 오류에서: Notice, the modal stays open; edit the query or close
  - → search-modal (back): Esc
  - → sidebar (back): Esc when opened from the sidebar button; focus returns to that button

- screen: link-suggest | states: loading, ideal, empty-no-results
  - 무엇을 보여주나: popup under the cursor with notes similar to the words typed after the trigger
  - 행동: pick (inserts a link), Cmd+hover preview
  - → link-suggest (back): Esc or keep typing past the trigger

- screen: status-bar | states: ideal, loading-downloading, loading-indexing, partial-errored, error
  - 무엇을 보여주나: model download %, "N to index", or idle; menu with Indexed X/Y notes, errored count, model and provider
  - 행동: open the menu
  - 오류에서: the menu shows the last error; fix the provider in settings, then Retry errored notes

- screen: settings | states: ideal, ideal-mobile-warning, partial-unapplied-model, ideal-trigger-off
  - 무엇을 보여주나: model provider and model (Load & Apply), display options, link-suggestion trigger (empty trigger turns it off), index exclusions with preview and Apply rules, usage stats, Reindex and Clear
  - 행동: change provider/model, Load & Apply, edit exclusions, Apply rules, Reindex, Clear
  - → load-model-modal (modal): Load & Apply
  - → settings (back): close settings

- screen: load-model-modal | states: loading, ideal, error
  - 무엇을 보여주나: confirmation and progress for switching model (re-embeds the whole vault)
  - 오류에서: close and fix the model id or provider
  - → settings (back): close

## Reproduction (PluginSandbox)

The vault `~/Obsidian/PluginSandbox` is disposable test data.

Install the build into the test vault:

```bash
npm run build
cp main.js manifest.json styles.css ~/Obsidian/PluginSandbox/.obsidian/plugins/similar-notes/
PATH="$PATH:/Applications/Obsidian.app/Contents/MacOS"
obsidian vault=PluginSandbox plugin:reload id=similar-notes
```

Synthetic repro for T1 note-footer `ideal` (requires the Obsidian app running with PluginSandbox open):

```bash
V=~/Obsidian/PluginSandbox
printf '# Coffee brewing\nPour-over coffee needs a medium-fine grind and 93C water.\n' > "$V/ux-coffee-a.md"
printf '# Espresso notes\nEspresso coffee uses a fine grind and high pressure.\n' > "$V/ux-coffee-b.md"
obsidian vault=PluginSandbox open path="ux-coffee-a.md"
# wait for indexing (status bar idle), then count footer results:
obsidian vault=PluginSandbox eval code="document.querySelectorAll('.search-result-file-title').length"
```

| Pair | How | Kind |
|---|---|---|
| note-footer ideal, ideal-linked | two related notes as above; for linked add `[[ux-coffee-b]]` to note a | auto |
| note-footer empty | a note about a topic no other note shares, after indexing finishes | auto |
| note-footer empty-below-threshold | Minimum similarity = 1 in settings, reopen the note | auto (settings via `data.json` + plugin:reload) |
| note-footer empty-unwritten | create an empty note and open it | auto |
| note-footer loading-indexing | Reindex, then open a note right away (large vault so the queue is still long) | auto (timing-dependent) |
| note-footer empty-excluded-note | Path patterns `ux-*` and provider OpenAI (any key; no call is made), Reindex, open note a | auto |
| note-footer partial-not-indexed | same with the built-in model | auto |
| note-footer error-embedding | provider OpenAI with an invalid key | manual (key entry) |
| note-footer ideal-collapsed, hover-preview | click the header; CDP `Input.dispatchMouseEvent` with Cmd (`CLAUDE.md` § UI verification) | auto (CDP) |
| sidebar * | command `similar-notes:show-similar-notes` then as note-footer | auto |
| sidebar loading | disable then enable the plugin with a note open; read the sidebar within the first 2 seconds | auto (timing-dependent) |
| sidebar empty-no-note | sidebar open, then close every note tab (or open a PDF or canvas in the main area) | auto |
| sidebar ideal-expanded | sidebar ideal, then click `.similar-notes-sidebar-toolbar [aria-label="Expand all"]` via eval | auto |
| sidebar → search-modal → sidebar | click `[aria-label="Semantic search…"]` via eval, then CDP Escape; read `document.activeElement` | auto (CDP) |
| search-modal * | command `similar-notes:semantic-search`, then CDP `Input.insertText` | auto (CDP) |
| link-suggest * | focus editor, CDP `Input.insertText` `;;coffee` | auto (CDP) |
| status-bar loading-downloading | first install of a builtin model not cached yet | manual (network, one-time) |
| note-footer, sidebar loading-downloading | first install of a builtin model not cached yet; open another note while it downloads | manual (network, one-time) |
| status-bar loading-indexing, ideal | command `similar-notes:reindex-all-notes` | auto |
| status-bar partial-errored, error | invalid provider URL (Ollama on a closed port) | auto |
| settings ideal-mobile-warning | only on a phone (`Platform.isMobile`) | not reproducible on desktop |
| load-model-modal * | Load & Apply in settings | manual (button in settings UI) |

The note-footer states empty-unwritten, empty-below-threshold, empty-excluded-note, loading-indexing, error-embedding and ideal were rendered in Obsidian with runtime overrides for the cloud provider, threshold and a failing embedding. The other states remain subject to the reproduction conditions above.

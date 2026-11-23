# Obsidian Host Integration Specification

How the plugin uses Obsidian's own facilities where a browser API or a
plugin-side shortcut would also work. Each choice changes something a user
can see, so it is recorded here rather than only in code comments.

## 1. Ollama requests use `requestUrl`

Every call to an Ollama server (model list, model info, embeddings,
connection and model tests) goes through Obsidian's `requestUrl`, not the
browser `fetch`.

- `requestUrl` is not subject to CORS. A desktop or phone pointing at an
  Ollama server on another machine on the LAN works without setting
  `OLLAMA_ORIGINS` on that server. With `fetch` the request was blocked
  unless the server's allowed origins included Obsidian's.
- Requests pass `throw: false`, so 4xx/5xx responses still reach the
  client's own status checks and produce the same error messages as before
  (`Failed to generate embedding: HTTP <status>. <body>`).
- Obsidian's plugin review asks plugins to use `requestUrl` for network
  calls.

The OpenAI-compatible and Gemini clients are out of scope for this section.

## 2. The sidebar view survives a plugin reload

`onunload` does not detach the Similar notes sidebar leaves. When the
plugin is disabled and enabled again, or updated, Obsidian restores the
sidebar in the same place. Detaching the leaves on unload closed the
sidebar on every update, and Obsidian's plugin guidelines ask plugins not
to detach their leaves.

Obsidian does not await `onunload`; service teardown runs as one async
step after it returns, and a failure there is logged, not thrown.

Because the restored sidebar keeps the old view, the instance that was
turned off can stay referenced, and with it its IndexedDB connections.
Teardown closes the main-thread connections (mtimes, errored notes; the
chunk database lives in the index worker, which is terminated), and every
connection closes itself on `versionchange`. A connection left open blocks
a `deleteDatabase` or a version upgrade, and the next instance's open
queues behind that request forever: the plugin then loads with no status
bar and no results (seen with the sidebar open: turn off, delete the index
databases, turn on).

## 3. The editor drop handler defers to earlier handlers

The `editor-drop` handler that turns a dragged Similar notes result into a
link does nothing when the drop event is already `defaultPrevented`
(another plugin or Obsidian took it). It also does nothing unless the
dragged `[[path]]` resolves to a file (`TFile`), so a dropped folder path
or a stale path is left to Obsidian's default handling.

## 4. Notes already open at startup get results

Services start in `onLayoutReady`. By then Obsidian has already restored the
workspace and fired `file-open` and `active-leaf-change` for the restored
notes, while the handlers still had nothing to call. Without a catch-up, the
note open at startup showed no bottom panel and the sidebar said "No similar
notes found." until the user switched notes, on desktop and mobile alike.

As soon as the services exist, before the model is loaded, the plugin
therefore attaches a bottom view to every open markdown leaf that does not
have one yet and handles the active file as if it had just been opened. The
model is not usable yet, so the panel waits on the "looking" or "downloading"
line (panel-empty-states spec, "Model load") and the search for the active
file runs when the model and the index are ready. Leaves that gained a view
from an event during initialization keep it (no duplicate panel).

## 5. Verification

- `src/adapter/ollama/__tests__/OllamaClient.test.ts` covers the
  `requestUrl` calls and the error paths.
- Sections 2 and 3 are checked by hand in a test vault: reload the plugin
  with the sidebar open and confirm it reopens in place; drag a result into
  a note and confirm one link is inserted.
- Section 4: `src/application/__tests__/BaseViewManager.test.ts` covers the
  catch-up attach. By hand: with a note open, reload Obsidian and confirm
  the bottom panel and the sidebar show results without switching notes.

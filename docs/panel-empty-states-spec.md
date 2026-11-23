# Panel empty states

Status: implemented.

## Problem

The Similar notes panel (note footer and sidebar, both `SearchResultsContainer`)
showed "No similar notes found." whenever its list was empty. Five different
causes lead there, and for three of them (excluded note under a cloud provider,
failed embedding, vault still indexing) the line is not true. The indexing case
is the first-run impression: a new user sees "no similar notes" while the plugin
is still working.

## Behavior

Same place, same `search-empty-state` line; only the text changes. No new
controls. The line is grey except the three failure lines (`embedding-failed`,
`model-download-failed`, `model-load-failed`), which add `is-error`
(`var(--text-error)`): a confirmed failure that won't clear by itself reads red,
while fixed guidance and self-resolving states stay grey.

| Reason | When | Text |
|---|---|---|
| loading | nothing has been searched for this note yet: from the moment the plugin turns on (Obsidian start, plugin enabled or updated) until the first result for the open note arrives. Measured in a running Obsidian with the model already on disk: about 3 seconds in the sidebar | Looking for similar notes… |
| downloading | the built-in model is being downloaded (first install, or a model picked in settings that is not on disk yet) and the provider has reported progress below 100 for more than 2 seconds (`DOWNLOAD_GRACE_MS`; a model already on disk also reports 0 to 100 while it is read, about 0.6 s on desktop, and must not be called a download). A model whose ONNX weights are already in the browser cache reports no progress at all, however long the read takes: the worker checks the cache before loading (`isModelCached`), since transformers.js sends the same progress events for a cache read as for a download. No search runs. Shown for the note open at startup and for any note opened meanwhile | Downloading the model: 45%. Similar notes will appear when it's ready. (number = the status bar's source, the embedding service's download progress, rounded down the same way) |
| no-note | there is no note to show results for: no markdown editor is open, or the tab used last in the main area is not a note (canvas, PDF, image). No search runs. In practice only the sidebar shows this, since the footer panel lives under a note | Open a note and similar notes will appear here. |
| unwritten | the note has no text after exclusion patterns (`SimilarNoteFinder` status `empty-content`) | Write a few lines and similar notes will appear here. |
| excluded-cloud | excluded note with OpenAI or Gemini, ad-hoc embedding skipped (`ad-hoc-disallowed`, frontmatter-exclusion spec §2.1) | This note is excluded from the index, so it isn't sent to OpenAI. (provider name from the setting: OpenAI or Gemini) |
| embedding-failed | the on-the-fly embedding threw (`embedding-failed`; a Notice is also shown) | Couldn't analyze this note. Check the model in Settings, then reopen the note. |
| model-download-failed | the built-in model failed to load and the error is a network error (`NETWORK_ERROR_PATTERNS`: the message contains `network` or `fetch`, as a fetch that cannot reach the server says `Failed to fetch` in Chromium; the HTTP errors transformers.js throws for a missing or private model, such as `Unauthorized access to file`, do not match). `ModelLoadGate.fail` classifies; only the built-in provider's errors can be download failures. Held for every note until the next load; opening a note while it is held starts a new load (the same load that failed: plugin start, model change or GPU reload) | Couldn't download the model. Check your connection, then reopen the note. |
| model-load-failed | any other failed model load (a model name that does not exist, a cloud or Ollama provider that fails to load, a broken file). Held for every note until the next load; changing the model in Settings starts that load, so no reopen is asked for | Couldn't load the model. Check the model in Settings. |
| below-threshold | the search returned results but none reach Minimum similarity | No notes above the minimum similarity (0.50). (setting value, two decimals) |
| indexing | the search ran, returned nothing, and notes other than the open one are queued for indexing | Indexing your vault: 1,240 notes left. Results fill in as notes are indexed. (count = the status bar's "N to index" source, `NoteIndexingService.getNoteChangeCount$`; "1 note left" for one) |
| none | anything else | No similar notes found. |

Model load: from the moment a model load starts (plugin start, model change,
GPU reload) until the model and the index are usable, the panel does not
search. A search then would throw in the provider and show the red
`embedding-failed` line and a Notice for something that clears by itself. A
note opened in that window shows `downloading` once progress has stayed below 100 past the grace
period and `loading` otherwise (before that, and for the seconds between the
end of the download and the model being ready). When the load
ends the note on screen is searched and shows results if it worked. If the
load failed, the index is not opened and a search would throw, so no search
runs: the note on screen and every note opened later show the failure line for
the load, `model-download-failed` or `model-load-failed`, until the next model
load starts. The note-level `embedding-failed` line is not used for a load: a
failed load is every note's problem, and its text (check the model, reopen the
note) is wrong for a dropped connection and for a reopen that changes nothing.
After a download failure, opening a note starts the failed load again, so the
line's "reopen the note" is true. The status bar takes its
download percent from the same gate, so it shows a percent exactly when the
panel says `downloading`, with the same number. Results already on
screen when a later load starts stay. At plugin start the note that is
already open is put on the waiting line the same way (the views only take
states addressed to their own note), before the model load begins.

분할 창에서 아직 자기 노트의 모델을 받지 않은 아래 패널은 제목만 두고
상태 줄을 비운다. 활성 노트만 검색하므로 다른 창의 검색을 약속하지 않는다.
자기 노트의 대기 상태나 결과를 받으면 그때부터 표시한다. 시작 시 열린 창,
플러그인 재활성화 및 설정으로 다시 만든 패널에 같은 규칙을 적용한다.
사이드바의 초기 `loading` 표시는 유지하며, 이미 받은 결과는 그대로 둔다.

Order: `loading` is the sidebar's state before any result; the first result for
its note replaces it and it does not come back while the panel stays open
(on a note switch the sidebar keeps the previous results until the new ones
arrive). `no-note` is decided before any note is looked at. Of the rest, the
next three are searches that never ran and win; `excluded-cloud`
beats `unwritten`, so an empty excluded note under a cloud provider already
says it is excluded (writing in it would not bring results); `below-threshold`
only when results exist; `indexing` only when there are zero results (if
indexed notes already produce results during indexing, they are shown and no
indexing line appears).

While the indexing line shows, the count updates live, and the coordinator
searches again for the open note as the count drops, at most once every 10
seconds (`INDEXING_RESEARCH_INTERVAL_MS`; the clock restarts on any search of
the panel), so results fill in before the queue empties. The open
note is usually not indexed yet, so each of these searches embeds it on the
fly; 10 seconds keeps that to about six calls a minute on a long first index.
Once results show, the panel leaves the indexing state and these searches
stop. When the queue reaches zero it searches once more. This last search also
runs when the panel already shows results that were found while other notes
were still queued (a re-search here may return only a row or two of what the
finished index holds); results found while no other note was queued are not
searched again. A search still running when the queue empties is
followed by this one search as soon as it returns. Such a list is not kept as
final either: reopening the note after the queue empties searches again
instead of showing the shorter list first.

The pending count is published as soon as the startup queue is filled, before
the indexing loop starts (which waits for the model, possibly a first
download). If the panel already shows "No similar notes found." when notes
become queued (count 0 to positive), it switches to the indexing line and drops
that cached empty result, so the searches above run.

Only notes other than the open one count toward this line. The open
note's own queued edit (typing in a note with no results, then pausing) never
fills its own panel, since a note is not in its own results, so the panel keeps
"No similar notes found." instead of promising results and flickering at every
pause. The count shown is still the status bar's total. When only the open
note is left queued while the indexing line shows, the coordinator searches
once more and falls back to the plain line.

## 결과 링크 단추 설정과 상태 전환

`showLinkButton`은 다른 표시 설정과 함께 모든 모델에 전달한다. 검색 전,
모델 준비 대기, 노트 없음, 결과 도착과 설정 재발행 모두 같은 현재 값을 쓴다.
아래 패널은 자기 노트 모델을 받기 전에는 결과 영역을 숨기는 규칙을 유지한다.
결과가 없을 때 새 링크 단추를 만들지는 않으며, 결과가 도착하면 현재 설정으로 표시한다.

## Caching

`SimilarNoteCoordinator` does not cache a failed embedding (reopening retries,
as the text says), a skipped excluded-note search, or an empty search while
notes are queued.

## Not covered

- The semantic-search modal keeps its own "No similar notes found".
- The OpenAI provider pointed at an OpenAI-compatible server still says
  "OpenAI" (the URL is not inspected, same as frontmatter-exclusion spec §2.1).
- The `downloading` line was observed in a running desktop Obsidian by
  removing the model file from the cache and turning the plugin off and on:
  the note open at start, an indexed note and a never-indexed note opened
  during the download all showed it, in the sidebar and the footer, with the
  status bar's number, no Notice and no red line; when the download ended
  the panel went through "Looking for similar notes…" to the search result.
  With the model on disk, three starts showed no `downloading` state (the
  read reported progress for about 0.6 s). A cached read slowed to 5.3 s
  in a controlled run (no model request on the network) showed the
  `downloading` line and the status bar's percent from 1.9 s to 5.1 s before
  the cache check above was added. Not observed: a first install
  with an empty index and a download that fails midway.
- A first install on a fresh vault with an empty index was observed in a
  running desktop Obsidian: the download line with a percent, then the
  indexing line, then results on the open note and on the next note opened.
  A model load that fails (a model id with no repository) showed the Notice;
  before the failure line above was added, the panel stayed on "Looking for
  similar notes…" because the search after the failed load threw.
- 모바일 흉내에서는 아래 패널에 모델 내려받기 진행률 4%와 7%가 표시되는
  것을 확인했다. 사이드바 패널과 실제 휴대전화는 확인하지 못했으며,
  앱이 종료되어 검색 결과가 표시될 때까지 이어지는 동작도 확인하지 못했다.

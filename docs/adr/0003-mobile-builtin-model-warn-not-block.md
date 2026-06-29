# 3. Warn (don't block) for built-in models on mobile; defer on-device memory reduction

Date: 2026-06-29

Status: Accepted

## Context

A user reported that selecting the **built-in** (Transformers.js / onnxruntime-web)
model on a budget Android phone (Samsung A26) crashed Obsidian outright, while a
remote provider (Ollama over Tailscale) worked fine. This is a different failure
from the large-note wasm address-space overrun fixed in 1.6.0-beta.5
(ADR-adjacent: `docs/builtin-embedding-batch-cap-spec.md`). Here the ceiling is the
phone's **per-app memory budget**: the model is loaded fully on-device (in `fp32`),
and on a low-memory device that allocation makes the OS kill the whole app.

Two facts constrain any fix:

1. **A native OOM kill is uncatchable.** It is not a JS exception; a `try/catch`
   around `loadModel` cannot recover it. So the only way to "handle" it is to not
   perform the allocation.
2. **We cannot detect device capability on mobile.** `Platform.isMobileApp` tells
   us we're on a phone/tablet, but mobile gives us no RAM/CPU reading (`os` is
   desktop-only; `environmentInfo.collectSystemInfo` returns empty on mobile). A
   flagship and a budget phone are indistinguishable to us. Some users already run
   the built-in model successfully on capable phones/tablets.

The plugin already nudges *new* mobile installs to a remote provider
(`SettingsService`: `!data && Platform.isMobileApp` → default `openai`), but that
does not cover users whose settings already have built-in selected (e.g. synced
from desktop via Obsidian Sync, or chosen deliberately to test).

## Decision

**Warn, do not block.** On mobile, the Built-in model settings section renders a
visible warning that built-in models run on-device, are memory-heavy, can crash
low-memory phones, and that a remote provider is recommended. The warning sits
above the model options so it is seen before "Load & Apply". Built-in remains
fully usable for anyone who opts in.

Also: soften the `manifest.json` description (it claimed "Local models (mobile &
desktop)") to "On-device local models, or cloud APIs (recommended on mobile)", so
the listing no longer over-promises on-device on phones.

## Alternatives considered

- **Block the startup auto-load of built-in on mobile** (skip the load, show a
  notice, allow explicit opt-in). Genuinely protects the worst case (a synced
  built-in config that crashes Obsidian on every launch, before settings can even
  be opened). Rejected *for now* because it regresses users who currently run
  built-in fine on capable phones/tablets, and we cannot tell those devices apart
  from a budget phone (constraint 2). A more targeted version, a one-shot
  **crash-loop detector** (persist a "load in progress" flag before loading, clear
  it on success; on next launch skip auto-load if the flag survived = last launch
  died mid-load), would protect budget phones with zero impact on capable ones.
  Left as a follow-up if the synced-auto-load case proves to bite.
- **Reduce on-device memory with a quantized dtype (`q8`) on mobile** (~4x smaller
  than `fp32`). Rejected for now: it is an experiment with uncertain payoff (even
  if the model *loads*, on-device indexing of a full vault on a budget phone CPU is
  slow enough to be impractical, which is why the reporter's remote setup is the
  right answer anyway), and it does not remove the need to steer mobile users to
  remote. Revisit only if there's demand to make built-in viable on mid-range
  phones.

## Consequences

- Capable phones/tablets keep built-in; no regression.
- Budget-phone users get an explicit caution and a clear recommendation, but a
  determined user can still trigger the crash once by opting in (informed, one-off,
  not an every-launch loop).
- The **synced-config auto-load crash** is *not* prevented by this change. If that
  case surfaces in reports, implement the crash-loop detector above (the targeted
  guard that doesn't regress capable devices).
- Honesty: the store/listing description no longer implies on-device models are a
  good mobile default.

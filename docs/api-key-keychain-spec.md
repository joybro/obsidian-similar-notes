# API Keys in Obsidian Keychain Specification

## Status

Proposed, not implemented. Changes how API keys are stored, so it needs a
maintainer decision before implementation. The settings rows it changes need a
design check before they reach users.

## Problem

The OpenAI (and OpenAI-compatible) key and the Gemini key are saved as plain
text in `settings.openaiApiKey` / `settings.geminiApiKey`, which end up in
`.obsidian/plugins/similar-notes/data.json` inside the vault. The README says
so: a vault sync tool or backup copies that file, and the key with it.

Obsidian 1.11.4 added a Keychain (`app.secretStorage`, `SecretComponent`) for
exactly this: "The `mySetting` property will store the *name* of a secret, not
the secret value itself" (obsidian-developer-docs, Plugins/Guides/Store
secrets).

## API facts

- `app.secretStorage: SecretStorage`, `@since 1.11.4`:
  `setSecret(id, secret)`, `getSecret(id): string | null`, `listSecrets()`.
  IDs are lowercase letters, digits and dashes (the app checks
  `/^[a-z0-9-]+$/`, at most 64 characters) and `setSecret` throws otherwise.
- `SecretComponent(app, containerEl)`, `setValue(name)`, `onChange(cb)`:
  lets the user pick an existing secret or create a new one; the callback gets
  the secret's name (`string | null`).
- Secrets are shared across plugins by name ("a Google API token, or an OpenAI
  key", Obsidian 1.11.4 changelog), so a user who already saved an OpenAI key
  for another plugin can pick the same one.
- Storage (read from the Obsidian 1.15.1 app bundle, not documented): desktop
  keeps secrets in the app's per-vault local storage, encrypted with Electron
  `safeStorage` (the OS keychain); mobile has its own storage adapter. Neither
  is a file in the vault folder, so vault sync and vault backups do not copy
  the value. Not yet checked in a running app.
- Our `minAppVersion` is 1.11.0, so 1.11.0 to 1.11.3 have no
  `app.secretStorage`.

## Decision (proposed)

1. **Settings store a secret name next to the old field.** New optional fields
   `openaiApiKeySecret` and `geminiApiKeySecret` hold the Keychain name. The
   old plain fields stay readable.
2. **One resolver reads the key.** `resolveApiKey(provider)` returns
   `getSecret(name)` when a name is set and `app.secretStorage` exists,
   otherwise the old plain field. `EmbeddingService` and the "Test" buttons in
   the provider sections call only this resolver.
3. **Settings rows.** With `app.secretStorage` available, the API key row shows
   a `SecretComponent` instead of the text field. Without it (Obsidian before
   1.11.4) the row stays the current text field.
4. **No silent migration.** An existing plain key keeps working. When a plain
   key exists and the Keychain is available, the row offers a one-time
   "Move to Keychain" action: it saves the key under a default name
   (`similar-notes-openai`, `similar-notes-gemini`), stores the name, and
   clears the plain field. Undo is choosing no secret and typing the key into
   the text field again.
5. **Missing secret on a device.** If a name is set but `getSecret` returns
   null (for example `data.json` synced to a new device whose Keychain does not
   have it yet), the search failure message says the key named `<name>` is not
   in this device's Keychain, instead of the generic key error.

## Trade-off

The same fact is the benefit and the cost: the key no longer travels with the
vault, so a user who syncs a vault to a phone enters the key once on each
device. This is why migration is opt-in.

## Open questions

- Does the Keychain value really stay out of Obsidian Sync? (Check: save a
  secret in a scratch vault, then grep the vault folder for the value.)
- Mobile: does `app.secretStorage` behave the same on iOS and Android?

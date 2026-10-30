# Prompt Studio

A local-first desktop app for versioned prompt development, with hard cost gates, injection-resistant prompt assembly, and a security model I measure rather than assume.

I write an instruction, pick the assistant it's for (ChatGPT, Claude or Gemini), and Prompt Studio uses Gemini to turn it into a well-structured prompt. Every draft, comment, rule and revision is versioned locally in SQLite. Gemini is the only thing that touches the network, and it's called from the main process under a spending gate that blocks any request whose worst-case cost could break a limit.

Electron 44 · React 19 · TypeScript · Node's built-in SQLite · CodeMirror 6 · zod · `@google/genai` · vitest · Playwright

## Features

- **Versioned prompts and rules with full lineage.** Generations, revisions, restores, accepted recommendations and rule edits each create a new version. Manual edits are checkpointed before any of those run, and restoring never overwrites. Each draft records exactly which rule versions it was generated with.
- **Preserve vs Challenge modes.**
  - *Preserve Intent* improves clarity and structure without changing the objective, scope or constraints.
  - *Challenge & Redesign* keeps the prompt faithful but returns proposed changes as separate recommendations. I accept or reject each one, and an accepted one becomes its own version.
- **Selection-level revise.** I can highlight a passage and revise only that, or comment on passages and revise the whole prompt against the comments.
- **Side-by-side compare.** Word-level diff between any two versions.
- **Protected rules the model can't weaken.** The Instruction Library holds global, project and target-AI rules. Protected rules are sent to the model as context, but the app itself appends them word-for-word after the model's output. At approval, it records any protected rule that a manual edit removed.
- **Worst-case cost gating** with a per-request limit and a monthly allowance. See [Cost control](#cost-control).
- **Offline mock optimizer.** Until a Gemini key is configured, a deterministic mock runs the whole workflow at $0 with no network.
- **Project separation.** Project rules and read-only project folders apply only to their own project. Excerpts from project files are shown for review before anything is sent, and files containing credentials are blocked.

## Security

The design assumption is that anything the renderer displays (model output, pasted text, project excerpts) may be hostile.

- **Sandboxed renderer** with `contextIsolation`, no Node integration, no webviews, no new windows, and navigation locked to the app's own `app://` origin.
- **Content Security Policy** on that origin: `default-src 'self'`, `connect-src 'self'`, no objects, frames or form targets.
- **Renderer network blocked.** A session-level request filter cancels every request that isn't a bundled `app://` file, and all browser permission requests are denied.
- **Allow-listed IPC.** The preload exposes a single `invoke` over a fixed channel list. The main process checks that the sender is the main window on the app origin, and validates every payload with a zod schema before acting.
- **DPAPI-encrypted API key.** The Gemini key is stored with Electron `safeStorage` (Windows DPAPI, bound to the Windows user). It's decrypted only in the main process; the window only learns whether a key exists. It's scrubbed from logs and exports and is not in backups.
- **Credential scanning before send.** Prompt text, comments, rules and project excerpts are scanned for API keys, tokens, private keys and connection strings, and generation is blocked if any are found.
- **Injection-resistant assembly.** Project excerpts are wrapped in `<reference_material untrusted="true">`, and the system instruction tells the model to use them only as facts and ignore any instructions inside them. Protected rules don't depend on the model obeying, because the app appends them.
- **Measured, not assumed.**
  - Settings shows a security report taken from the live window: whether `require`/`process` exist, which bridge keys are exposed, and the actual sandbox and isolation state.
  - `npm run verify-security` inspects the installed build: Electron fuses (RunAsNode, NODE_OPTIONS and `--inspect` off; asar-only and cookie encryption on), no sources, maps, `node_modules` or key files in `app.asar`, no embedded API keys, and a byte-for-byte match between the installed files and the current build.

**Why the renderer blocks all network instead of allow-listing Google:** the renderer never needs the network, because every Gemini call runs in the main process where the key lives. An allow-list for Google domains would still leave a path to exfiltrate prompts to any Google-hosted endpoint, while blocking everything leaves nothing to leak through.

## Cost control

Gemini bills after the fact, and I can't know in advance how many tokens a response will use. So every billable call is gated on its **worst case** before it starts (`src/core/budget.ts`):

1. **Input** is estimated at 3 characters per token. That's deliberately pessimistic; English text averages about 4.
2. **Output** is assumed to use every allowed token. Gemini's `maxOutputTokens` caps thinking and visible output combined, so it bounds both.
3. **Price** is looked up from a dated price table for the model in effect on that day. A model with no price entry can't be used for billable calls at all.
4. `gateBillableCall(status, worstCase, perRequestLimit)` blocks the call when any of these is true:
   - the worst case exceeds the per-request limit;
   - the monthly allowance is used up;
   - spent-so-far plus the worst case would exceed the allowance.

Gating on the worst case means the limits hold even if every call maxes out, which an average-cost estimate can't promise. The gate runs twice: once when the request is previewed, and again at the moment of sending. After the call, the app records Google's reported usage; if Google reports none, it records the worst case and marks it estimated. Automatic retries are off by default, because each retry is another billable call. Raising the monthly allowance requires a native confirmation dialog, so the renderer can't do it silently.

## Development

```
npm install          # project-local dependencies only
npm run typecheck
npm test             # unit tests (vitest): 43 tests
npm run e2e          # builds, then drives the real app through the full workflow in a temp folder (48 checks)
npm run package      # builds, packages, flips Electron fuses, installs to <home>\app
npm run verify-security
powershell -File scripts/install-shortcut.ps1
```

`npm test` runs with outbound network disabled and needs no API key. `tests/e2e/verify-real-data.mjs` runs 14 checks against a copy of a real database.

`src/core` is pure TypeScript (prompt assembly, rules, budget, secret detection) with no Electron, filesystem or network dependencies. The main process (`src/main`) owns the database, credentials, project file access and the Gemini client. The renderer (`src/renderer`) is React and talks to the main process only through the IPC bridge.

QA records: [docs/QA-REPORT-v1.md](docs/QA-REPORT-v1.md) and [docs/live-gemini-test-2026-10-27.md](docs/live-gemini-test-2026-10-27.md). Gemini setup: [docs/gemini-setup.md](docs/gemini-setup.md).

## Folder layout

All application state lives under one base directory, `<home>`: `PROMPTSTUDIO_HOME` if set, otherwise `%LOCALAPPDATA%\PromptStudio`. Packaging installs to `<home>\app` unless `PROMPTSTUDIO_INSTALL_DIR` is set. The app, the packaging scripts and the shortcut script all resolve these the same way (`src/main/paths.ts`, `scripts/home.mjs`). Set the variable as a persistent user environment variable so the installed app, launched from its shortcut, sees it too.

```
<home>\
  app\       installed build (the shortcut points here; replaced on each install)
  data\      promptstudio.db (SQLite), secrets\ (DPAPI-encrypted key), electron\ (Chromium cache)
  backups\   automatic daily snapshot + manual backups (never deleted by the app)
  exports\   exported prompts and library
  logs\      metadata-only logs, secrets redacted
```

## Recovery

Close the app. Move `promptstudio.db`, `promptstudio.db-wal` and `promptstudio.db-shm` from `<home>\data` into a safe folder (so nothing is lost). Copy the chosen file from `<home>\backups` into `<home>\data` as `promptstudio.db`, and start the app. The API key isn't in backups; re-enter it in Settings if needed.

## Known limitations

- **Windows only.** Key storage relies on DPAPI through `safeStorage`, and the install and shortcut scripts are PowerShell.
- **Gemini is the only optimizer today.** The provider interface supports others; only Gemini and the offline mock are implemented.
- **No remote sync.** Everything is local; backups are snapshots in `<home>\backups` plus manual copies.
- The build is unsigned, and the price table is maintained by hand.
- Node's built-in SQLite is still marked experimental.

## License

[MIT](LICENSE) © 2026 Levi Stoddard

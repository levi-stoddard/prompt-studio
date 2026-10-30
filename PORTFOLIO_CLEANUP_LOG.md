# Portfolio cleanup log

Private names and local paths are described generically here; the detailed copy is kept outside git.

All work is on branch `portfolio-cleanup`; `main` is untouched.

## Phase 2A — Baseline (2026-10-30)

| Item | Result |
|---|---|
| Backup | `source_backup_2026-10-30\` (next to the repository) holds 251 files, including `.git`, and excludes `node_modules`, `out`, `dist`. |
| `npm run typecheck` | Pass (exit 0) |
| `npm test` (vitest 5.0.4, Node 24.14.0) | **40 passed / 40**, 2 files. A Vite config-loader warning and a Node SQLite experimental warning are pre-existing and not failures. |
| `npm run package`, `npm run e2e` | Not run |
| Secret scan of the committed tree (`git archive HEAD`) | No keys or tokens. One hit, in `tests/unit/core.test.ts:96`, is a deliberate fake connection string used by the secret-detector test. |

### `.gitignore` (current contents)

`node_modules/`, `dist/`, `out/`, `*.log`, `*.db`, `*.db-*`, `*.dpapi`, `.env`, `.env.*`, `tests/e2e/.tmp/`, `coverage/`

- Present: `node_modules`, `out`, `dist`, key material (`*.dpapi`, `.env*`), databases.
- Missing: `*.map` (no map files are tracked; the build output folders are already ignored) and `docs/private/`. Both are to be added in Phase 2B.
- No untracked, non-ignored files.

### Term and path hit list

The per-file list is in the chat hand-off for Phase 2A. Totals across tracked files:

| Term | Hits |
|---|---|
| The role word named in rule 7 (any case) | 18 |
| Private project name 1 | 27 |
| Private project name 2 | 1 |
| Author surname | 1 (`package.json` author, kept per instruction 2B.7) |
| Windows username | 1 (`docs/acceptance/e2e-results.json:39`, a temp path) |
| Drive-letter base path (either slash style) | 21 |

Ignored build output in `dist/` also contains hits (compiled source); it is not tracked.

### Notes for Phase 2B

- `src/main/paths.ts` already supports a `PROMPTSTUDIO_HOME` override, but the default is hardcoded to a drive-letter path. The installed app is launched without that variable. Changing the default would therefore point a repackaged app at a new, empty data folder unless the legacy location is detected.
- All three existing commits are authored with a personal name and email and already contain the private architecture note and the private terms. Moving files in 2B fixes the current tree, not history.
- The 12 screenshots in `docs/acceptance/screens/` need a visual check for paths and personal data.

## Phase 2B — Remove internal voice and jargon (2026-10-30)

| File | Change | Why |
|---|---|---|
| `src/core/assemble.ts` | Prompt text: the role word replaced with "the user" in two places, and the security line now ends "Never weaken security restrictions or the user's approved rules." All other instructions verbatim. | 2B.1 |
| `src/core/rules.ts` | Binding heading and XML note: the role word -> "user-approved". `bindingBlockIndex` now matches the stable prefix `## Binding constraints (` instead of the full heading. | This is prompt text too. The prefix match keeps drafts already saved with the old heading working: recommendations are still inserted above their binding block. |
| `tests/unit/core.test.ts` | New test: a binding block saved under an earlier heading wording is still found | Covers the prefix match. No existing test asserted on the old wording, so none needed updating. |
| `src/core/starterRules.ts` | Comment and the protected starter rule: the role word replaced with "User"/"user" in its title and body ("User approval before protected changes", "explicit user approval"). Same scope, protection and semantics. | 2B.2. Starter rules are seeded only into a new database, so an existing library keeps its current rule text. |
| `src/main/projectFs.ts`, `src/core/types.ts`, `tests/e2e/run-e2e.mjs` | Comments: role word -> "user"; removed the pointer to the private architecture note | 2B.2 |
| `src/renderer/components/Settings.tsx` | UI hint: removed the private project name (now "separate from other tools") | Rule 7 |
| `docs/gemini-setup.md` | Removed the private project name from the isolation sentence | Rule 7 |
| Private architecture note -> `docs/private/` | `git mv`, then `git rm --cached`; the file stays on disk, untracked and gitignored | 2B.6. The README no longer links it. |
| `.gitignore` | Added `*.map` and `docs/private/` | 2A.3, 2B.4 |
| `docs/private/README.legacy.md` | Copy of the old README | 2B.4 |
| `README.md` | Rewritten in first person: one-line description, features, security (including why the renderer blocks all network), cost control (`gateBillableCall`, worst case), development and test counts, layout relative to `<home>`, recovery, known limitations, license TODO; no drive paths or private project names | 2B.4 |
| `docs/ACCEPTANCE.md` -> `docs/QA-REPORT-v1.md` | `git mv`; first-person voice; drive paths replaced with `<home>`; "no paid API costs were authorized" reworded. Facts, numbers and results unchanged. | 2B.5 |
| `docs/live-gemini-test-2026-10-27.md` | "Authorization:" -> "Scope I set for this test:"; third-person references to me replaced with first person ("done by me", "my spot-check"). Results unchanged. | 2B.5 |
| `docs/acceptance/e2e-results.json` | Windows username in one temp path replaced with `user` | No personal identifiers. `npm run e2e` rewrites this file on each run. |
| `package.json` | `description` replaced with the one-line description; `author` kept | 2B.7 |

Typecheck: clean. `npm test`: **43 passed** (40 existing + 3 new: one for the heading prefix match, two for the base directory).

### Hardcoded paths (2B.3, approved and applied)

| File | Change | Why |
|---|---|---|
| `src/main/paths.ts` | `DEFAULT_HOME` constant replaced by `defaultHome()` = `%LOCALAPPDATA%\PromptStudio`. `PROMPTSTUDIO_HOME` still overrides it. | Remove the personal drive path; the default is now the user's app-data folder |
| `scripts/home.mjs` | New. Shared `home` / `installDir` resolution for the scripts, the same rule as `paths.ts` | One definition for the Node scripts |
| `scripts/package.mjs`, `scripts/verify-security.mjs` | Install dir from `home.mjs`: `PROMPTSTUDIO_INSTALL_DIR`, else `<home>pp`. Comments no longer name a drive. | Same default and override behavior, now configurable |
| `scripts/install-shortcut.ps1` | Exe and working directory resolved the same way, in PowerShell | It was fully hardcoded |
| `tests/e2e/verify-real-data.mjs` | Default real DB is `<home>\data\promptstudio.db`; `PROMPTSTUDIO_REAL_DB` still overrides it | Same |
| `tests/unit/services.test.ts` | Two tests: the default home sits under `LOCALAPPDATA`, and every path stays under the chosen home | Cover the new default |
| `README.md` | The folder layout states the default and the override | Accuracy |

With `PROMPTSTUDIO_HOME` set to the previous base directory, every path (data, backups, install dir, shortcut target, real-data DB) resolves exactly as before. Without it, a newly packaged app uses `%LOCALAPPDATA%\PromptStudio`. The currently installed app is unchanged until the next `npm run package`.

The drafted diff was shown for review before it was applied. It is kept as `docs/private/paths-change.patch` (gitignored).

### Regenerated QA screenshots (approved)

| File | Change | Why |
|---|---|---|
| `docs/acceptance/screens/01-12*.png`, `docs/acceptance/e2e-results.json` | Regenerated by `npm run e2e`, run with `TEMP`/`TMP` set to `C:	mp` | The old screenshots showed the Windows username in the status bar, and two showed the old starter-rule title. The new ones show a neutral temp path and "User approval before protected changes". |

`npm run e2e` result: **48/48 checks passed**. The run was offline (mock optimizer, network blocked) with a throwaway data folder; it did not touch the installed app or any real data. I checked the Library, Review, Secret-blocked, Approved and Settings screens visually. The only key visible is the deliberately fake `AIzaQQQ…` fixture used to test credential blocking.

## Phase 2C — Hand-off (2026-10-30)

| Item | Result |
|---|---|
| `npm run package` | **Not run.** The installed app's files are all dated 2026-10-27 (before this cleanup), so the installed build does not contain these changes yet. |
| `npm run verify-security` | Not run. `npm run e2e` rebuilt `dist/`, so the byte-for-byte check against the old install would now fail until the next `npm run package`. That is expected. |
| `main` | Untouched; all cleanup commits are on `portfolio-cleanup` |
| Push / remote | None. The commands are in the hand-off for me to run. |
| History | The three commits before this cleanup still contain the role word, the private project names, the old drive path and the Windows username. A public push of `main` publishes them unless history is rebuilt. |

## Clean-history `public` branch (2026-10-30, approved)

I built a new branch, `public`, for the GitHub push. It has fresh history and nothing was rewritten: `main` (2af085d) and `portfolio-cleanup` (c2f21c5) are unchanged.

| Commit | Content |
|---|---|
| 1 | The full `portfolio-cleanup` tree minus `docs/acceptance/` |
| 2 | Adds `docs/acceptance/` (regenerated e2e results and screenshots). The tree is identical to `portfolio-cleanup`. |
| 3 | This log entry |

I scanned every commit on `public`: no role word, private project names, old drive path or Windows username. The only match is the `package.json` author (kept per 2B.7). The earlier commit hashes mentioned in this log refer to the local `portfolio-cleanup` branch, which is not pushed.

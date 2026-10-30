# Prompt Studio v1 — QA report (2026-10-27)

Paths below are relative to the app's base directory (`<home>`; see the README).

## Final status — corrected build (build fingerprint 079eec5dd4f0f6c1)

**Accepted for everyday use.** I verified the following after installing the corrected build, without any paid Gemini call:

| Check | Result |
|---|---|
| Installed files byte-identical to the tested build (all 5 built files) | Pass. Now enforced automatically: `npm run package` rebuilds, installs, then fails the install if verification fails |
| $0.10 per-request limit active | Pass: a normal request with a worst case of $0.032 was allowed; a $0.124 request was refused before sending |
| Automatic paid retries disabled | Pass (`autoRetry = false`; a unit test confirms a failed request is sent exactly once) |
| Selected model gemini-3.8-flash | Pass |
| $20 monthly allowance enforced | Pass: blocked with $0.005 remaining; the indicator shows the critical level |
| Desktop shortcut launches the corrected install | Pass: launches `<home>\app\Prompt Studio.exe`, whose files match the build |
| Data persists across restart (prompts, versions, rules, spend, settings) | Pass: identical before and after two shortcut launches |
| No network requests during checks | Pass: 0 requests; tests now run with network disabled |
| Existing data preserved | Pass; I took a snapshot `backups\pre-install-2026-10-27T09-19-15.db` first |
| Regression | 40/40 unit · 48/48 end-to-end · 14/14 real-data-copy checks |

Live Gemini result (from earlier the same day): one successful gemini-3.8-flash generation, $0.0047, structured response valid, protected rules intact. See [`live-gemini-test-2026-10-27.md`](live-gemini-test-2026-10-27.md).

Disclosure: during the first post-install regression run, the automated budget test (which used a fake key) let one request through. gemini-3.8-flash's worst case ($0.032) was below the $0.05 the test left. That request most likely reached Google and was rejected for the invalid key; a key that doesn't exist can't be billed. The test now leaves only $0.001, so it blocks for every model, and all automated tests run with outbound network disabled.

---

## Original v1 QA pass (before the live test)

## Summary

I built Prompt Studio v1, installed it at `<home>\app`, and launched it from the **Prompt Studio** desktop shortcut. The full workflow works end to end with the offline mock optimizer. Real Gemini generation was implemented but **not yet run against Google**: I didn't have a paid key yet and hadn't committed to any paid API spend.

| Verification | Result |
|---|---|
| TypeScript typecheck | clean |
| Unit tests (vitest) | 38 / 38 passed |
| End-to-end workflow in the real app (Playwright, isolated temp data folder) | 48 / 48 checks passed (`acceptance/e2e-results.json`) |
| Packaged-build security checks (`npm run verify-security`) | all passed |
| Desktop shortcut | Opening the shortcut via the Windows shell starts the installed app with its window and no console |
| Visual double-click of the desktop icon | **Not done**: the screen was locked during the session |

## Definition of success — status

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Double-click a desktop shortcut | Works (shell-verified; visual double-click pending) | `Desktop\Prompt Studio.lnk` → `<home>\app\Prompt Studio.exe` |
| 2 | Type an ordinary instruction | Works | screens/03-composer.png |
| 3 | Select ChatGPT, Claude or Gemini | Works; custom targets can be added | Library → Target AI profiles |
| 4 | Select Preserve Intent / Challenge & Redesign, visible before generation | Works | composer + session header |
| 5 | Generate an improved prompt with Gemini | Works with the offline mock; the Gemini path is implemented and unit-tested with a simulated client; **live call not yet made** | needs a paid API key |
| 6 | Edit the result and add comments | Works (autosave, highlighted comments) | screens/05-comment.png |
| 7 | Request revisions (whole or selected passage) | Works | e2e checks |
| 8 | Compare and restore previous drafts | Works (word-level side-by-side; restore = new version) | screens/06-compare.png |
| 9 | Apply saved permanent instructions automatically | Works (Global, Project, Target-AI; protected rules appended verbatim; per-draft audit) | Rules / Insights tabs |
| 10 | Approve and copy the final prompt | Works (copy, export, open assistant start page) | screens/10-approved.png |
| — | History persists across restarts | Works (restart test) | `<home>\data\promptstudio.db` |
| — | $20 monthly allowance | Enforced and tested: warnings at 75%/90%, block before sending, no network when blocked, raising it needs a native confirmation | screens/12-budget-blocked.png |
| — | Project separation & read-only folders | Works: folders are usable only by their own project; no write APIs; .git/.env/keys blocked; excerpts reviewed before sending; files with credentials blocked | screens/08, 09 |

## Security (verified)

- In the live window: sandbox on, context isolation on, no `require`/`process`, the bridge exposes only `invoke` over 40 allow-listed channels, unknown channels refused, renderer network requests blocked, `app://` origin with CSP.
- The main process validates every IPC payload (zod) and the sender frame, and denies all permission requests, new windows, navigation and webviews.
- Packaged build, Electron fuses:
  - off: RunAsNode, NODE_OPTIONS, `--inspect`, file:// privileges;
  - on: cookie encryption, only-load-from-asar, asar integrity validation.

  No node_modules, sources, maps, keys or `.env` in the package. DevTools disabled.
- API key: DPAPI-encrypted (`safeStorage`), never returned to the window, scrubbed from logs/exports; not in backups or git.
- I upgraded Electron from 44.7.0 to **44.9.3** to fix advisory GHSA-jr5w-w6x2-84p9; `npm audit`: 0 vulnerabilities.

## Incomplete or limited

1. **No live Gemini call yet.** It needs a paid key (see `gemini-setup.md`). The first real generation will also be the first check that Google's structured-output response matches the expected schema for the chosen model.
2. **Visual double-click test pending** (screen locked). Shell launch of the same shortcut is verified.
3. Install size is about **324 MB**, of which the Electron 44 runtime is ~235 MB. Going lighter would mean a different framework.
4. The app is unsigned (built locally). Windows doesn't warn for locally built files, but would if the folder were copied from the internet.
5. Project file selection is manual (tick files); automatic relevance ranking is a later feature.
6. Mock output is a fixed template. It proves the workflow, not prompt quality.
7. Prices are a local table verified on 2026-10-27; they must be updated by hand if Google changes them.

## Open items I tracked at the time

1. Create the dedicated paid Gemini project, spend cap and API key (`gemini-setup.md`), enter the key in Settings, switch the engine to Gemini, and choose a model.
2. Double-click the desktop icon once to complete the visual check.
3. Optional later: choose a second physical backup destination (Settings → "Save a backup copy elsewhere…" already works manually).

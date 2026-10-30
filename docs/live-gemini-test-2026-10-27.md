# Live Gemini test — 2026-10-27

Scope I set for this test: one real Gemini generation, ≤ $0.10, no automatic paid retries, nonconfidential prompt only.

## Setup (done by me)

- Dedicated Google AI Studio project "Prompt Studio Personal" with paid billing and a $20 monthly project spend cap.
- API key created in that project and saved in Prompt Studio (DPAPI-encrypted; never shown or logged).
- Engine: Google Gemini. Output limit 8,192 tokens.

## Prompt sent

Nonconfidential example (no project files, customer data or personal documents):

> Write a prompt asking for a 3-day itinerary for a first-time visitor to Washington, D.C., on a moderate budget, with one museum per day, walking and public transit tips, and a short packing list for October weather.

Target: ChatGPT · Mode: Preserve Intent · Rules applied: 6 global (2 protected) · Request size: 3,701 characters.

## Results (from the app's own records)

| # | Time (UTC) | Model | Result | Tokens (in / out / thinking) | Cost |
|---|---|---|---|---|---|
| 1 | 15:12:27 | gemini-2.5-pro | Error: model not available to this key (HTTP 404) | none reported | $0.00 |
| 2 | 15:12:57 | gemini-2.5-pro | Error: model not available to this key (HTTP 404) | none reported | $0.00 |
| 3 | 15:13:25 | **gemini-3.8-flash** | **Success** | 715 / 906 / 213 | **$0.0047** |

Total recorded spend: **$0.0047** of the $20.00 monthly allowance. Google rejected requests 1 and 2
before any generation (model not found), so no tokens were reported and nothing was charged as far as
the app can see; the AI Studio Spend page is the place to confirm that. No automatic retries occurred.

## Verification of the successful generation

| Check | Result |
|---|---|
| Gemini returned the expected structured (JSON) response and it validated | Pass: 4 change notes, 2 open questions, 0 conflicts |
| Editable draft created as a new version (v2); original kept unchanged (v1) | Pass |
| Target formatting (ChatGPT, Markdown headings) | Pass: Role / Goal / Context / … headings |
| Both protected rules present word-for-word in the draft | Pass |
| Rules applied recorded with versions | Pass: 6 rules |
| Transmission logged (what was sent) | Pass: one entry, 3,701 chars |
| Cost recorded from Google-reported usage (not estimated) | Pass |
| Editing, version history, compare and restore | Already verified by the automated tests (no Gemini cost); my manual spot-check pending after reinstall |

## Issues found

1. **gemini-2.5-pro is not available to this key.** I changed the default model to gemini-3.8-flash; the error message now points to "Load my available models".
2. **The installed build was stale during this test.** The earlier reinstall packaged the previous build, so the $0.10 per-request limit and retries-off setting were not yet active in the installed app. Impact: none in practice. The successful call cost $0.0047, its worst case was $0.093 (≤ $0.10), and the 404 errors are never retried. Fixed: packaging now always rebuilds first, and `verify-security` checks that the installed files match the current build.
3. The test used Preserve Intent, so Gemini's live **recommendations** output (Challenge & Redesign) hasn't been exercised against Google yet; automated tests cover it with simulated responses.

## Status

**Pass.** Live Gemini generation works end to end with the dedicated paid key. Pending: reinstall of the corrected build, and my free spot-check of edit/history/restore.

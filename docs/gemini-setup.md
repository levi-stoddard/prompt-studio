# Connecting Prompt Studio to paid Gemini

Prompt Studio works fully offline with its built-in mock optimizer. To use real Gemini
optimization, set up a dedicated paid Gemini API project. Prompt Studio does not touch your
Google account or billing; these steps are yours to perform.

Verified against Google's documentation on 2026-10-27:
[billing](https://ai.google.dev/gemini-api/docs/billing) · [pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Why paid tier

On Google's pricing page, free-tier content for most text models **is used to improve Google
products**; paid-tier content **is not**. Because Prompt Studio may send excerpts of your project
files (always after you review them), use a paid-tier project.

## Steps

1. Open [Google AI Studio](https://aistudio.google.com/) signed in to the Google account you want to bill.
2. Create a **new project** just for Prompt Studio (for example "Prompt Studio — personal"). Keeping it
   separate isolates its usage and spend from Gemini CLI and anything else.
3. In the project list, choose **Set up billing** for that project: select or create a Cloud Billing
   account, confirm details and payment method, then **prepay credits** (Google's minimum is $5;
   some accounts are offered postpay instead).
4. Open the project's **Spend** page and set a **monthly spend cap** (for example $20). Google describes
   this cap as experimental and warns that usage can exceed it slightly, because billing data can take
   about 10 minutes to process. If prepaid credit runs out, requests fail with HTTP 402.
5. Create an **API key** in that project (AI Studio → API keys).
6. In Prompt Studio: **Settings → Gemini API key**, paste the key, **Save key**. It is encrypted with
   Windows DPAPI for your Windows account and never shown again. Do not paste it into any chat.
7. Click **Load my available models**, pick a model that has a price entry (no ⚠), then **Use model**.
8. Under **Optimizer engine**, choose **Google Gemini**.
9. Generate one short prompt and check **Settings → Monthly Gemini allowance** shows a small recorded cost.

## Costs to expect

Prompt Studio blocks any request whose *worst-case* cost (all allowed output and thinking tokens used)
would exceed what is left of the $20 allowance. Typical real costs per generation are well below
the worst case. With rates verified on 2026-10-27, a typical generation (≈5k input, ≈4k output+thinking tokens):

| Model | Approx. cost per generation |
|---|---|
| gemini-2.5-pro | ~$0.05 |
| gemini-3.1-pro-preview | ~$0.06 |
| gemini-4-argon | ~$0.05 now; rates double on 2026-12-01 |
| gemini-3.6-flash / 3.8-flash | ~$0.02 (rates double on 2027-01-01) |
| gemini-2.5-flash | ~$0.01 |

The app applies scheduled price changes automatically on their effective dates (see Settings → Prices).

## Limits of the app-level allowance

The $20 allowance is enforced by Prompt Studio only for Prompt Studio's own requests. It is **not**
an absolute ceiling on your Google bill: Google reports usage with a delay, other tools using the same
key or project are not counted, and prices can change. The Google-side spend cap in step 4 is the backstop.

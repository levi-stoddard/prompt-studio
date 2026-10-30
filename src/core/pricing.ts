export interface PriceEntry {
  model: string;
  /** First local date (YYYY-MM-DD) this price applies. */
  effectiveFrom: string;
  inputPerM: number;
  /** Output price; Google bills thinking tokens at the output rate. */
  outputPerM: number;
  longThreshold?: number;
  inputPerMLong?: number;
  outputPerMLong?: number;
}

export const PRICES_VERIFIED_ON = '2026-10-27';
export const PRICES_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing';

// Paid-tier standard rates (USD per 1M tokens) for text models, as published on PRICES_SOURCE.
// Editable in Settings. A model without a price entry cannot be used for billable generation.
export const DEFAULT_PRICES: PriceEntry[] = [
  { model: 'gemini-4-argon', effectiveFrom: '2000-01-01', inputPerM: 2.0, outputPerM: 10.0 },
  { model: 'gemini-4-argon', effectiveFrom: '2026-12-01', inputPerM: 4.0, outputPerM: 20.0 },
  { model: 'gemini-3.8-flash', effectiveFrom: '2000-01-01', inputPerM: 0.75, outputPerM: 3.75 },
  { model: 'gemini-3.8-flash', effectiveFrom: '2027-01-01', inputPerM: 1.5, outputPerM: 7.5 },
  { model: 'gemini-3.6-flash', effectiveFrom: '2000-01-01', inputPerM: 0.75, outputPerM: 3.75 },
  { model: 'gemini-3.6-flash', effectiveFrom: '2027-01-01', inputPerM: 1.5, outputPerM: 7.5 },
  { model: 'gemini-3.5-flash-lite', effectiveFrom: '2000-01-01', inputPerM: 0.3, outputPerM: 2.5 },
  { model: 'gemini-3.1-flash-lite', effectiveFrom: '2000-01-01', inputPerM: 0.25, outputPerM: 1.5 },
  { model: 'gemini-3.1-pro-preview', effectiveFrom: '2000-01-01', inputPerM: 2.0, outputPerM: 12.0, longThreshold: 200_000, inputPerMLong: 4.0, outputPerMLong: 18.0 },
  { model: 'gemini-3-flash-preview', effectiveFrom: '2000-01-01', inputPerM: 0.5, outputPerM: 3.0 },
  { model: 'gemini-2.5-pro', effectiveFrom: '2000-01-01', inputPerM: 1.25, outputPerM: 10.0, longThreshold: 200_000, inputPerMLong: 2.5, outputPerMLong: 15.0 },
  { model: 'gemini-2.5-flash', effectiveFrom: '2000-01-01', inputPerM: 0.3, outputPerM: 2.5 },
  { model: 'gemini-2.5-flash-lite', effectiveFrom: '2000-01-01', inputPerM: 0.1, outputPerM: 0.4 },
];

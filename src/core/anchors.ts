/** Find a comment's quoted passage in a (possibly edited) text, preferring the occurrence nearest its original position. */
export function reanchor(text: string, quote: string, hint: number): { start: number; end: number } | null {
  if (!quote) return null;
  let best = -1;
  let from = 0;
  for (;;) {
    const i = text.indexOf(quote, from);
    if (i < 0) break;
    if (best < 0 || Math.abs(i - hint) < Math.abs(best - hint)) best = i;
    from = i + 1;
  }
  return best < 0 ? null : { start: best, end: best + quote.length };
}

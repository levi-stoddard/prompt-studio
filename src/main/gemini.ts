import { GoogleGenAI } from '@google/genai';
import { GENERATE_JSON_SCHEMA, REVISE_JSON_SCHEMA, parseGenerate, parseRevise } from '../core/schema';
import { ProviderError, type GenerateRequest, type LlmProvider, type PromptPayload, type ProviderResult, type ReviseRequest, type Usage } from '../core/types';

export interface GeminiConfig {
  maxOutputTokens: number;
  temperature: number;
  /** Automatic retries for rate-limit/unavailable errors (0 = never repeat a request). */
  retries?: number;
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mapError(e: any): ProviderError {
  if (e instanceof ProviderError) return e;
  const status: number | undefined = typeof e?.status === 'number' ? e.status : undefined;
  const msg = String(e?.message ?? e);
  if (status === 400) return new ProviderError(`Gemini rejected the request: ${msg.slice(0, 300)}`, 'bad_request', false);
  if (status === 401 || status === 403) return new ProviderError('Gemini rejected the API key (not authorized). Check the key in Settings.', 'auth', false);
  if (status === 402) return new ProviderError('Gemini reports that the prepaid balance for this project is used up (HTTP 402). Add credits in Google AI Studio.', 'quota', false);
  if (status === 404) return new ProviderError('The selected Gemini model is not available to this key. In Settings, click "Load my available models" and choose one from the list.', 'model', false);
  if (status === 429) return new ProviderError('Gemini rate limit or quota reached (HTTP 429). Wait a minute and try again.', 'rate_limit', true);
  if (status !== undefined && status >= 500) return new ProviderError(`Gemini is temporarily unavailable (HTTP ${status}).`, 'unavailable', true);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout|aborted/i.test(msg)) return new ProviderError('Could not reach Gemini (network problem or timeout). Your work is saved; try again when online.', 'network', true);
  return new ProviderError(`Gemini request failed: ${msg.slice(0, 300)}`, 'unknown', false);
}

export class GeminiProvider implements LlmProvider {
  id = 'gemini' as const;

  constructor(
    private readonly apiKey: string,
    private readonly cfg: GeminiConfig,
    private readonly client: Pick<GoogleGenAI, 'models'> = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000 } }),
    private readonly sleep: Sleep = realSleep,
  ) {}

  private async call(payload: PromptPayload, schema: object, model: string): Promise<{ text: string; usage: Usage | null }> {
    const delays = [2000, 6000].slice(0, this.cfg.retries ?? 0);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.client.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: payload.user }] }],
          config: {
            systemInstruction: payload.system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            maxOutputTokens: this.cfg.maxOutputTokens,
            temperature: this.cfg.temperature,
          },
        });
        const um = res.usageMetadata;
        const usage: Usage | null = um ? { inputTokens: um.promptTokenCount ?? 0, outputTokens: um.candidatesTokenCount ?? 0, thinkingTokens: um.thoughtsTokenCount ?? 0 } : null;
        const finish = String(res.candidates?.[0]?.finishReason ?? '');
        if (finish === 'MAX_TOKENS') throw new ProviderError('Gemini stopped before finishing (output limit reached). Try again or raise the output limit in Settings.', 'truncated', false, usage);
        const text = res.text;
        if (!text) throw new ProviderError(`Gemini returned no content${finish ? ` (finish reason: ${finish})` : ''}.`, 'malformed', false, usage);
        return { text, usage };
      } catch (e) {
        const pe = mapError(e);
        if (pe.retryable && attempt < delays.length) {
          await this.sleep(delays[attempt]);
          continue;
        }
        throw pe;
      }
    }
  }

  async generate(_req: GenerateRequest, payload: PromptPayload, model: string): Promise<ProviderResult<ReturnType<typeof parseGenerate>>> {
    const { text, usage } = await this.call(payload, GENERATE_JSON_SCHEMA, model);
    try {
      return { data: parseGenerate(text), usage, model };
    } catch {
      throw new ProviderError('Gemini returned a response in an unexpected format. Nothing was changed; try again.', 'malformed', false, usage);
    }
  }

  async revise(_req: ReviseRequest, payload: PromptPayload, model: string): Promise<ProviderResult<ReturnType<typeof parseRevise>>> {
    const { text, usage } = await this.call(payload, REVISE_JSON_SCHEMA, model);
    try {
      return { data: parseRevise(text), usage, model };
    } catch {
      throw new ProviderError('Gemini returned a response in an unexpected format. Nothing was changed; try again.', 'malformed', false, usage);
    }
  }
}

/** Lists models usable for text generation. Listing models is not billed. */
export async function listGeminiModels(apiKey: string): Promise<{ id: string; displayName: string }[]> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 30_000 } });
  const out: { id: string; displayName: string }[] = [];
  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      const actions = (m as any).supportedActions ?? (m as any).supportedGenerationMethods ?? [];
      if (m.name && (actions.length === 0 || actions.includes('generateContent'))) out.push({ id: m.name.replace(/^models\//, ''), displayName: m.displayName ?? m.name });
    }
  } catch (e) {
    throw mapError(e);
  }
  return out.filter((m) => m.id.startsWith('gemini')).sort((a, b) => a.id.localeCompare(b.id));
}

import { TranslationError } from '../types.js';
import type { TranslateRequest, TranslationProvider, ValidateResult } from '../types.js';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

const mapLang = (lang: string | undefined): string => {
  if (!lang) return 'auto';
  const lc = lang.toLowerCase();
  if (lc === 'auto') return 'auto';
  // DeepL-style codes ("ZH", "EN-US") → Google two-letter
  if (lc.startsWith('zh')) return 'zh-CN';
  return lc.split('-')[0];
};

const translateOne = async (
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<string> => {
  const url = new URL(ENDPOINT);
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', mapLang(sourceLang));
  url.searchParams.set('tl', mapLang(targetLang));
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: 'GET', signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new TranslationError('ABORTED', 'Request aborted');
    }
    throw new TranslationError('NETWORK', (err as Error).message);
  }

  if (!res.ok) {
    const code = res.status === 429 ? 'RATE_LIMIT' : 'HTTP_ERROR';
    throw new TranslationError(code, `Google ${res.status}: ${res.statusText}`, res.status);
  }

  const data = (await res.json()) as unknown;
  // Shape: [[[translated, source, ...], ...], ...]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new TranslationError('PARSE', 'Unexpected Google response shape');
  }
  let out = '';
  for (const seg of data[0] as unknown[]) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') out += seg[0];
  }
  return out;
};

export const createGoogleFreeProvider = (): TranslationProvider => ({
  id: 'google-free',
  maxTextsPerRequest: 1,
  softMaxCharsPerRequest: 4_500,
  preservesHtml: false,
  credentialFields: [],

  async translate(req: TranslateRequest): Promise<string[]> {
    if (req.texts.length === 0) return [];
    const source = req.sourceLang ?? 'auto';
    const out: string[] = [];
    for (const t of req.texts) {
      out.push(await translateOne(t, source, req.targetLang, req.signal));
    }
    return out;
  },

  async validate(): Promise<ValidateResult> {
    return { ok: true };
  },
});

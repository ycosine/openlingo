import { TranslationError } from '../types.js';
import type { TranslateRequest, TranslationProvider, ValidateResult } from '../types.js';

const PRO_BASE = 'https://api.deepl.com';
const FREE_BASE = 'https://api-free.deepl.com';

const baseFor = (apiKey: string): string => (apiKey.trim().endsWith(':fx') ? FREE_BASE : PRO_BASE);

const authHeader = (apiKey: string): string => `DeepL-Auth-Key ${apiKey.trim()}`;

export const createDeepLProvider = (apiKey: string): TranslationProvider => ({
  id: 'deepl',
  maxTextsPerRequest: 10,
  softMaxCharsPerRequest: 8_000,

  async translate(req: TranslateRequest): Promise<string[]> {
    if (!apiKey) {
      throw new TranslationError('NO_API_KEY', 'DeepL API key is not configured');
    }
    if (req.texts.length === 0) return [];

    const body = new URLSearchParams();
    for (const t of req.texts) body.append('text', t);
    body.append('target_lang', req.targetLang.toUpperCase());
    if (req.sourceLang && req.sourceLang.toLowerCase() !== 'auto') {
      body.append('source_lang', req.sourceLang.toUpperCase());
    }
    if (req.tagHandling && req.tagHandling !== 'none') {
      body.append('tag_handling', req.tagHandling);
    }

    let res: Response;
    try {
      res = await fetch(`${baseFor(apiKey)}/v2/translate`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(apiKey),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: req.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new TranslationError('ABORTED', 'Request aborted');
      }
      throw new TranslationError('NETWORK', (err as Error).message);
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        // ignore
      }
      const code =
        res.status === 401 || res.status === 403
          ? 'AUTH'
          : res.status === 429
            ? 'RATE_LIMIT'
            : res.status === 456
              ? 'QUOTA_EXCEEDED'
              : 'HTTP_ERROR';
      throw new TranslationError(code, `DeepL ${res.status}: ${detail || res.statusText}`, res.status);
    }

    const data = (await res.json()) as { translations: { text: string; detected_source_language: string }[] };
    return data.translations.map(t => t.text);
  },

  async validate(key: string): Promise<ValidateResult> {
    if (!key.trim()) return { ok: false, message: 'Empty key' };
    try {
      const res = await fetch(`${baseFor(key)}/v2/usage`, {
        method: 'GET',
        headers: { Authorization: authHeader(key) },
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Invalid API key' };
      }
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
});

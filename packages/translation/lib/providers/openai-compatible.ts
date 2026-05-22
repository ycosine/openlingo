import { TranslationError } from '../types.js';
import type { ProviderCredential, TranslateRequest, TranslationProvider, ValidateResult } from '../types.js';

const langLabel = (code: string): string => {
  const c = code.toLowerCase();
  if (c.startsWith('zh')) return 'Simplified Chinese';
  if (c.startsWith('en')) return 'English';
  if (c.startsWith('ja')) return 'Japanese';
  if (c.startsWith('ko')) return 'Korean';
  if (c.startsWith('fr')) return 'French';
  if (c.startsWith('de')) return 'German';
  if (c.startsWith('es')) return 'Spanish';
  if (c.startsWith('ru')) return 'Russian';
  if (c.startsWith('pt')) return 'Portuguese';
  if (c.startsWith('it')) return 'Italian';
  return code;
};

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are a professional {{to}} native translator who needs to fluently translate text into {{to}}.

## Translation Rules
1. Output only the translated content, without explanations or additional content (such as "Here's the translation:" or "Translation as follows:")
2. The returned translation must maintain exactly the same number of paragraphs and format as the original text
3. If the text contains HTML tags, consider where the tags should be placed in the translation while maintaining fluency
4. For content that should not be translated (such as proper nouns, code, etc.), keep the original text.
5. If input contains %%, use %% in your output, if input has no %%, don't use %% in your output{{title_prompt}}{{summary_prompt}}{{terms_prompt}}

## OUTPUT FORMAT:
- **Single paragraph input** → Output translation directly (no separators, no extra text)
- **Multi-paragraph input** → Use %% as paragraph separator between translations

## Examples
### Multi-paragraph Input:
Paragraph A

%%

Paragraph B

%%

Paragraph C

%%

Paragraph D

### Multi-paragraph Output:
Translation A

%%

Translation B

%%

Translation C

%%

Translation D

### Single paragraph Input:
Single paragraph content

### Single paragraph Output:
Direct translation without separators

{{imt_style_guide}}`;

const expandTemplate = (template: string, targetLang: string): string =>
  template
    .replace(/\{\{to\}\}/g, langLabel(targetLang))
    .replace(/\{\{[a-z_]+\}\}/g, '') // strip remaining unfilled placeholders
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const trimUrl = (u: string): string => u.replace(/\/+$/, '');

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

const callChat = async (
  cred: ProviderCredential,
  systemPrompt: string,
  userText: string,
  signal?: AbortSignal,
): Promise<string> => {
  const baseUrl = trimUrl(cred.baseUrl?.trim() ?? '');
  const model = cred.model?.trim() ?? '';
  const apiKey = cred.apiKey?.trim() ?? '';
  if (!baseUrl) throw new TranslationError('NO_API_KEY', 'Base URL is not configured');
  if (!model) throw new TranslationError('NO_API_KEY', 'Model is not configured');

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
      }),
      signal,
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
    const code = res.status === 401 || res.status === 403 ? 'AUTH' : res.status === 429 ? 'RATE_LIMIT' : 'HTTP_ERROR';
    throw new TranslationError(code, `OpenAI ${res.status}: ${detail || res.statusText}`, res.status);
  }

  const data = (await res.json()) as OpenAIChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new TranslationError('PARSE', data.error?.message ?? 'Unexpected OpenAI response');
  }
  return content.trim();
};

export const createOpenAICompatibleProvider = (cred: ProviderCredential): TranslationProvider => ({
  id: 'openai-compatible',
  maxTextsPerRequest: 1,
  softMaxCharsPerRequest: 6_000,
  preservesHtml: true,
  credentialFields: ['baseUrl', 'model', 'apiKey', 'systemPrompt'],

  async translate(req: TranslateRequest): Promise<string[]> {
    if (req.texts.length === 0) return [];
    const userTemplate = cred.systemPrompt?.trim();
    const template = userTemplate && userTemplate.length > 0 ? userTemplate : DEFAULT_SYSTEM_PROMPT_TEMPLATE;
    const systemPrompt = expandTemplate(template, req.targetLang);
    const out: string[] = [];
    for (const t of req.texts) {
      out.push(await callChat(cred, systemPrompt, t, req.signal));
    }
    return out;
  },

  async validate(c: ProviderCredential): Promise<ValidateResult> {
    const baseUrl = trimUrl(c.baseUrl?.trim() ?? '');
    if (!baseUrl) return { ok: false, message: 'Base URL is required' };
    if (!c.model?.trim()) return { ok: false, message: 'Model is required' };
    try {
      // 1-token translation to verify auth + model in one call.
      const result = await callChat(c, 'You are a translator.', 'ping', undefined);
      return result.length > 0 ? { ok: true } : { ok: false, message: 'Empty response' };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'AUTH') return { ok: false, message: 'Invalid API key' };
      return { ok: false, message: e.message ?? 'Validation failed' };
    }
  },
});

export { DEFAULT_SYSTEM_PROMPT_TEMPLATE };

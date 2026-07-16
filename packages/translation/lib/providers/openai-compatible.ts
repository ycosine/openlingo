import { TranslationError } from '../types.js';
import type {
  CredentialField,
  ProviderCredential,
  ProviderId,
  TranslateRequest,
  TranslationProvider,
  ValidateResult,
} from '../types.js';

/** Shape of a chat-completions-style provider. `openai-compatible` lets the
 *  user supply any base URL; the DeepSeek and OpenAI presets pin it. */
interface ChatProviderConfig {
  id: ProviderId;
  /** Display name used in error messages. */
  label: string;
  /** When set, the credential's baseUrl is ignored. */
  fixedBaseUrl?: string;
  /** Used when the credential does not specify a model. */
  defaultModel?: string;
  /** Fields the session-level credential check treats as required. */
  credentialFields: CredentialField[];
}

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

interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  error?: { message?: string };
}

/** Consume an SSE chat-completions stream, invoking onDelta with the
 *  accumulated text after every content delta. Returns the full text.
 *  Backward compatible with servers that ignore `stream: true`: if no SSE
 *  content arrives, the raw body is re-parsed as a plain JSON response. */
const readStream = async (res: Response, onDelta: (accumulated: string) => void): Promise<string> => {
  const reader = res.body?.getReader();
  if (!reader) throw new TranslationError('PARSE', 'Streaming response has no body');
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let accumulated = '';
  let sawDone = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      buffer += text;
      raw += text;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          sawDone = true;
          continue;
        }
        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenAIStreamChunk;
        } catch {
          continue;
        }
        if (chunk.error?.message) throw new TranslationError('HTTP_ERROR', chunk.error.message);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          accumulated += delta;
          onDelta(accumulated);
        }
      }
      if (sawDone) break;
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new TranslationError('ABORTED', 'Request aborted');
    throw err;
  }
  if (accumulated) return accumulated;

  // No SSE content — the server likely ignored `stream: true` and returned a
  // regular JSON completion. Fall back to parsing the whole body.
  try {
    const data = JSON.parse(raw) as OpenAIChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    throw new TranslationError('PARSE', data.error?.message ?? 'Unexpected OpenAI response');
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    return accumulated;
  }
};

const callChat = async (
  cred: ProviderCredential,
  config: ChatProviderConfig,
  systemPrompt: string,
  userText: string,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void,
): Promise<string> => {
  const baseUrl = config.fixedBaseUrl ?? trimUrl(cred.baseUrl?.trim() ?? '');
  const model = cred.model?.trim() || config.defaultModel || '';
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
        ...(onDelta ? { stream: true } : {}),
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
    throw new TranslationError(code, `${config.label} ${res.status}: ${detail || res.statusText}`, res.status);
  }

  if (onDelta) return (await readStream(res, onDelta)).trim();

  const data = (await res.json()) as OpenAIChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new TranslationError('PARSE', data.error?.message ?? 'Unexpected OpenAI response');
  }
  return content.trim();
};

const createChatCompletionsProvider = (cred: ProviderCredential, config: ChatProviderConfig): TranslationProvider => ({
  id: config.id,
  maxTextsPerRequest: 1,
  softMaxCharsPerRequest: 6_000,
  preservesHtml: true,
  credentialFields: config.credentialFields,

  async translate(req: TranslateRequest): Promise<string[]> {
    if (req.texts.length === 0) return [];
    const userTemplate = cred.systemPrompt?.trim();
    const template = userTemplate && userTemplate.length > 0 ? userTemplate : DEFAULT_SYSTEM_PROMPT_TEMPLATE;
    const systemPrompt = expandTemplate(template, req.targetLang);
    const out: string[] = [];
    for (let i = 0; i < req.texts.length; i += 1) {
      const onPartial = req.onPartial;
      const onDelta = onPartial ? (text: string) => onPartial(i, text) : undefined;
      out.push(await callChat(cred, config, systemPrompt, req.texts[i], req.signal, onDelta));
    }
    return out;
  },

  async validate(c: ProviderCredential): Promise<ValidateResult> {
    if (!config.fixedBaseUrl && !trimUrl(c.baseUrl?.trim() ?? '')) {
      return { ok: false, message: 'Base URL is required' };
    }
    if (!config.defaultModel && !c.model?.trim()) return { ok: false, message: 'Model is required' };
    try {
      // 1-token translation to verify auth + model in one call.
      const result = await callChat(c, config, 'You are a translator.', 'ping', undefined);
      return result.length > 0 ? { ok: true } : { ok: false, message: 'Empty response' };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'AUTH') return { ok: false, message: 'Invalid API key' };
      return { ok: false, message: e.message ?? 'Validation failed' };
    }
  },
});

export const createOpenAICompatibleProvider = (cred: ProviderCredential): TranslationProvider =>
  createChatCompletionsProvider(cred, {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    credentialFields: ['baseUrl', 'model', 'apiKey', 'systemPrompt'],
  });

export const createOpenAIProvider = (cred: ProviderCredential): TranslationProvider =>
  createChatCompletionsProvider(cred, {
    id: 'openai',
    label: 'OpenAI',
    fixedBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    credentialFields: ['apiKey'],
  });

export const createDeepSeekProvider = (cred: ProviderCredential): TranslationProvider =>
  createChatCompletionsProvider(cred, {
    id: 'deepseek',
    label: 'DeepSeek',
    fixedBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    credentialFields: ['apiKey'],
  });

export { DEFAULT_SYSTEM_PROMPT_TEMPLATE, expandTemplate };

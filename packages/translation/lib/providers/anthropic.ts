import { DEFAULT_SYSTEM_PROMPT_TEMPLATE, expandTemplate } from './openai-compatible.js';
import { TranslationError } from '../types.js';
import Anthropic from '@anthropic-ai/sdk';
import type { ProviderCredential, TranslateRequest, TranslationProvider, ValidateResult } from '../types.js';

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 8192;

const toTranslationError = (err: unknown): TranslationError => {
  if (err instanceof TranslationError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new TranslationError('AUTH', err.message, err.status);
  }
  if (err instanceof Anthropic.RateLimitError) return new TranslationError('RATE_LIMIT', err.message, err.status);
  // APIConnectionError is a subclass of APIError in the TypeScript SDK — check it first.
  if (err instanceof Anthropic.APIConnectionError) return new TranslationError('NETWORK', err.message);
  if (err instanceof Anthropic.APIError) {
    return new TranslationError('HTTP_ERROR', `Anthropic ${err.status}: ${err.message}`, err.status);
  }
  if ((err as Error).name === 'AbortError') return new TranslationError('ABORTED', 'Request aborted');
  return new TranslationError('NETWORK', (err as Error).message);
};

const textFrom = (message: Anthropic.Message): string => {
  if (message.stop_reason === 'refusal') {
    throw new TranslationError('HTTP_ERROR', 'Anthropic declined to process this text');
  }
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
  if (!text) throw new TranslationError('PARSE', 'Empty response from Anthropic');
  return text;
};

export const createAnthropicProvider = (cred: ProviderCredential): TranslationProvider => {
  const model = cred.model?.trim() || DEFAULT_MODEL;

  const makeClient = (apiKey: string): Anthropic =>
    new Anthropic({
      apiKey,
      // The extension's background service worker is a browser context; host
      // permissions in the manifest scope which origins we can reach.
      dangerouslyAllowBrowser: true,
    });

  return {
    id: 'anthropic',
    maxTextsPerRequest: 1,
    softMaxCharsPerRequest: 6_000,
    preservesHtml: true,
    credentialFields: ['apiKey'],

    async translate(req: TranslateRequest): Promise<string[]> {
      if (req.texts.length === 0) return [];
      const apiKey = cred.apiKey?.trim() ?? '';
      if (!apiKey) throw new TranslationError('NO_API_KEY', 'Anthropic API key is not configured');

      const userTemplate = cred.systemPrompt?.trim();
      const template = userTemplate && userTemplate.length > 0 ? userTemplate : DEFAULT_SYSTEM_PROMPT_TEMPLATE;
      const system = expandTemplate(template, req.targetLang);
      const client = makeClient(apiKey);

      const out: string[] = [];
      for (let i = 0; i < req.texts.length; i += 1) {
        const params: Anthropic.MessageCreateParamsNonStreaming = {
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: req.texts[i] }],
        };
        try {
          if (req.onPartial) {
            const onPartial = req.onPartial;
            const index = i;
            const stream = client.messages.stream(params, { signal: req.signal });
            let accumulated = '';
            stream.on('text', delta => {
              accumulated += delta;
              onPartial(index, accumulated);
            });
            out.push(textFrom(await stream.finalMessage()));
          } else {
            out.push(textFrom(await client.messages.create(params, { signal: req.signal })));
          }
        } catch (err) {
          throw toTranslationError(err);
        }
      }
      return out;
    },

    async validate(c: ProviderCredential): Promise<ValidateResult> {
      const apiKey = c.apiKey?.trim() ?? '';
      if (!apiKey) return { ok: false, message: 'API key is required' };
      try {
        // Token counting is free and verifies both the key and the model id.
        await makeClient(apiKey).messages.countTokens({
          model: c.model?.trim() || DEFAULT_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
        });
        return { ok: true };
      } catch (err) {
        const e = toTranslationError(err);
        if (e.code === 'AUTH') return { ok: false, message: 'Invalid API key' };
        if (e.status === 404) return { ok: false, message: `Model not found: ${c.model?.trim() || DEFAULT_MODEL}` };
        return { ok: false, message: e.message };
      }
    },
  };
};

import { providerCredentialsStorage, translationCacheStorage, translationSettingsStorage } from '@extension/storage';
import { getProvider, TranslationError } from '@extension/translation';
import type { ProviderCredential, ProviderId, TranslationProvider } from '@extension/translation';

interface TranslateUnit {
  id: string;
  html: string;
}

interface TranslateBatchRequest {
  type: 'TR_TRANSLATE_BATCH';
  sessionId: string;
  units: TranslateUnit[];
}

interface TranslateCancelRequest {
  type: 'TR_TRANSLATE_CANCEL';
  sessionId: string;
}

interface TranslateValidateRequest {
  type: 'TR_VALIDATE_KEY';
  providerId?: ProviderId;
  credential?: ProviderCredential;
  /** Legacy: callers that still send only apiKey for the current settings provider. */
  apiKey?: string;
}

interface TranslateResultMessage {
  type: 'TR_TRANSLATE_RESULT';
  sessionId: string;
  results: Array<{ id: string; html: string }>;
  done: boolean;
}

interface TranslateErrorMessage {
  type: 'TR_TRANSLATE_ERROR';
  sessionId: string;
  code: string;
  message: string;
}

const MAX_CONCURRENCY = 3;

const sessions = new Map<string, AbortController>();

const TRACKING_PARAM_KEYS = new Set([
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'dclid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'ref',
  'ref_src',
  'referrer',
  'igshid',
  'spm',
  'src',
]);

const stripTrackingFromUrl = (url: string): string => {
  try {
    const u = new URL(url, 'https://x.invalid');
    for (const k of [...u.searchParams.keys()]) {
      const lc = k.toLowerCase();
      if (lc.startsWith('utm_') || TRACKING_PARAM_KEYS.has(lc)) {
        u.searchParams.delete(k);
      }
    }
    return u.protocol === 'https:' && u.hostname === 'x.invalid' ? url : u.toString();
  } catch {
    return url;
  }
};

const NOISE_ATTR_RE = /\s+(class|id|style|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*')/gi;
const URL_ATTR_RE = /\s+(href|src)\s*=\s*"([^"]*)"/gi;
const WHITESPACE_RE = /\s+/g;

const normalizeForCacheKey = (html: string): string =>
  html
    .replace(NOISE_ATTR_RE, '')
    .replace(URL_ATTR_RE, (_m, attr, url) => ` ${attr}="${stripTrackingFromUrl(url)}"`)
    .replace(WHITESPACE_RE, ' ')
    .trim();

const cacheKey = (providerId: string, sourceLang: string, targetLang: string, html: string): string =>
  `${providerId}|${sourceLang || 'auto'}|${targetLang}|${normalizeForCacheKey(html)}`;

const HTML_TAG_RE = /<[^>]+>/g;

interface PlainConversion {
  plain: string;
  tags: string[];
}

const htmlToPlain = (html: string): PlainConversion => {
  const tags: string[] = [];
  const plain = html.replace(HTML_TAG_RE, match => {
    const idx = tags.length;
    tags.push(match);
    return `⦃${idx}⦄`;
  });
  return { plain, tags };
};

const RE_TAG_PLACEHOLDER_FUZZY = /[⦃｛{]\s*(\d+)\s*[⦄｝}]/g;
const restorePlaceholders = (out: string, tags: string[]): string =>
  // Allow models to mangle the brackets slightly (e.g. emit { } instead of ⦃ ⦄)
  out.replace(RE_TAG_PLACEHOLDER_FUZZY, (_m, n) => tags[Number(n)] ?? '');

const missingCredentialFields = (provider: TranslationProvider, cred: ProviderCredential): string[] => {
  const missing: string[] = [];
  for (const f of provider.credentialFields) {
    if (f === 'systemPrompt') continue; // optional
    const v = cred[f];
    if (typeof v !== 'string' || v.trim() === '') missing.push(f);
  }
  return missing;
};

interface Batch {
  units: TranslateUnit[];
}

const buildBatches = (units: TranslateUnit[], provider: TranslationProvider): Batch[] => {
  const batches: Batch[] = [];
  let cur: TranslateUnit[] = [];
  let curChars = 0;
  for (const u of units) {
    const len = u.html.length;
    if (
      cur.length >= provider.maxTextsPerRequest ||
      (cur.length > 0 && curChars + len > provider.softMaxCharsPerRequest)
    ) {
      batches.push({ units: cur });
      cur = [];
      curChars = 0;
    }
    cur.push(u);
    curChars += len;
  }
  if (cur.length > 0) batches.push({ units: cur });
  return batches;
};

const runWithConcurrency = async <T, R>(items: T[], worker: (item: T) => Promise<R>, limit: number): Promise<void> => {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      await worker(items[myIdx]);
    }
  });
  await Promise.all(runners);
};

const sendToTab = (tabId: number, msg: TranslateResultMessage | TranslateErrorMessage): void => {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab may have navigated away — ignore.
  });
};

const handleBatch = async (req: TranslateBatchRequest, tabId: number): Promise<void> => {
  const settings = await translationSettingsStorage.get();
  const cred = await providerCredentialsStorage.getFor(settings.provider);
  const provider = getProvider(settings.provider, cred);

  const missing = missingCredentialFields(provider, cred);
  if (missing.length > 0) {
    sendToTab(tabId, {
      type: 'TR_TRANSLATE_ERROR',
      sessionId: req.sessionId,
      code: 'NO_API_KEY',
      message: `Missing credentials for ${provider.id}: ${missing.join(', ')}`,
    });
    return;
  }

  const controller = new AbortController();
  sessions.set(req.sessionId, controller);

  const targetLang = settings.targetLang;
  const sourceLang = settings.sourceLang;

  const cacheKeys = req.units.map(u => cacheKey(provider.id, sourceLang, targetLang, u.html));
  const cached = await translationCacheStorage.getMany(cacheKeys);

  const cachedHits: Array<{ id: string; html: string }> = [];
  const misses: TranslateUnit[] = [];
  req.units.forEach((u, i) => {
    const hit = cached[cacheKeys[i]];
    if (typeof hit === 'string') cachedHits.push({ id: u.id, html: hit });
    else misses.push(u);
  });

  if (cachedHits.length > 0) {
    sendToTab(tabId, {
      type: 'TR_TRANSLATE_RESULT',
      sessionId: req.sessionId,
      results: cachedHits,
      done: misses.length === 0,
    });
  }

  if (misses.length === 0) {
    sessions.delete(req.sessionId);
    return;
  }

  const batches = buildBatches(misses, provider);
  let remaining = batches.length;

  try {
    await runWithConcurrency(
      batches,
      async batch => {
        if (controller.signal.aborted) return;

        let texts: string[];
        let tagsPerUnit: string[][] | null = null;
        if (provider.preservesHtml) {
          texts = batch.units.map(u => u.html);
        } else {
          tagsPerUnit = [];
          texts = batch.units.map(u => {
            const { plain, tags } = htmlToPlain(u.html);
            tagsPerUnit!.push(tags);
            return plain;
          });
        }

        const translated = await provider.translate({
          texts,
          sourceLang,
          targetLang,
          tagHandling: provider.preservesHtml ? 'html' : 'none',
          signal: controller.signal,
        });

        const restored = tagsPerUnit
          ? translated.map((t, i) => restorePlaceholders(t ?? '', tagsPerUnit![i] ?? []))
          : translated.map(t => t ?? '');

        const results = batch.units.map((u, i) => ({ id: u.id, html: restored[i] ?? '' }));
        const toCache: Record<string, string> = {};
        batch.units.forEach((u, i) => {
          toCache[cacheKey(provider.id, sourceLang, targetLang, u.html)] = restored[i] ?? '';
        });
        void translationCacheStorage.putMany(toCache);

        remaining--;
        sendToTab(tabId, {
          type: 'TR_TRANSLATE_RESULT',
          sessionId: req.sessionId,
          results,
          done: remaining === 0,
        });
      },
      MAX_CONCURRENCY,
    );
  } catch (err) {
    if (controller.signal.aborted) return;
    const code = err instanceof TranslationError ? err.code : 'UNKNOWN';
    const message = (err as Error).message ?? 'Translation failed';
    sendToTab(tabId, { type: 'TR_TRANSLATE_ERROR', sessionId: req.sessionId, code, message });
  } finally {
    sessions.delete(req.sessionId);
  }
};

const handleCancel = (req: TranslateCancelRequest): void => {
  const ctrl = sessions.get(req.sessionId);
  if (ctrl) {
    ctrl.abort();
    sessions.delete(req.sessionId);
  }
};

const handleValidate = async (req: TranslateValidateRequest): Promise<{ ok: boolean; message?: string }> => {
  const settings = await translationSettingsStorage.get();
  const providerId = req.providerId ?? settings.provider;
  const stored = await providerCredentialsStorage.getFor(providerId);
  const credential: ProviderCredential = req.credential ?? (req.apiKey ? { ...stored, apiKey: req.apiKey } : stored);
  const provider = getProvider(providerId, credential);
  return provider.validate(credential);
};

export const registerTranslatorMessageHandlers = (): void => {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const tabId = sender.tab?.id;

    if (msg.type === 'TR_TRANSLATE_BATCH' && tabId !== undefined) {
      void handleBatch(msg as TranslateBatchRequest, tabId);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'TR_TRANSLATE_CANCEL') {
      handleCancel(msg as TranslateCancelRequest);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'TR_VALIDATE_KEY') {
      handleValidate(msg as TranslateValidateRequest).then(sendResponse);
      return true;
    }
    return;
  });
};

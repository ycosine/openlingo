import { providerCredentialsStorage, translationCacheStorage, translationSettingsStorage } from '@extension/storage';
import { getProvider, TranslationError } from '@extension/translation';
import type { ProviderCredential, TranslationProvider } from '@extension/translation';

interface TranslateUnit {
  id: string;
  html: string;
  /** One-shot text (e.g. a live ASR partial): bypass the translation cache. */
  transient?: boolean;
}

interface TranslateBatchRequest {
  type: 'TR_TRANSLATE_BATCH';
  sessionId: string;
  units: TranslateUnit[];
  maxConcurrency?: number;
  /** Opt in to TR_TRANSLATE_PARTIAL streaming updates for this session. */
  wantPartials?: boolean;
}

interface TranslateCancelRequest {
  type: 'TR_TRANSLATE_CANCEL';
  sessionId: string;
}

interface TranslateResultMessage {
  type: 'TR_TRANSLATE_RESULT';
  sessionId: string;
  results: Array<{ id: string; html: string }>;
}

/** Streaming interim translation for one unit. Superseded by the final
 *  TR_TRANSLATE_RESULT carrying the same id. */
interface TranslatePartialMessage {
  type: 'TR_TRANSLATE_PARTIAL';
  sessionId: string;
  id: string;
  html: string;
}

interface TranslateErrorMessage {
  type: 'TR_TRANSLATE_ERROR';
  sessionId: string;
  code: string;
  message: string;
}

interface TranslateBackoffMessage {
  type: 'TR_TRANSLATE_BACKOFF';
  sessionId: string;
  extendMs: number;
}

type Outbound = TranslateResultMessage | TranslatePartialMessage | TranslateErrorMessage | TranslateBackoffMessage;

const MAX_CONCURRENCY = 3;
/** Minimum gap between streamed partial updates per unit. */
const PARTIAL_THROTTLE_MS = 150;
const BACKOFF_MS = [1000, 4000, 10_000] as const;
const BACKOFF_EXTEND_MS = 15_000;
const MAX_RATE_RETRIES = 3;

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
  out.replace(RE_TAG_PLACEHOLDER_FUZZY, (_m, n) => tags[Number(n)] ?? '');

const missingCredentialFields = (provider: TranslationProvider, cred: ProviderCredential): string[] => {
  const missing: string[] = [];
  for (const f of provider.credentialFields) {
    if (f === 'systemPrompt') continue;
    const v = cred[f];
    if (typeof v !== 'string' || v.trim() === '') missing.push(f);
  }
  return missing;
};

/** Pull one provider-sized batch from the front of the unit queue (sync). */
const takeBatch = (queue: TranslateUnit[], provider: TranslationProvider): TranslateUnit[] => {
  const batch: TranslateUnit[] = [];
  let chars = 0;
  while (queue.length > 0) {
    const next = queue[0];
    const len = next.html.length;
    if (
      batch.length >= provider.maxTextsPerRequest ||
      (batch.length > 0 && chars + len > provider.softMaxCharsPerRequest)
    ) {
      break;
    }
    batch.push(queue.shift()!);
    chars += len;
  }
  return batch;
};

type SessionSink = (msg: Outbound) => void;

interface ProviderContext {
  provider: TranslationProvider;
  sourceLang: string;
  targetLang: string;
}

/**
 * Per-tab translation session: single FIFO queue, shared concurrency (default 3),
 * one AbortController. Incoming batch messages only push; a single loop drains.
 */
class TranslateSession {
  readonly sessionId: string;
  private readonly sink: SessionSink;
  private readonly queue: TranslateUnit[] = [];
  private controller = new AbortController();
  private concurrency = MAX_CONCURRENCY;
  private closed = false;
  private running = false;
  private wantPartials = false;

  constructor(sessionId: string, sink: SessionSink) {
    this.sessionId = sessionId;
    this.sink = sink;
  }

  enqueue(units: TranslateUnit[], maxConcurrency?: number, wantPartials?: boolean): void {
    if (this.closed) return;
    if (typeof maxConcurrency === 'number' && Number.isFinite(maxConcurrency)) {
      this.concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(maxConcurrency)));
    }
    if (wantPartials) this.wantPartials = true;
    this.queue.push(...units);
    void this.start();
  }

  cancel(): void {
    this.closed = true;
    this.queue.length = 0;
    this.controller.abort();
  }

  private async resolveContext(): Promise<ProviderContext | null> {
    const settings = await translationSettingsStorage.get();
    const cred = await providerCredentialsStorage.getFor(settings.provider);
    const provider = getProvider(settings.provider, cred);
    const missing = missingCredentialFields(provider, cred);
    if (missing.length > 0) {
      this.queue.length = 0;
      this.sink({
        type: 'TR_TRANSLATE_ERROR',
        sessionId: this.sessionId,
        code: 'NO_API_KEY',
        message: `Missing credentials for ${provider.id}: ${missing.join(', ')}`,
      });
      return null;
    }
    return {
      provider,
      sourceLang: settings.sourceLang,
      targetLang: settings.targetLang,
    };
  }

  private async start(): Promise<void> {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      const inFlight = new Set<Promise<void>>();

      while (!this.closed && (this.queue.length > 0 || inFlight.size > 0)) {
        if (this.queue.length > 0 && inFlight.size < this.concurrency) {
          const ctx = await this.resolveContext();
          if (!ctx || this.closed) break;

          // Launch as many jobs as free slots allow (takeBatch is sync → no race).
          while (!this.closed && this.queue.length > 0 && inFlight.size < this.concurrency) {
            const batch = takeBatch(this.queue, ctx.provider);
            if (batch.length === 0) break;
            const job = this.processBatch(batch, ctx).finally(() => {
              inFlight.delete(job);
            });
            inFlight.add(job);
          }
        }

        if (inFlight.size === 0) break;
        await Promise.race(inFlight);
      }
    } finally {
      this.running = false;
      if (!this.closed && this.queue.length > 0) void this.start();
    }
  }

  private async processBatch(batch: TranslateUnit[], ctx: ProviderContext): Promise<void> {
    if (this.closed || this.controller.signal.aborted) return;

    const { provider, sourceLang, targetLang } = ctx;
    const cacheable = batch.filter(u => !u.transient);
    const cacheKeys = cacheable.map(u => cacheKey(provider.id, sourceLang, targetLang, u.html));
    const cached = cacheKeys.length > 0 ? await translationCacheStorage.getMany(cacheKeys) : {};

    const cachedHits: Array<{ id: string; html: string }> = [];
    const misses: TranslateUnit[] = batch.filter(u => u.transient);
    cacheable.forEach((u, i) => {
      const hit = cached[cacheKeys[i]];
      if (typeof hit === 'string') cachedHits.push({ id: u.id, html: hit });
      else misses.push(u);
    });

    if (cachedHits.length > 0) {
      this.sink({
        type: 'TR_TRANSLATE_RESULT',
        sessionId: this.sessionId,
        results: cachedHits,
      });
    }

    if (misses.length === 0 || this.closed) return;

    await this.translateMisses(misses, provider, sourceLang, targetLang);
  }

  private async translateMisses(
    units: TranslateUnit[],
    provider: TranslationProvider,
    sourceLang: string,
    targetLang: string,
  ): Promise<void> {
    let rateAttempt = 0;

    while (!this.closed && !this.controller.signal.aborted) {
      try {
        let texts: string[];
        let tagsPerUnit: string[][] | null = null;
        if (provider.preservesHtml) {
          texts = units.map(u => u.html);
        } else {
          tagsPerUnit = [];
          texts = units.map(u => {
            const { plain, tags } = htmlToPlain(u.html);
            tagsPerUnit!.push(tags);
            return plain;
          });
        }

        const lastPartialAt = new Map<number, number>();
        const translated = await provider.translate({
          texts,
          sourceLang,
          targetLang,
          tagHandling: provider.preservesHtml ? 'html' : 'none',
          signal: this.controller.signal,
          // Forward streamed interim translations (throttled per unit). Only
          // emitted when the client opted in and for providers that preserve
          // HTML natively — placeholder restoration for the others happens
          // after the full result.
          onPartial:
            this.wantPartials && provider.preservesHtml
              ? (index, text) => {
                  if (this.closed || this.controller.signal.aborted) return;
                  const unit = units[index];
                  if (!unit || !text) return;
                  const now = Date.now();
                  if (now - (lastPartialAt.get(index) ?? 0) < PARTIAL_THROTTLE_MS) return;
                  lastPartialAt.set(index, now);
                  this.sink({
                    type: 'TR_TRANSLATE_PARTIAL',
                    sessionId: this.sessionId,
                    id: unit.id,
                    html: text,
                  });
                }
              : undefined,
        });

        const restored = tagsPerUnit
          ? translated.map((t, i) => restorePlaceholders(t ?? '', tagsPerUnit![i] ?? []))
          : translated.map(t => t ?? '');

        const results = units.map((u, i) => ({ id: u.id, html: restored[i] ?? '' }));
        const toCache: Record<string, string> = {};
        units.forEach((u, i) => {
          if (u.transient) return;
          toCache[cacheKey(provider.id, sourceLang, targetLang, u.html)] = restored[i] ?? '';
        });
        if (Object.keys(toCache).length > 0) void translationCacheStorage.putMany(toCache);

        this.sink({
          type: 'TR_TRANSLATE_RESULT',
          sessionId: this.sessionId,
          results,
        });
        return;
      } catch (err) {
        if (this.controller.signal.aborted || this.closed) return;

        const code = err instanceof TranslationError ? err.code : 'UNKNOWN';
        const isRate = code === 'RATE_LIMIT' || (err instanceof TranslationError && err.status === 429);

        if (isRate && rateAttempt < MAX_RATE_RETRIES) {
          const wait = BACKOFF_MS[Math.min(rateAttempt, BACKOFF_MS.length - 1)];
          rateAttempt += 1;
          this.sink({
            type: 'TR_TRANSLATE_BACKOFF',
            sessionId: this.sessionId,
            extendMs: BACKOFF_EXTEND_MS,
          });
          await new Promise<void>(r => setTimeout(r, wait));
          continue;
        }

        const message = (err as Error).message ?? 'Translation failed';
        this.sink({
          type: 'TR_TRANSLATE_ERROR',
          sessionId: this.sessionId,
          code,
          message,
        });
        return;
      }
    }
  }
}

export { TranslateSession, htmlToPlain, normalizeForCacheKey, restorePlaceholders };
export type {
  SessionSink,
  TranslateBackoffMessage,
  TranslateBatchRequest,
  TranslateCancelRequest,
  TranslateErrorMessage,
  TranslatePartialMessage,
  TranslateResultMessage,
  TranslateUnit,
};

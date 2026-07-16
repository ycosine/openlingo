/**
 * Submit a list of cues to the background translator and resolve once every
 * cue has either a translation or a final error. Results stream in via the
 * `TR_TRANSLATE_RESULT` message; we update the cue map progressively so the
 * overlay can render whatever's available even while later batches are still
 * in flight.
 */

import type { Cue } from './cues.js';

interface TranslateResultMessage {
  type: 'TR_TRANSLATE_RESULT';
  sessionId: string;
  results: Array<{ id: string; html: string }>;
}

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

type CueTranslationMap = Map<number, string>;

interface TranslateSession {
  sessionId: string;
  translations: CueTranslationMap;
  /** Resolves when the session reports done or errors out. */
  finished: Promise<{ ok: boolean; error?: string }>;
  /** Cancel any pending requests for this session. */
  cancel: () => void;
  /** Fired whenever new translations land — overlay re-renders on it. */
  onUpdate: (listener: () => void) => () => void;
}

interface IncrementalTranslateSession {
  sessionId: string;
  translations: CueTranslationMap;
  append: (cues: Cue[]) => void;
  cancel: () => void;
  onUpdate: (listener: () => void) => () => void;
  onError: (listener: (error: string) => void) => () => void;
}

interface StartCueTranslationOptions {
  /** Put the currently playing cue and future cues at the front of the provider queue. */
  priorityTimeMs?: number;
}

const newSessionId = (): string => `yt-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
const YOUTUBE_SUBTITLE_MAX_CONCURRENCY = 2;

const PLAIN_TO_HTML_PLACEHOLDER = /[<>&]/g;
const escapeForCache = (s: string): string =>
  s.replace(PLAIN_TO_HTML_PLACEHOLDER, ch => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;'));
const unescapeFromCache = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const orderCuesForTranslation = (cues: Cue[], priorityTimeMs = 0): Cue[] => {
  if (cues.length < 2 || priorityTimeMs <= 0) return cues;
  const priorityIndex = cues.findIndex(cue => cue.endMs + 100 >= priorityTimeMs);
  if (priorityIndex < 0) return [...cues.slice(-1), ...cues.slice(0, -1)];
  if (priorityIndex === 0) return cues;
  return [...cues.slice(priorityIndex), ...cues.slice(0, priorityIndex)];
};

const startCueTranslation = (cues: Cue[], options: StartCueTranslationOptions = {}): TranslateSession => {
  const sessionId = newSessionId();
  const translations: CueTranslationMap = new Map();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  let resolveFinished!: (v: { ok: boolean; error?: string }) => void;
  const finished = new Promise<{ ok: boolean; error?: string }>(r => {
    resolveFinished = r;
  });

  let cancelled = false;
  // Streaming partials also land in `translations`, so completion must count
  // only units that received their final result.
  const finalIds = new Set<number>();

  const handler = (msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const m = msg as TranslateResultMessage | TranslatePartialMessage | TranslateErrorMessage;
    if (m.sessionId !== sessionId) return;
    if (m.type === 'TR_TRANSLATE_PARTIAL') {
      const idNum = Number(m.id);
      if (Number.isFinite(idNum) && !finalIds.has(idNum)) {
        translations.set(idNum, unescapeFromCache(m.html ?? '').trim());
        notify();
      }
    } else if (m.type === 'TR_TRANSLATE_RESULT') {
      for (const r of m.results) {
        const idNum = Number(r.id);
        if (!Number.isFinite(idNum)) continue;
        translations.set(idNum, unescapeFromCache(r.html ?? '').trim());
        finalIds.add(idNum);
      }
      notify();
      if (finalIds.size >= cues.length) {
        chrome.runtime.onMessage.removeListener(handler);
        resolveFinished({ ok: true });
      }
    } else if (m.type === 'TR_TRANSLATE_ERROR') {
      chrome.runtime.onMessage.removeListener(handler);
      resolveFinished({ ok: false, error: `${m.code}: ${m.message}` });
    }
  };

  chrome.runtime.onMessage.addListener(handler);

  // Fire one big batch. The background translator chunks it down to fit each
  // provider's per-request limits; subtitles ask for a gentler cap because a
  // full video can otherwise create an avoidable provider-side rate spike.
  // Start near the current playback position so single-text providers do not
  // spend minutes translating old cues before the viewer sees the first line.
  const queuedCues = orderCuesForTranslation(cues, options.priorityTimeMs);
  const units = queuedCues.map(c => ({ id: String(c.id), html: escapeForCache(c.text) }));
  chrome.runtime
    .sendMessage({
      type: 'TR_TRANSLATE_BATCH',
      sessionId,
      units,
      maxConcurrency: YOUTUBE_SUBTITLE_MAX_CONCURRENCY,
      wantPartials: true,
    })
    .catch(err => {
      chrome.runtime.onMessage.removeListener(handler);
      resolveFinished({ ok: false, error: String(err) });
    });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    chrome.runtime.onMessage.removeListener(handler);
    chrome.runtime.sendMessage({ type: 'TR_TRANSLATE_CANCEL', sessionId }).catch(() => undefined);
    resolveFinished({ ok: false, error: 'cancelled' });
  };

  return {
    sessionId,
    translations,
    finished,
    cancel,
    onUpdate: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

const startIncrementalCueTranslation = (): IncrementalTranslateSession => {
  const sessionId = newSessionId();
  const translations: CueTranslationMap = new Map();
  const listeners = new Set<() => void>();
  const errorListeners = new Set<(error: string) => void>();
  const queuedIds = new Set<number>();
  const port = chrome.runtime.connect({ name: 'translate' });
  let cancelled = false;

  const finalIds = new Set<number>();

  port.onMessage.addListener((msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const message = msg as TranslateResultMessage | TranslatePartialMessage | TranslateErrorMessage;
    if (message.sessionId !== sessionId) return;
    if (message.type === 'TR_TRANSLATE_PARTIAL') {
      const id = Number(message.id);
      if (Number.isFinite(id) && !finalIds.has(id)) {
        translations.set(id, unescapeFromCache(message.html ?? '').trim());
        for (const listener of listeners) listener();
      }
      return;
    }
    if (message.type === 'TR_TRANSLATE_RESULT') {
      for (const result of message.results) {
        const id = Number(result.id);
        if (!Number.isFinite(id)) continue;
        translations.set(id, unescapeFromCache(result.html ?? '').trim());
        finalIds.add(id);
      }
      for (const listener of listeners) listener();
      return;
    }
    const error = `${message.code}: ${message.message}`;
    for (const listener of errorListeners) listener(error);
  });

  port.onDisconnect.addListener(() => {
    if (cancelled) return;
    const error = chrome.runtime.lastError?.message ?? 'Translation connection closed';
    for (const listener of errorListeners) listener(error);
  });

  return {
    sessionId,
    translations,
    append: cues => {
      if (cancelled) return;
      const fresh = cues.filter(cue => {
        if (queuedIds.has(cue.id)) return false;
        queuedIds.add(cue.id);
        return true;
      });
      if (fresh.length === 0) return;
      port.postMessage({
        type: 'TR_TRANSLATE_BATCH',
        sessionId,
        units: fresh.map(cue => ({ id: String(cue.id), html: escapeForCache(cue.text) })),
        maxConcurrency: YOUTUBE_SUBTITLE_MAX_CONCURRENCY,
        wantPartials: true,
      });
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      try {
        port.postMessage({ type: 'TR_TRANSLATE_CANCEL', sessionId });
      } catch {
        // Port is already gone.
      }
      port.disconnect();
      listeners.clear();
      errorListeners.clear();
    },
    onUpdate: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onError: listener => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
  };
};

export type { CueTranslationMap, IncrementalTranslateSession, StartCueTranslationOptions, TranslateSession };
export { orderCuesForTranslation, startCueTranslation, startIncrementalCueTranslation };

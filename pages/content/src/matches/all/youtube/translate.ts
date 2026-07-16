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

  const handler = (msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const m = msg as TranslateResultMessage | TranslateErrorMessage;
    if (m.sessionId !== sessionId) return;
    if (m.type === 'TR_TRANSLATE_RESULT') {
      for (const r of m.results) {
        const idNum = Number(r.id);
        if (!Number.isFinite(idNum)) continue;
        translations.set(idNum, unescapeFromCache(r.html ?? '').trim());
      }
      notify();
      if (translations.size >= cues.length) {
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
    .sendMessage({ type: 'TR_TRANSLATE_BATCH', sessionId, units, maxConcurrency: YOUTUBE_SUBTITLE_MAX_CONCURRENCY })
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

export type { CueTranslationMap, StartCueTranslationOptions, TranslateSession };
export { orderCuesForTranslation, startCueTranslation };

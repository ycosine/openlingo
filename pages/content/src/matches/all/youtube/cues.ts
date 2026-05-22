/**
 * Fetch a YouTube `timedtext` track and parse it into a structured cue list.
 *
 * YouTube serves caption tracks from `youtube.com/api/timedtext?...` with a
 * set of signed parameters we cannot reconstruct ourselves. We accept the URL
 * as captured (typically via webRequest in the background) and refetch it with
 * `&fmt=json3` for a stable JSON shape.
 */

interface Cue {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
}

interface Json3Segment {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Segment[];
}

interface Json3Track {
  events?: Json3Event[];
}

interface TranscriptRequest {
  apiKey: string;
  context: unknown;
  params: string;
}

interface TextValue {
  simpleText?: string;
  runs?: Array<{ text?: string }>;
}

interface TranscriptCueRenderer {
  cue?: TextValue;
  startOffsetMs?: string | number;
  durationMs?: string | number;
}

interface FetchCuesOptions {
  filterAmbient: boolean;
  basicSegmentation: boolean;
  signal?: AbortSignal;
}

const FILTER_AMBIENT_RE = /\s*[(（[【][^)）\]】\n]{1,40}[)）\]】]\s*/g;
const COLLAPSE_WHITESPACE_RE = /\s+/g;
// U+200B zero-width space — YouTube occasionally inserts these between segs.
const ZERO_WIDTH_SPACE_RE = /\u200B/g;

const cleanText = (raw: string, { filterAmbient }: { filterAmbient: boolean }): string => {
  let s = raw.replace(/\n+/g, ' ');
  if (filterAmbient) s = s.replace(FILTER_AMBIENT_RE, ' ');
  return s.replace(COLLAPSE_WHITESPACE_RE, ' ').trim();
};

const buildJson3Url = (rawUrl: string, opts: { dropTlang?: boolean } = {}): string => {
  try {
    const u = new URL(rawUrl, 'https://www.youtube.com');
    u.searchParams.set('fmt', 'json3');
    if (opts.dropTlang) u.searchParams.delete('tlang');
    return u.toString();
  } catch {
    return rawUrl;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const textFromValue = (value: TextValue | undefined): string => {
  if (!value) return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  return (value.runs ?? []).map(run => run.text ?? '').join('');
};

const numberFromValue = (value: string | number | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const collectTranscriptCueRenderers = (value: unknown, out: TranscriptCueRenderer[]): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectTranscriptCueRenderers(item, out);
    return;
  }
  if (!isRecord(value)) return;
  const renderer = value.transcriptCueRenderer;
  if (isRecord(renderer)) out.push(renderer as TranscriptCueRenderer);
  for (const item of Object.values(value)) collectTranscriptCueRenderers(item, out);
};

const transcriptParamsCandidates = (params: string): string[] => {
  const candidates = [params];
  try {
    const decoded = decodeURIComponent(params);
    if (decoded !== params) candidates.unshift(decoded);
  } catch {
    // Keep the raw endpoint params if YouTube ever ships a non-URI string.
  }
  return Array.from(new Set(candidates));
};

/**
 * Stitch consecutive auto-caption fragments that don't end in sentence-final
 * punctuation into single sentence-level cues. YouTube's `asr` track emits
 * 1-2 word events that read poorly when translated individually.
 *
 * Conservative: caps merged length, never crosses a 6s gap, never produces a
 * cue longer than 12s.
 */
const segmentCues = (cues: Cue[]): Cue[] => {
  if (cues.length === 0) return cues;
  const merged: Cue[] = [];
  const SENT_END = /[.!?。！？…]"?$|[。！？]$/;
  const MAX_CUE_MS = 12_000;
  const MAX_GAP_MS = 600;
  const MAX_CHARS = 220;
  let cur: Cue | null = null;
  for (const c of cues) {
    if (!cur) {
      cur = { ...c };
      continue;
    }
    const gap = c.startMs - cur.endMs;
    const wouldBeLen = cur.text.length + 1 + c.text.length;
    const span = c.endMs - cur.startMs;
    const curEndsSentence = SENT_END.test(cur.text.trim());
    const shouldMerge = !curEndsSentence && gap <= MAX_GAP_MS && wouldBeLen <= MAX_CHARS && span <= MAX_CUE_MS;
    if (shouldMerge) {
      cur.text = `${cur.text} ${c.text}`.replace(COLLAPSE_WHITESPACE_RE, ' ').trim();
      cur.endMs = c.endMs;
    } else {
      merged.push(cur);
      cur = { ...c };
    }
  }
  if (cur) merged.push(cur);
  return merged.map((c, i) => ({ ...c, id: i }));
};

const fetchCues = async (timedtextUrl: string, opts: FetchCuesOptions): Promise<Cue[]> => {
  const url = buildJson3Url(timedtextUrl, { dropTlang: true });
  const res = await fetch(url, { credentials: 'include', signal: opts.signal });
  if (!res.ok) throw new Error(`timedtext fetch failed: ${res.status}`);
  const data = (await res.json()) as Json3Track;
  const events = data.events ?? [];
  const cues: Cue[] = [];
  let idCounter = 0;
  for (const ev of events) {
    if (typeof ev.tStartMs !== 'number') continue;
    const startMs = ev.tStartMs;
    const endMs = startMs + (ev.dDurationMs ?? 0);
    const raw = (ev.segs ?? [])
      .map(s => s.utf8 ?? '')
      .join('')
      .replace(ZERO_WIDTH_SPACE_RE, '');
    const text = cleanText(raw, { filterAmbient: opts.filterAmbient });
    if (!text) continue;
    cues.push({ id: idCounter++, startMs, endMs, text });
  }
  return opts.basicSegmentation ? segmentCues(cues) : cues;
};

const fetchTranscriptCues = async (request: TranscriptRequest, opts: FetchCuesOptions): Promise<Cue[]> => {
  const contextRecord = isRecord(request.context) ? request.context : {};
  const client = isRecord(contextRecord.client) ? contextRecord.client : {};
  const clientName = typeof client.clientName === 'string' ? client.clientName : 'WEB';
  const clientVersion = typeof client.clientVersion === 'string' ? client.clientVersion : undefined;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-youtube-client-name': clientName === 'WEB' ? '1' : clientName,
  };
  if (clientVersion) headers['x-youtube-client-version'] = clientVersion;

  let lastError: Error | null = null;
  for (const params of transcriptParamsCandidates(request.params)) {
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(request.apiKey)}&prettyPrint=false`,
        {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ context: request.context, params }),
          signal: opts.signal,
        },
      );
      if (!res.ok) {
        lastError = new Error(`transcript fetch failed: ${res.status}`);
        continue;
      }

      const data = (await res.json()) as unknown;
      const renderers: TranscriptCueRenderer[] = [];
      collectTranscriptCueRenderers(data, renderers);

      const cues: Cue[] = [];
      let idCounter = 0;
      for (const renderer of renderers) {
        const startMs = numberFromValue(renderer.startOffsetMs);
        if (startMs === null) continue;
        const durationMs = Math.max(numberFromValue(renderer.durationMs) ?? 2500, 300);
        const text = cleanText(textFromValue(renderer.cue), { filterAmbient: opts.filterAmbient });
        if (!text) continue;
        cues.push({ id: idCounter++, startMs, endMs: startMs + durationMs, text });
      }

      if (cues.length > 0) return opts.basicSegmentation ? segmentCues(cues) : cues;
      lastError = new Error('transcript response had no cues');
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error('transcript fetch failed');
};

const currentVideoId = (): string | null => {
  try {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
};

export type { Cue, FetchCuesOptions, TranscriptRequest };
export { buildJson3Url, currentVideoId, fetchCues, fetchTranscriptCues };

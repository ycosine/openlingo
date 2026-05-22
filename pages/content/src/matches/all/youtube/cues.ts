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

export type { Cue, FetchCuesOptions };
export { buildJson3Url, currentVideoId, fetchCues };

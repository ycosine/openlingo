import type { Cue } from './cues.js';
import type { AsrCommittedEvent } from '@extension/shared';

interface CreateAsrCueOptions {
  id: number;
  currentPlaybackTimeMs: number;
  filterAmbient: boolean;
}

const AMBIENT_ONLY_RE = /^\s*[(（[【].{1,40}[)）\]】]\s*$/;

const createAsrCue = (event: AsrCommittedEvent, options: CreateAsrCueOptions): Cue | null => {
  const text = event.text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (options.filterAmbient && AMBIENT_ONLY_RE.test(text)) return null;

  const timedWords = event.words.filter(
    word => typeof word.start === 'number' && typeof word.end === 'number' && word.type !== 'spacing',
  );
  const first = timedWords[0];
  const last = timedWords[timedWords.length - 1];
  const rate = event.playbackRate > 0 ? event.playbackRate : 1;
  const mappedStart = first
    ? event.anchorVideoTimeMs + first.start * 1000 * rate
    : Math.max(0, options.currentPlaybackTimeMs - 1800);
  const mappedEnd = last ? event.anchorVideoTimeMs + last.end * 1000 * rate : options.currentPlaybackTimeMs;

  return {
    id: options.id,
    startMs: Math.max(0, mappedStart),
    endMs: Math.max(mappedEnd, options.currentPlaybackTimeMs + 2800),
    text,
  };
};

const replaceOverlappingCues = (cues: Cue[], replacement: Cue): Cue[] =>
  [
    ...cues.filter(
      existing => existing.endMs <= replacement.startMs + 120 || existing.startMs >= replacement.endMs - 120,
    ),
    replacement,
  ].sort((a, b) => a.startMs - b.startMs);

/** Append a cue from the same ASR stream. Word timestamps within one stream are
 *  monotonic, so earlier cues only overlap through their display-extended endMs;
 *  trim that back instead of dropping the cue and losing its text. */
const appendSequentialCue = (cues: Cue[], next: Cue): Cue[] =>
  [
    ...cues.map(existing =>
      existing.endMs > next.startMs ? { ...existing, endMs: Math.max(existing.startMs, next.startMs) } : existing,
    ),
    next,
  ].sort((a, b) => a.startMs - b.startMs);

export type { CreateAsrCueOptions };
export { appendSequentialCue, createAsrCue, replaceOverlappingCues };

/**
 * Pure text helpers for the live (ASR) roll-up subtitle display.
 *
 * The live overlay renders a continuous transcript tail rather than isolated
 * cues, so everything here is a "keep the freshest end of a growing string"
 * operation: bounded tails that avoid cutting words mid-way, transcript joins
 * across the previous utterance, and picking a bounded slice of a partial
 * hypothesis for provisional translation.
 */

const SENTENCE_END_RE = /[.!?。！？…]/;

/** Last `maxChars` of `text`, preferring to start after a whitespace so the
 *  first visible word is whole. CJK has no spaces; fall back to a hard cut. */
const tailOnWordBoundary = (text: string, maxChars: number): string => {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(trimmed.length - maxChars);
  const firstSpace = slice.search(/\s/);
  if (firstSpace > -1 && firstSpace < Math.min(24, slice.length - 1)) {
    return slice.slice(firstSpace + 1).trimStart();
  }
  return slice;
};

/** Previous utterance + current utterance as one reading stream, bounded so
 *  per-frame layout stays cheap. The rolling window only shows the tail. */
const joinTranscriptTail = (previous: string, current: string, maxChars: number): string => {
  const prev = previous.trim();
  const cur = current.trim();
  const joined = prev && cur ? `${prev} ${cur}` : prev || cur;
  return tailOnWordBoundary(joined, maxChars);
};

/** Bounded slice of a growing ASR partial to send for provisional translation.
 *  When the tail had to be cut, prefer restarting after the last sentence break
 *  in its first half so the provider sees complete sentences where possible. */
const sliceForLiveTranslation = (partial: string, maxChars: number): string => {
  const trimmed = partial.trim();
  const tail = tailOnWordBoundary(trimmed, maxChars);
  if (tail.length === trimmed.length) return tail;
  const head = tail.slice(0, Math.floor(tail.length / 2));
  let cutIndex = -1;
  for (let i = 0; i < head.length; i++) {
    if (SENTENCE_END_RE.test(head[i])) cutIndex = i;
  }
  if (cutIndex > -1) {
    const rest = tail.slice(cutIndex + 1).trim();
    if (rest) return rest;
  }
  return tail;
};

export { joinTranscriptTail, sliceForLiveTranslation, tailOnWordBoundary };

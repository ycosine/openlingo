/**
 * @vitest-environment happy-dom
 */
import { orderCuesForTranslation } from './translate.js';
import { describe, expect, it } from 'vitest';
import type { Cue } from './cues.js';

const cues: Cue[] = [
  { id: 0, startMs: 0, endMs: 1_000, text: 'zero' },
  { id: 1, startMs: 1_100, endMs: 2_000, text: 'one' },
  { id: 2, startMs: 2_100, endMs: 3_000, text: 'two' },
  { id: 3, startMs: 3_100, endMs: 4_000, text: 'three' },
];

describe('orderCuesForTranslation', () => {
  it('keeps chronological order at the start of a video', () => {
    expect(orderCuesForTranslation(cues, 500).map(cue => cue.id)).toEqual([0, 1, 2, 3]);
  });

  it('prioritizes the current and upcoming cues before old cues', () => {
    expect(orderCuesForTranslation(cues, 2_500).map(cue => cue.id)).toEqual([2, 3, 0, 1]);
  });

  it('prioritizes the last cue when playback is past the final timestamp', () => {
    expect(orderCuesForTranslation(cues, 10_000).map(cue => cue.id)).toEqual([3, 0, 1, 2]);
  });
});

import { createAsrCue, replaceOverlappingCues } from './asr-cues.js';
import { describe, expect, it } from 'vitest';
import type { AsrCommittedEvent } from '@extension/shared';

const event = (patch: Partial<AsrCommittedEvent> = {}): AsrCommittedEvent => ({
  tabId: 1,
  videoId: 'video',
  sessionId: 'session',
  text: 'Hello world',
  words: [
    { text: 'Hello', start: 0.5, end: 0.9, type: 'word' },
    { text: ' ', start: 0.9, end: 1, type: 'spacing' },
    { text: 'world', start: 1, end: 1.5, type: 'word' },
  ],
  anchorVideoTimeMs: 10_000,
  playbackRate: 1,
  ...patch,
});

describe('createAsrCue', () => {
  it('maps ElevenLabs timestamps onto the YouTube playback timeline', () => {
    const cue = createAsrCue(event({ playbackRate: 1.5 }), {
      id: 4,
      currentPlaybackTimeMs: 12_500,
      filterAmbient: true,
    });
    expect(cue).toEqual({
      id: 4,
      startMs: 10_750,
      endMs: 15_300,
      text: 'Hello world',
    });
  });

  it('drops ambient-only segments when filtering is enabled', () => {
    const cue = createAsrCue(event({ text: '[music]' }), {
      id: 0,
      currentPlaybackTimeMs: 10_000,
      filterAmbient: true,
    });
    expect(cue).toBeNull();
  });

  it('keeps a committed cue visible after the delayed final result arrives', () => {
    const cue = createAsrCue(event(), {
      id: 0,
      currentPlaybackTimeMs: 20_000,
      filterAmbient: false,
    });
    expect(cue?.endMs).toBe(22_800);
  });
});

describe('replaceOverlappingCues', () => {
  it('replaces cues from an old ASR anchor while preserving other ranges', () => {
    const result = replaceOverlappingCues(
      [
        { id: 1, startMs: 1_000, endMs: 3_000, text: 'old' },
        { id: 2, startMs: 8_000, endMs: 10_000, text: 'later' },
      ],
      { id: 3, startMs: 1_500, endMs: 3_500, text: 'new' },
    );
    expect(result.map(cue => cue.id)).toEqual([3, 2]);
  });
});

import { joinTranscriptTail, sliceForLiveTranslation, tailOnWordBoundary } from './live-text.js';
import { describe, expect, it } from 'vitest';

describe('tailOnWordBoundary', () => {
  it('returns short text untouched', () => {
    expect(tailOnWordBoundary('hello world', 40)).toBe('hello world');
  });

  it('keeps the tail and drops the leading partial word', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const tail = tailOnWordBoundary(text, 20);
    expect(tail.length).toBeLessThanOrEqual(20);
    expect(text.endsWith(tail)).toBe(true);
    // Starts on a word boundary, not mid-word.
    expect(text[text.length - tail.length - 1]).toBe(' ');
  });

  it('hard-cuts spaceless CJK text', () => {
    const text = '这是一个没有空格的很长的中文句子需要被截断处理';
    const tail = tailOnWordBoundary(text, 10);
    expect(tail).toBe(text.slice(-10));
  });

  it('trims surrounding whitespace', () => {
    expect(tailOnWordBoundary('  hi  ', 40)).toBe('hi');
  });
});

describe('joinTranscriptTail', () => {
  it('joins previous and current with a space', () => {
    expect(joinTranscriptTail('first sentence.', 'second part', 100)).toBe('first sentence. second part');
  });

  it('handles empty previous or current', () => {
    expect(joinTranscriptTail('', 'only current', 100)).toBe('only current');
    expect(joinTranscriptTail('only previous', '', 100)).toBe('only previous');
  });

  it('bounds the joined stream to the freshest tail', () => {
    const prev = 'a'.repeat(300);
    const joined = joinTranscriptTail(prev, 'fresh words here', 40);
    expect(joined.length).toBeLessThanOrEqual(40);
    expect(joined.endsWith('fresh words here')).toBe(true);
  });
});

describe('sliceForLiveTranslation', () => {
  it('returns short partials unchanged', () => {
    expect(sliceForLiveTranslation('short partial', 100)).toBe('short partial');
  });

  it('restarts after a sentence break when the tail was cut', () => {
    const partial = `${'x'.repeat(100)} end of old sentence. This new sentence should be kept intact for translation`;
    const slice = sliceForLiveTranslation(partial, 90);
    expect(slice).toBe('This new sentence should be kept intact for translation');
  });

  it('falls back to the word-boundary tail when no sentence break exists', () => {
    const partial = 'word '.repeat(60).trim();
    const slice = sliceForLiveTranslation(partial, 50);
    expect(slice.length).toBeLessThanOrEqual(50);
    expect(slice.startsWith('word')).toBe(true);
  });
});

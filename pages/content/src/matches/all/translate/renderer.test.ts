/**
 * @vitest-environment happy-dom
 */
import { STYLE_ELEMENT_ID } from './constants.js';
import { ensureStyle, updateTranslationFont } from './renderer.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://openlingo/${path}`),
    },
  });
});

afterEach(() => {
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
  vi.unstubAllGlobals();
});

describe('translation typography', () => {
  it('uses the bundled Chinese font by default', () => {
    ensureStyle();

    const css = document.getElementById(STYLE_ELEMENT_ID)?.textContent ?? '';
    expect(css).toContain('chrome-extension://openlingo/options/fonts/LXGWWenKaiLite-Regular.ttf');
    expect(css).toContain('font-family: "OpenLingo LXGW WenKai Lite", "Kaiti SC", KaiTi, serif');
  });

  it('updates existing translations when the font setting changes', () => {
    ensureStyle('lxgw-wenkai-lite');
    const style = document.getElementById(STYLE_ELEMENT_ID);

    updateTranslationFont('sans');

    expect(document.getElementById(STYLE_ELEMENT_ID)).toBe(style);
    expect(style?.textContent).toContain(
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", sans-serif',
    );
  });
});

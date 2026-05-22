/**
 * Render translated cues as a second line below YouTube's native caption.
 *
 * We do *not* take over YouTube's caption rendering — fullscreen, theater
 * mode, picture-in-picture, custom font sizes, and YouTube's own caption
 * styling controls keep working unchanged. We just append a sibling element
 * inside each `.caption-window` and update it whenever the active cue
 * changes.
 */

import type { Cue } from './cues.js';
import type { CueTranslationMap } from './translate.js';
import type { SubtitleStyleType } from '@extension/storage';

const STYLE_TAG_ID = 'openlingo-yt-styles';
const TRANSLATION_CLASS = 'openlingo-yt-translation';

const STYLE_FONTS: Record<SubtitleStyleType, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Geist", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", monospace',
};

const STYLE_ITALIC: Record<SubtitleStyleType, string> = {
  serif: 'italic',
  sans: 'normal',
  mono: 'normal',
};

interface OverlayHandle {
  /** Replace the cue source (e.g. after a track switch). */
  setCues: (cues: Cue[], translations: CueTranslationMap) => void;
  /** Trigger a re-render — call when translations arrive. */
  refresh: () => void;
  /** Tear down — remove DOM nodes, disconnect observers. */
  destroy: () => void;
}

const ensureStyleTag = (preset: SubtitleStyleType): void => {
  const existing = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  const css = `
    .${TRANSLATION_CLASS} {
      display: block;
      margin-top: 2px;
      font-family: ${STYLE_FONTS[preset]};
      font-style: ${STYLE_ITALIC[preset]};
      font-size: 0.88em;
      line-height: 1.25;
      opacity: 0.92;
      color: inherit;
      text-shadow: 0 1px 2px rgba(0,0,0,0.55);
      letter-spacing: -0.005em;
    }
    .${TRANSLATION_CLASS}[data-pending="1"] {
      opacity: 0.55;
      font-style: italic;
    }
  `;
  if (existing) {
    existing.textContent = css;
    return;
  }
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
};

const findActiveCue = (cues: Cue[], timeMs: number): Cue | null => {
  // Cues are time-ordered; binary search would be tidier but cue counts are
  // small enough (a few hundred to a few thousand) that linear-from-last is
  // simpler and still O(1) amortised between adjacent ticks.
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (timeMs < c.startMs) return null;
    if (timeMs <= c.endMs + 80) return c;
  }
  return null;
};

const findCaptionWindows = (): HTMLElement[] => {
  const nodes = document.querySelectorAll<HTMLElement>('.caption-window');
  return Array.from(nodes);
};

const findVideoElement = (): HTMLVideoElement | null =>
  document.querySelector<HTMLVideoElement>('.html5-main-video, video.video-stream');

interface CreateOverlayOptions {
  cues: Cue[];
  translations: CueTranslationMap;
  subtitleStyle: SubtitleStyleType;
}

const createOverlay = (initial: CreateOverlayOptions): OverlayHandle => {
  let cues = initial.cues;
  let translations = initial.translations;
  let destroyed = false;

  ensureStyleTag(initial.subtitleStyle);

  const renderInto = (window: HTMLElement, cue: Cue | null): void => {
    let line = window.querySelector<HTMLElement>(`:scope > .${TRANSLATION_CLASS}`);
    if (!cue) {
      if (line) line.remove();
      return;
    }
    const translation = translations.get(cue.id);
    if (!line) {
      line = document.createElement('span');
      line.className = TRANSLATION_CLASS;
      window.appendChild(line);
    }
    if (translation) {
      line.removeAttribute('data-pending');
      if (line.textContent !== translation) line.textContent = translation;
    } else {
      // Translation not yet ready — show a soft hyphen so the layout shift is
      // minimal when the real text arrives.
      line.setAttribute('data-pending', '1');
      if (line.textContent !== '…') line.textContent = '…';
    }
  };

  const render = (): void => {
    if (destroyed) return;
    const video = findVideoElement();
    const timeMs = video ? video.currentTime * 1000 : 0;
    const cue = findActiveCue(cues, timeMs);
    const windows = findCaptionWindows();
    if (windows.length === 0) return;
    for (const w of windows) renderInto(w, cue);
  };

  // 1) Drive rendering off the video clock. timeupdate fires every ~250ms
  //    which is the natural cadence for caption switching.
  const video = findVideoElement();
  const onTime = () => render();
  if (video) {
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('seeking', onTime);
    video.addEventListener('seeked', onTime);
  }

  // 2) Watch the caption container for native cue changes (text edits inside
  //    an existing window, window creation on toggle, etc.). MutationObserver
  //    catches DOM mutations the video element doesn't know about.
  const container = document.querySelector<HTMLElement>('.ytp-caption-window-container') ?? document.body;
  const mo = new MutationObserver(() => render());
  mo.observe(container, { childList: true, subtree: true, characterData: true });

  render();

  return {
    setCues: (newCues, newTranslations) => {
      cues = newCues;
      translations = newTranslations;
      render();
    },
    refresh: () => render(),
    destroy: () => {
      destroyed = true;
      mo.disconnect();
      if (video) {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('seeking', onTime);
        video.removeEventListener('seeked', onTime);
      }
      // Clean up any lines we injected.
      document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(line => line.remove());
    },
  };
};

const updateOverlayStyle = (preset: SubtitleStyleType): void => {
  ensureStyleTag(preset);
};

export type { OverlayHandle, CreateOverlayOptions };
export { createOverlay, updateOverlayStyle };

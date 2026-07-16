/**
 * Render translated cues as an independent player overlay.
 *
 * The important bit here is ownership: YouTube owns `.caption-window`, so we
 * only read its text geometry and never write into it. Writing into that node
 * can make YouTube rebuild captions, which looks like repeated injection and
 * flicker during playback.
 */

import type { Cue } from './cues.js';
import type { CueTranslationMap } from './translate.js';
import type { SubtitleFontScaleType, SubtitleStyleType } from '@extension/storage';

const STYLE_TAG_ID = 'openlingo-yt-styles';
const ROOT_ID = 'openlingo-yt-overlay';
const ORIGINAL_CLASS = 'openlingo-yt-original';
const TRANSLATION_CLASS = 'openlingo-yt-translation';
type OverlayMode = 'native-translation' | 'standalone-bilingual';

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
  /** Replace the cue source, for example after a track switch. */
  setCues: (cues: Cue[], translations: CueTranslationMap) => void;
  /** Force a repaint on next frame; call when translations arrive. */
  refresh: () => void;
  /** Update the font-size multiplier without recreating the overlay. */
  setFontScale: (scale: SubtitleFontScaleType) => void;
  /** Temporary ASR hypothesis. It is replaced by a committed cue. */
  setPartialText: (text: string) => void;
  /** Tear down the independent overlay root and cancel the rAF loop. */
  destroy: () => void;
}

interface CreateOverlayOptions {
  cues: Cue[];
  translations: CueTranslationMap;
  subtitleStyle: SubtitleStyleType;
  fontScale: SubtitleFontScaleType;
  mode?: OverlayMode;
}

const ensureStyleTag = (preset: SubtitleStyleType): void => {
  const existing = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  const css = `
    #${ROOT_ID} {
      position: absolute;
      z-index: 62;
      pointer-events: none;
      display: none;
      left: 50%;
      top: 0;
      transform: translateX(-50%);
      max-width: 86%;
      box-sizing: border-box;
      text-align: center;
      contain: layout style paint;
    }
    #${ROOT_ID} .${TRANSLATION_CLASS} {
      display: inline;
      padding: 0 0.18em;
      border-radius: 2px;
      background: rgba(8, 8, 8, 0.72);
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
      font-family: ${STYLE_FONTS[preset]};
      font-style: ${STYLE_ITALIC[preset]};
      color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
      letter-spacing: 0;
      white-space: pre-wrap;
    }
    #${ROOT_ID} .${ORIGINAL_CLASS} {
      display: none;
      padding: 0 0.18em;
      border-radius: 2px;
      background: rgba(8, 8, 8, 0.78);
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
      font-family: Arial, Helvetica, sans-serif;
      font-style: normal;
      font-weight: 600;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      white-space: pre-wrap;
    }
    #${ROOT_ID}[data-mode="standalone-bilingual"] .${ORIGINAL_CLASS} {
      display: inline;
    }
    #${ROOT_ID}[data-mode="standalone-bilingual"] .${TRANSLATION_CLASS} {
      display: inline;
    }
    #${ROOT_ID} .openlingo-yt-line {
      min-height: 1em;
      margin-top: 0.2em;
    }
    #${ROOT_ID} .openlingo-yt-line:first-child {
      margin-top: 0;
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

/** Bidirectional linear scan from a hint index. O(1) amortized per frame. */
const findActiveCue = (cues: Cue[], timeMs: number, startHint: number): { cue: Cue | null; index: number } => {
  if (cues.length === 0) return { cue: null, index: 0 };
  let i = Math.max(0, Math.min(startHint, cues.length - 1));
  while (i > 0 && cues[i].startMs > timeMs) i--;
  while (i < cues.length && cues[i].endMs + 80 < timeMs) i++;
  const cue = cues[i];
  if (!cue || timeMs < cue.startMs) return { cue: null, index: i };
  return { cue, index: i };
};

const findVideoElement = (): HTMLVideoElement | null =>
  document.querySelector<HTMLVideoElement>('.html5-main-video, video.video-stream');

const findPlayerElement = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.html5-video-player, #movie_player');

const findCaptionWindows = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.caption-window')).filter(window => {
    const rect = window.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

const pickCaptionWindow = (windows: HTMLElement[]): HTMLElement | null => {
  if (windows.length === 0) return null;
  return windows.reduce((best, current) => {
    const bestRect = best.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    return currentRect.bottom >= bestRect.bottom ? current : best;
  });
};

const ensureRoot = (): HTMLElement | null => {
  const player = findPlayerElement();
  if (!player) return null;

  let root = document.getElementById(ROOT_ID) as HTMLElement | null;
  if (root && root.parentElement !== player) {
    root.remove();
    root = null;
  }
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    const originalLine = document.createElement('div');
    originalLine.className = 'openlingo-yt-line';
    const original = document.createElement('span');
    original.className = ORIGINAL_CLASS;
    originalLine.appendChild(original);
    const translationLine = document.createElement('div');
    translationLine.className = 'openlingo-yt-line';
    const translation = document.createElement('span');
    translation.className = TRANSLATION_CLASS;
    translationLine.appendChild(translation);
    root.append(originalLine, translationLine);
    player.appendChild(root);
  }
  return root;
};

const hideRoot = (root: HTMLElement | null): void => {
  if (root && root.style.display !== 'none') root.style.display = 'none';
};

const syncRootPosition = (root: HTMLElement, captionWindow: HTMLElement, fontScale: number): void => {
  const player = findPlayerElement();
  if (!player) return;

  const playerRect = player.getBoundingClientRect();
  const captionRect = captionWindow.getBoundingClientRect();
  const segment = captionWindow.querySelector<HTMLElement>('.ytp-caption-segment') ?? captionWindow;
  const segmentStyle = window.getComputedStyle(segment);

  const segmentFontPx = parseFloat(segmentStyle.fontSize) || 16;
  root.style.fontSize = `${segmentFontPx * fontScale}px`;
  root.style.lineHeight = segmentStyle.lineHeight;
  root.style.fontWeight = segmentStyle.fontWeight;
  root.style.maxWidth = `${Math.min(Math.max(captionRect.width * 1.35, 360), playerRect.width * 0.86)}px`;
  root.style.display = 'block';

  const rootRect = root.getBoundingClientRect();
  const controlsReserve = player.classList.contains('ytp-autohide') ? 18 : 58;
  const belowTop = captionRect.bottom - playerRect.top + 6;
  const maxBelowTop = playerRect.height - rootRect.height - controlsReserve;
  const aboveTop = captionRect.top - playerRect.top - rootRect.height - 6;
  const top = belowTop <= maxBelowTop ? belowTop : Math.max(0, aboveTop);
  const centerX = captionRect.left - playerRect.left + captionRect.width / 2;
  const minCenter = rootRect.width / 2 + 12;
  const maxCenter = playerRect.width - rootRect.width / 2 - 12;
  root.style.left = `${Math.min(Math.max(centerX, minCenter), maxCenter)}px`;
  root.style.top = `${top}px`;
};

const syncStandalonePosition = (root: HTMLElement, fontScale: number): void => {
  const player = findPlayerElement();
  if (!player) return;
  const playerRect = player.getBoundingClientRect();
  const baseFont = Math.min(27, Math.max(15, playerRect.width * 0.021));
  root.style.fontSize = `${baseFont * fontScale}px`;
  root.style.lineHeight = '1.35';
  root.style.fontWeight = '600';
  root.style.maxWidth = `${playerRect.width * 0.86}px`;
  root.style.left = '50%';
  root.style.top = 'auto';
  root.style.bottom = player.classList.contains('ytp-autohide') ? '5.5%' : '72px';
  root.style.display = 'block';
};

const createOverlay = (initial: CreateOverlayOptions): OverlayHandle => {
  let cues = initial.cues;
  let translations = initial.translations;
  let fontScale: number = initial.fontScale;
  const mode: OverlayMode = initial.mode ?? 'native-translation';
  let partialText = '';
  let destroyed = false;
  let cueIndexHint = 0;
  let lastRenderedCueId: number | null = -1;
  let lastRenderedText = '';
  let rafId = 0;

  ensureStyleTag(initial.subtitleStyle);

  const writeText = (root: HTMLElement, original: string, translation: string): void => {
    const originalLine = root.querySelector<HTMLElement>(`.${ORIGINAL_CLASS}`);
    const translationLine = root.querySelector<HTMLElement>(`.${TRANSLATION_CLASS}`);
    if (originalLine && originalLine.textContent !== original) originalLine.textContent = original;
    if (translationLine && translationLine.textContent !== translation) translationLine.textContent = translation;
    const originalWrap = originalLine?.parentElement;
    const translationWrap = translationLine?.parentElement;
    if (originalWrap) originalWrap.style.display = original ? 'block' : 'none';
    if (translationWrap) translationWrap.style.display = translation ? 'block' : 'none';
  };

  const tick = (): void => {
    if (destroyed) return;
    rafId = requestAnimationFrame(tick);

    const root = ensureRoot();
    if (!root) return;
    root.dataset.mode = mode;

    let captionWindow: HTMLElement | null = null;
    if (mode === 'native-translation') {
      captionWindow = pickCaptionWindow(findCaptionWindows());
      if (!captionWindow) {
        hideRoot(root);
        lastRenderedCueId = -1;
        lastRenderedText = '';
        return;
      }
    }

    const video = findVideoElement();
    const timeMs = video ? video.currentTime * 1000 : 0;
    const { cue, index } = findActiveCue(cues, timeMs, cueIndexHint);
    cueIndexHint = index;

    if (!cue && !partialText) {
      hideRoot(root);
      lastRenderedCueId = null;
      lastRenderedText = '';
      return;
    }

    const original = partialText || cue?.text || '';
    const translation = partialText || !cue ? '' : (translations.get(cue.id)?.trim() ?? '');
    if (mode === 'native-translation' && !translation) {
      hideRoot(root);
      lastRenderedCueId = cue?.id ?? null;
      lastRenderedText = '';
      return;
    }

    const stateKey = `${original}\n${translation}`;
    const stateChanged = (cue?.id ?? null) !== lastRenderedCueId || stateKey !== lastRenderedText;
    if (stateChanged) {
      writeText(root, mode === 'standalone-bilingual' ? original : '', translation);
      lastRenderedCueId = cue?.id ?? null;
      lastRenderedText = stateKey;
    }
    if (mode === 'standalone-bilingual') syncStandalonePosition(root, fontScale);
    else if (captionWindow) syncRootPosition(root, captionWindow, fontScale);
  };

  rafId = requestAnimationFrame(tick);

  return {
    setCues: (newCues, newTranslations) => {
      cues = newCues;
      translations = newTranslations;
      cueIndexHint = 0;
      lastRenderedCueId = -1;
      lastRenderedText = '';
    },
    refresh: () => {
      lastRenderedCueId = -1;
      lastRenderedText = '';
    },
    setFontScale: scale => {
      fontScale = scale;
    },
    setPartialText: text => {
      partialText = text.trim();
      lastRenderedCueId = -1;
      lastRenderedText = '';
    },
    destroy: () => {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      document.getElementById(ROOT_ID)?.remove();
    },
  };
};

const updateOverlayStyle = (preset: SubtitleStyleType): void => {
  ensureStyleTag(preset);
};

export type { OverlayHandle, CreateOverlayOptions, OverlayMode };
export { createOverlay, updateOverlayStyle };

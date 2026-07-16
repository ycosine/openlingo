/**
 * Render translated cues as an independent player overlay.
 *
 * The important bit here is ownership: YouTube owns `.caption-window`, so we
 * only read its text geometry and never write into it. Writing into that node
 * can make YouTube rebuild captions, which looks like repeated injection and
 * flicker during playback.
 */

import { joinTranscriptTail } from './live-text.js';
import type { Cue } from './cues.js';
import type { CueTranslationMap } from './translate.js';
import type { SubtitleFontScaleType, SubtitleStyleType } from '@extension/storage';

const STYLE_TAG_ID = 'openlingo-yt-styles';
const ROOT_ID = 'openlingo-yt-overlay';
const ORIGINAL_CLASS = 'openlingo-yt-original';
const TRANSLATION_CLASS = 'openlingo-yt-translation';
type OverlayMode = 'native-translation' | 'standalone-bilingual';

const STYLE_FONTS: Record<SubtitleStyleType, string> = {
  wenkai: '"OpenLingo LXGW WenKai Lite", "Kaiti SC", KaiTi, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Geist", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", monospace',
};

const STYLE_ITALIC: Record<SubtitleStyleType, string> = {
  wenkai: 'normal',
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
  /**
   * Provisional translation of the newest utterance. `cueId` is null while the
   * utterance is still a streaming partial and becomes the committed cue's id
   * once it lands, so the renderer knows which slot the text belongs to.
   */
  setLiveTranslation: (text: string, cueId: number | null) => void;
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
    @font-face {
      font-family: "OpenLingo LXGW WenKai Lite";
      src: url("${chrome.runtime.getURL('options/fonts/LXGWWenKaiLite-Regular.woff2')}") format("woff2");
      font-style: normal;
      font-weight: 400;
      font-display: swap;
    }
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
      /* CJK glyphs read larger than Latin at equal px; render the translated
         line slightly smaller than the platform caption size. */
      font-size: 0.9em;
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
    /* Live text must not re-center on every appended word: readers track a
       stable left anchor while new words appear at the tail, broadcast-style. */
    #${ROOT_ID}[data-mode="standalone-bilingual"] {
      text-align: left;
    }
    /* Roll-up window: a fixed two-line viewport over a growing scroller. The
       scroller is translated up so the newest words are always visible; the
       max-height is set from the resolved line-height each frame. */
    #${ROOT_ID} .openlingo-yt-line {
      margin-top: 0.2em;
      overflow: hidden;
    }
    #${ROOT_ID} .openlingo-yt-line:first-child {
      margin-top: 0;
    }
    #${ROOT_ID} .openlingo-yt-scroll {
      transition: transform 180ms ease-out;
      will-change: transform;
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

/** Most recent cue that has already started. Lets the bilingual overlay keep
 *  showing the previous sentence's translation while a new partial streams. */
const findLatestStartedCue = (cues: Cue[], timeMs: number): Cue | null => {
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i].startMs <= timeMs) return cues[i];
  }
  return null;
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
    const buildLine = (spanClass: string): HTMLElement => {
      const line = document.createElement('div');
      line.className = 'openlingo-yt-line';
      const scroller = document.createElement('div');
      scroller.className = 'openlingo-yt-scroll';
      const span = document.createElement('span');
      span.className = spanClass;
      scroller.appendChild(span);
      line.appendChild(scroller);
      return line;
    };
    root.append(buildLine(ORIGINAL_CLASS), buildLine(TRANSLATION_CLASS));
    player.appendChild(root);
  }
  return root;
};

/** Lines the roll-up viewport shows before older text scrolls out. */
const MAX_VISIBLE_LINES = 2;

/** Pin the viewport to MAX_VISIBLE_LINES and translate the scroller so the
 *  freshest words sit at the bottom edge. Rolling up (content grew) animates;
 *  a shrink means the text was replaced, so it snaps instead of sliding down. */
const syncRollingWindow = (line: HTMLElement, lineHeightPx: number): void => {
  const scroller = line.firstElementChild as HTMLElement | null;
  if (!scroller) return;
  const maxHeight = `${Math.ceil(lineHeightPx * MAX_VISIBLE_LINES) + 1}px`;
  if (line.style.maxHeight !== maxHeight) line.style.maxHeight = maxHeight;
  const overflow = Math.max(0, scroller.scrollHeight - line.clientHeight);
  const previous = Number(scroller.dataset.rollOffset ?? '0');
  if (Math.abs(overflow - previous) < 1) return;
  scroller.style.transition = overflow > previous ? '' : 'none';
  scroller.style.transform = overflow > 0 ? `translateY(-${overflow}px)` : '';
  scroller.dataset.rollOffset = String(overflow);
};

const syncRollingWindows = (root: HTMLElement): void => {
  const lineHeightPx = parseFloat(window.getComputedStyle(root).lineHeight);
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return;
  root.querySelectorAll<HTMLElement>('.openlingo-yt-line').forEach(line => {
    if (line.style.display !== 'none') syncRollingWindow(line, lineHeightPx);
  });
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
  root.style.width = '';
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
  const baseFont = Math.min(24, Math.max(14, playerRect.width * 0.019));
  const fontPx = baseFont * fontScale;
  root.style.fontSize = `${fontPx}px`;
  root.style.lineHeight = '1.35';
  root.style.fontWeight = '600';
  // Fixed width (not max-width): live text left-aligns inside a stable block
  // so already-rendered words never rewrap when new ones stream in.
  root.style.width = `${Math.min(playerRect.width * 0.86, fontPx * 30)}px`;
  root.style.maxWidth = '';
  root.style.left = '50%';
  root.style.top = 'auto';
  root.style.bottom = player.classList.contains('ytp-autohide') ? '5.5%' : '72px';
  root.style.display = 'block';
};

/** Bound on the transcript-tail strings handed to layout each frame. The
 *  rolling window only ever shows the last two lines of this. */
const STREAM_TAIL_CHARS = 320;
/** Ignore an earlier utterance as reading context once it ended this long ago. */
const CONTEXT_WINDOW_MS = 6000;

const cueBefore = (cues: Cue[], target: Cue): Cue | null => {
  const index = cues.indexOf(target);
  return index > 0 ? cues[index - 1] : null;
};

const createOverlay = (initial: CreateOverlayOptions): OverlayHandle => {
  let cues = initial.cues;
  let translations = initial.translations;
  let fontScale: number = initial.fontScale;
  const mode: OverlayMode = initial.mode ?? 'native-translation';
  let partialText = '';
  let liveTranslation = '';
  let liveTranslationCueId: number | null = null;
  let destroyed = false;
  let cueIndexHint = 0;
  let lastRenderedCueId: number | null = -1;
  let lastRenderedText = '';
  let rafId = 0;

  ensureStyleTag(initial.subtitleStyle);

  const writeText = (root: HTMLElement, original: string, translation: string): void => {
    const originalSpan = root.querySelector<HTMLElement>(`.${ORIGINAL_CLASS}`);
    const translationSpan = root.querySelector<HTMLElement>(`.${TRANSLATION_CLASS}`);
    if (originalSpan && originalSpan.textContent !== original) originalSpan.textContent = original;
    if (translationSpan && translationSpan.textContent !== translation) translationSpan.textContent = translation;
    const originalWrap = originalSpan?.closest<HTMLElement>('.openlingo-yt-line');
    const translationWrap = translationSpan?.closest<HTMLElement>('.openlingo-yt-line');
    if (originalWrap) originalWrap.style.display = original ? '' : 'none';
    if (translationWrap) translationWrap.style.display = translation ? '' : 'none';
  };

  /** Translation slot for a committed cue: prefer the streamed/final result,
   *  but keep the longer provisional until the real one catches up so the
   *  line never restarts from empty right after a commit. */
  const translationForCue = (cueId: number): string => {
    const committed = translations.get(cueId)?.trim() ?? '';
    const provisional = liveTranslationCueId === cueId ? liveTranslation : '';
    return committed.length >= provisional.length ? committed : provisional;
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

    let original = '';
    let translation = '';
    if (mode === 'standalone-bilingual') {
      // Two utterance slots rendered as one continuous stream: the previous
      // utterance stays as reading context while the current one (a streaming
      // partial, or the just-committed cue) grows at the tail. The roll-up
      // window shows the last two lines of the joined text.
      const current = partialText ? null : cue;
      const previous = partialText ? findLatestStartedCue(cues, timeMs) : current ? cueBefore(cues, current) : null;
      const previousRecent = !!previous && timeMs - previous.endMs < CONTEXT_WINDOW_MS;
      const currentText = partialText || current?.text || '';
      original = joinTranscriptTail(previousRecent ? previous.text : '', currentText, STREAM_TAIL_CHARS);

      const currentTranslation = partialText
        ? liveTranslationCueId === null
          ? liveTranslation
          : ''
        : current
          ? translationForCue(current.id)
          : '';
      const previousTranslation = previousRecent ? translationForCue(previous.id) : '';
      translation = joinTranscriptTail(previousTranslation, currentTranslation, STREAM_TAIL_CHARS);
    } else {
      translation = partialText || !cue ? '' : (translations.get(cue.id)?.trim() ?? '');
      if (!translation) {
        hideRoot(root);
        lastRenderedCueId = cue?.id ?? null;
        lastRenderedText = '';
        return;
      }
    }

    const stateKey = `${original}\n${translation}`;
    const stateChanged = (cue?.id ?? null) !== lastRenderedCueId || stateKey !== lastRenderedText;
    if (stateChanged) {
      writeText(root, original, translation);
      lastRenderedCueId = cue?.id ?? null;
      lastRenderedText = stateKey;
    }
    if (mode === 'standalone-bilingual') syncStandalonePosition(root, fontScale);
    else if (captionWindow) syncRootPosition(root, captionWindow, fontScale);
    syncRollingWindows(root);
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
    setLiveTranslation: (text, cueId) => {
      liveTranslation = text.trim();
      liveTranslationCueId = cueId;
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

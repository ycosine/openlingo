/**
 * YouTube bilingual-subtitles entry point.
 *
 * Lifecycle:
 *   - Settings change → re-evaluate whether to attach.
 *   - SPA navigation (`yt-navigate-finish`) → tear down + re-attach.
 *   - `YT_TIMEDTEXT_URL` message arrives from background → refetch as JSON3,
 *     translate via existing pipeline, render translations below native cues.
 *
 * The translation pipeline (batching, caching, multi-provider) is reused
 * via the same `TR_TRANSLATE_BATCH` message page translation already uses —
 * with a session id namespace so the two flows don't collide.
 */

import { currentVideoId, fetchCues } from './cues.js';
import { createOverlay, updateOverlayStyle } from './overlay.js';
import { startCueTranslation } from './translate.js';
import { translationSettingsStorage } from '@extension/storage';
import type { Cue } from './cues.js';
import type { OverlayHandle } from './overlay.js';
import type { TranslateSession } from './translate.js';
import type { VideoSubtitlesSettingsType } from '@extension/storage';

interface TimedtextMessage {
  type: 'YT_TIMEDTEXT_URL';
  url: string;
}

interface ActiveSession {
  videoId: string;
  trackKey: string; // dedupes timedtext URLs for the same track
  cues: Cue[];
  translateSession: TranslateSession;
  overlay: OverlayHandle | null;
  abortFetch: AbortController;
}

let attached = false;
let active: ActiveSession | null = null;
let lastSettings: VideoSubtitlesSettingsType | null = null;
let lastNavVideoId: string | null = null;

const isYouTubeHost = (): boolean => /(^|\.)youtube\.com$/.test(location.hostname);

const trackKeyFor = (url: string): string => {
  try {
    const u = new URL(url, 'https://www.youtube.com');
    const lang = u.searchParams.get('lang') ?? '';
    const name = u.searchParams.get('name') ?? '';
    const kind = u.searchParams.get('kind') ?? '';
    const v = u.searchParams.get('v') ?? '';
    return `${v}|${lang}|${name}|${kind}`;
  } catch {
    return url;
  }
};

const cancelActive = (): void => {
  if (!active) return;
  active.abortFetch.abort();
  active.translateSession.cancel();
  active.overlay?.destroy();
  active = null;
};

const shouldEngage = (settings: VideoSubtitlesSettingsType): boolean =>
  settings.enabled && settings.youtubeAutoEnable && settings.youtubeTranslate;

const handleTimedtextUrl = async (url: string): Promise<void> => {
  if (!lastSettings) return;
  if (!shouldEngage(lastSettings)) return;
  const videoId = currentVideoId();
  if (!videoId) return;

  const key = trackKeyFor(url);
  if (active && active.trackKey === key && active.videoId === videoId) return;

  cancelActive();

  const abortFetch = new AbortController();
  let cues: Cue[];
  try {
    cues = await fetchCues(url, {
      filterAmbient: lastSettings.filterAmbient,
      basicSegmentation: lastSettings.youtubeBasicSegmentation,
      signal: abortFetch.signal,
    });
  } catch (err) {
    if (!abortFetch.signal.aborted) {
      console.warn('[OpenLingo] Failed to fetch YouTube cues', err);
    }
    return;
  }

  if (cues.length === 0) return;

  const translateSession = startCueTranslation(cues);
  const overlay = createOverlay({
    cues,
    translations: translateSession.translations,
    subtitleStyle: lastSettings.subtitleStyle,
  });
  translateSession.onUpdate(() => overlay.refresh());
  translateSession.finished.then(res => {
    if (!res.ok && res.error && res.error !== 'cancelled') {
      console.warn('[OpenLingo] YouTube subtitle translation:', res.error);
    }
  });

  active = { videoId, trackKey: key, cues, translateSession, overlay, abortFetch };
};

const onRuntimeMessage = (msg: unknown): void => {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
  if ((msg as { type: string }).type !== 'YT_TIMEDTEXT_URL') return;
  void handleTimedtextUrl((msg as TimedtextMessage).url);
};

const onNavigate = (): void => {
  const vid = currentVideoId();
  if (vid === lastNavVideoId) return;
  lastNavVideoId = vid;
  cancelActive();
};

const applySettings = (settings: VideoSubtitlesSettingsType): void => {
  const previous = lastSettings;
  lastSettings = settings;
  if (!shouldEngage(settings)) {
    cancelActive();
    return;
  }
  if (previous && previous.subtitleStyle !== settings.subtitleStyle) {
    updateOverlayStyle(settings.subtitleStyle);
  }
};

export const initYouTubeSubtitles = (): void => {
  if (attached) return;
  if (!isYouTubeHost()) return;
  attached = true;

  void translationSettingsStorage.get().then(s => applySettings(s.videoSubtitles));
  translationSettingsStorage.subscribe(() => {
    const snap = translationSettingsStorage.getSnapshot();
    if (snap) applySettings(snap.videoSubtitles);
  });

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  document.addEventListener('yt-navigate-finish', onNavigate, true);
  // Some SPA transitions only emit yt-page-data-updated; both as a belt+braces.
  document.addEventListener('yt-page-data-updated', onNavigate, true);

  lastNavVideoId = currentVideoId();
};

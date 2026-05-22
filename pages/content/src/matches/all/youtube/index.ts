/**
 * YouTube bilingual-subtitles entry point.
 *
 * Lifecycle:
 *   - Mount the OL player button as soon as the player exists.
 *   - On `YT_TIMEDTEXT_URL` (from background webRequest), refetch the track
 *     as JSON3 and start a translation session.
 *   - On `yt-navigate-finish`, tear everything down so the new video gets a
 *     fresh session.
 *
 * The translation pipeline (batching, caching, multi-provider) is reused via
 * the existing `TR_TRANSLATE_BATCH` message — with a session id namespace so
 * the two flows don't collide.
 */

import { currentVideoId, fetchCues } from './cues.js';
import { createOverlay, updateOverlayStyle } from './overlay.js';
import { createPlayerButton } from './player-button.js';
import { startCueTranslation } from './translate.js';
import { translationSettingsStorage } from '@extension/storage';
import type { Cue } from './cues.js';
import type { OverlayHandle } from './overlay.js';
import type { ButtonState, PlayerButtonHandle, Status } from './player-button.js';
import type { TranslateSession } from './translate.js';
import type { VideoSubtitlesSettingsType } from '@extension/storage';

interface TimedtextMessage {
  type: 'YT_TIMEDTEXT_URL';
  url: string;
}

interface CaptionTrackName {
  simpleText?: string;
  runs?: Array<{ text?: string }>;
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: CaptionTrackName;
  isTranslatable?: boolean;
}

type ActiveSessionStatus = 'fetching' | 'translating' | 'translated' | 'no-cues' | 'error';

interface ActiveSession {
  videoId: string;
  trackKey: string;
  status: ActiveSessionStatus;
  cues: Cue[];
  translateSession: TranslateSession | null;
  overlay: OverlayHandle | null;
  abortFetch: AbortController;
}

interface YouTubeSubtitlesGlobal {
  destroy: () => void;
}

let attached = false;
let active: ActiveSession | null = null;
let button: PlayerButtonHandle | null = null;
let lastSettings: VideoSubtitlesSettingsType | null = null;
let lastNavVideoId: string | null = null;
/** Per-tab override: if the user toggles off via the player menu, stay off
 *  until they toggle it back on or navigate to a new video. */
let perVideoEnabled = true;
let perVideoId: string | null = null;
let lastTimedtextUrl: string | null = null;
let trackDiscoveryTimer: number | null = null;
let trackDiscoveryAttempts = 0;
let unsubscribeSettings: (() => void) | null = null;

const GLOBAL_KEY = '__openlingoYouTubeSubtitles';
const MAX_TRACK_DISCOVERY_ATTEMPTS = 8;

type YouTubeSubtitlesWindow = Window & { [GLOBAL_KEY]?: YouTubeSubtitlesGlobal };

const getGlobal = (): YouTubeSubtitlesWindow => window as unknown as YouTubeSubtitlesWindow;

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

const clearTrackDiscovery = (): void => {
  if (trackDiscoveryTimer !== null) {
    window.clearTimeout(trackDiscoveryTimer);
    trackDiscoveryTimer = null;
  }
};

const extractJsonArray = (text: string, marker: string): string | null => {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf('[', markerIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const isCaptionTrack = (track: unknown): track is CaptionTrack =>
  !!track && typeof track === 'object' && typeof (track as CaptionTrack).baseUrl === 'string';

const readCaptionTracksFromPage = (): CaptionTrack[] => {
  const tracks: CaptionTrack[] = [];
  for (const script of Array.from(document.scripts)) {
    const text = script.textContent ?? '';
    if (!text.includes('"captionTracks"')) continue;
    const json = extractJsonArray(text, '"captionTracks"');
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as unknown;
      if (Array.isArray(parsed)) tracks.push(...parsed.filter(isCaptionTrack));
    } catch {
      // Some YouTube script blobs contain non-JSON snippets; skip and keep scanning.
    }
  }
  return tracks;
};

const trackMatchesCurrentVideo = (track: CaptionTrack, videoId: string): boolean => {
  try {
    const url = new URL(track.baseUrl ?? '', 'https://www.youtube.com');
    const trackVideoId = url.searchParams.get('v');
    return !trackVideoId || trackVideoId === videoId;
  } catch {
    return true;
  }
};

const pickCaptionTrackUrl = (): string | null => {
  const videoId = currentVideoId();
  if (!videoId) return null;
  const tracks = readCaptionTracksFromPage().filter(track => trackMatchesCurrentVideo(track, videoId));
  if (tracks.length === 0) return null;
  const preferred = lastSettings?.preferHumanCaptions
    ? (tracks.find(track => track.kind !== 'asr') ?? tracks[0])
    : tracks[0];
  return preferred.baseUrl ?? null;
};

const scheduleTrackDiscovery = (delayMs = 700): void => {
  if (!attached || !lastSettings || !featureOn(lastSettings) || !perVideoEnabled || active) return;
  clearTrackDiscovery();
  trackDiscoveryTimer = window.setTimeout(() => {
    trackDiscoveryTimer = null;
    if (!attached || !lastSettings || !featureOn(lastSettings) || !perVideoEnabled || active) return;

    const discoveredUrl = pickCaptionTrackUrl();
    if (discoveredUrl) {
      trackDiscoveryAttempts = 0;
      lastTimedtextUrl = discoveredUrl;
      void beginTranslation(discoveredUrl);
      return;
    }

    trackDiscoveryAttempts += 1;
    if (trackDiscoveryAttempts < MAX_TRACK_DISCOVERY_ATTEMPTS) {
      scheduleTrackDiscovery(900);
    }
  }, delayMs);
};

const cancelActive = (): void => {
  if (!active) return;
  active.abortFetch.abort();
  active.translateSession?.cancel();
  active.overlay?.destroy();
  active = null;
};

const featureOn = (settings: VideoSubtitlesSettingsType): boolean =>
  settings.enabled && settings.youtubeAutoEnable && settings.youtubeTranslate;

const setButtonStatus = (status: Status, opts: { statusText?: string; errorMessage?: string } = {}): void => {
  if (!button) return;
  const patch: Partial<ButtonState> = {
    enabled: !!(lastSettings && featureOn(lastSettings) && perVideoEnabled),
    status,
  };
  if (opts.statusText !== undefined) patch.statusText = opts.statusText;
  if (opts.errorMessage !== undefined) patch.errorMessage = opts.errorMessage;
  button.setState(patch);
};

const statusForActive = (): Status => {
  if (!active) return 'idle';
  if (active.status === 'error') return 'error';
  if (active.status === 'no-cues') return 'no-cues';
  if (active.status === 'translated') return 'translated';
  return 'translating';
};

const beginTranslation = async (url: string): Promise<void> => {
  if (!lastSettings) return;
  if (!featureOn(lastSettings) || !perVideoEnabled) return;

  const videoId = currentVideoId();
  if (!videoId) return;

  const key = trackKeyFor(url);
  if (active && active.trackKey === key && active.videoId === videoId) return;

  clearTrackDiscovery();
  cancelActive();
  setButtonStatus('translating', { statusText: '', errorMessage: '' });

  const abortFetch = new AbortController();
  const session: ActiveSession = {
    videoId,
    trackKey: key,
    status: 'fetching',
    cues: [],
    translateSession: null,
    overlay: null,
    abortFetch,
  };
  active = session;

  let cues: Cue[];
  try {
    cues = await fetchCues(url, {
      filterAmbient: lastSettings.filterAmbient,
      basicSegmentation: lastSettings.youtubeBasicSegmentation,
      signal: abortFetch.signal,
    });
  } catch (err) {
    if (abortFetch.signal.aborted) return;
    if (active === session) active = null;
    console.warn('[OpenLingo] Failed to fetch YouTube cues', err);
    setButtonStatus('error', { errorMessage: (err as Error).message });
    return;
  }

  if (active !== session || abortFetch.signal.aborted) return;

  if (cues.length === 0) {
    session.status = 'no-cues';
    setButtonStatus('no-cues');
    return;
  }

  const translateSession = startCueTranslation(cues);
  const overlay = createOverlay({
    cues,
    translations: translateSession.translations,
    subtitleStyle: lastSettings.subtitleStyle,
  });
  session.status = 'translating';
  session.cues = cues;
  session.translateSession = translateSession;
  session.overlay = overlay;

  translateSession.onUpdate(() => {
    if (active !== session) return;
    overlay.refresh();
    const ready = translateSession.translations.size;
    if (ready >= cues.length) session.status = 'translated';
    setButtonStatus(ready >= cues.length ? 'translated' : 'translating', {
      statusText: `${ready} / ${cues.length} cues`,
    });
  });
  void translateSession.finished.then(res => {
    if (active !== session) return;
    if (res.ok) {
      session.status = 'translated';
      setButtonStatus('translated', { statusText: `${cues.length} cues` });
    } else if (res.error && res.error !== 'cancelled') {
      session.status = 'error';
      console.warn('[OpenLingo] YouTube subtitle translation:', res.error);
      setButtonStatus('error', { errorMessage: res.error });
    }
  });

  setButtonStatus('translating', { statusText: `0 / ${cues.length} cues` });
};

const onRuntimeMessage = (msg: unknown): void => {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
  if ((msg as { type: string }).type !== 'YT_TIMEDTEXT_URL') return;
  const url = (msg as TimedtextMessage).url;
  clearTrackDiscovery();
  trackDiscoveryAttempts = 0;
  lastTimedtextUrl = url;
  void beginTranslation(url);
};

const onNavigate = (): void => {
  const vid = currentVideoId();
  if (vid === lastNavVideoId) {
    scheduleTrackDiscovery(300);
    return;
  }
  lastNavVideoId = vid;
  clearTrackDiscovery();
  trackDiscoveryAttempts = 0;
  cancelActive();
  if (vid !== perVideoId) {
    perVideoId = vid;
    perVideoEnabled = true;
  }
  lastTimedtextUrl = null;
  setButtonStatus('idle', { statusText: '', errorMessage: '' });
  scheduleTrackDiscovery();
};

const onTogglePerVideo = (enabled: boolean): void => {
  perVideoEnabled = enabled;
  if (!enabled) {
    clearTrackDiscovery();
    cancelActive();
    setButtonStatus('idle', { statusText: '', errorMessage: '' });
    return;
  }
  if (lastTimedtextUrl) {
    void beginTranslation(lastTimedtextUrl);
  } else {
    trackDiscoveryAttempts = 0;
    setButtonStatus('idle', { statusText: 'Finding captions' });
    scheduleTrackDiscovery(0);
  }
};

const onOpenOptions = (): void => {
  chrome.runtime.sendMessage({ type: 'OL_OPEN_OPTIONS' }).catch(() => undefined);
};

const ensureButton = (): void => {
  if (button) return;
  button = createPlayerButton(
    { onToggleEnabled: onTogglePerVideo, onOpenOptions },
    {
      enabled: !!(lastSettings && featureOn(lastSettings) && perVideoEnabled),
      status: 'idle',
      statusText: '',
    },
  );
};

const applySettings = (settings: VideoSubtitlesSettingsType): void => {
  const previous = lastSettings;
  lastSettings = settings;
  if (previous && previous.subtitleStyle !== settings.subtitleStyle) {
    updateOverlayStyle(settings.subtitleStyle);
  }
  if (!featureOn(settings)) {
    clearTrackDiscovery();
    cancelActive();
    setButtonStatus('idle', { statusText: '', errorMessage: '' });
    return;
  }
  setButtonStatus(statusForActive());
  scheduleTrackDiscovery();
};

const initYouTubeSubtitles = (): void => {
  if (attached) return;
  if (!isYouTubeHost()) return;
  getGlobal()[GLOBAL_KEY]?.destroy();
  attached = true;

  void translationSettingsStorage.get().then(s => {
    if (!attached) return;
    applySettings(s.videoSubtitles);
    ensureButton();
    scheduleTrackDiscovery();
  });
  unsubscribeSettings = translationSettingsStorage.subscribe(() => {
    const snap = translationSettingsStorage.getSnapshot();
    if (snap) applySettings(snap.videoSubtitles);
  });

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  document.addEventListener('yt-navigate-finish', onNavigate, true);
  document.addEventListener('yt-page-data-updated', onNavigate, true);

  lastNavVideoId = currentVideoId();
  perVideoId = lastNavVideoId;
  getGlobal()[GLOBAL_KEY] = { destroy: destroyYouTubeSubtitles };
};

const destroyYouTubeSubtitles = (): void => {
  if (!attached) return;
  cancelActive();
  button?.destroy();
  button = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  document.removeEventListener('yt-navigate-finish', onNavigate, true);
  document.removeEventListener('yt-page-data-updated', onNavigate, true);
  clearTrackDiscovery();
  trackDiscoveryAttempts = 0;
  lastTimedtextUrl = null;
  attached = false;
  if (getGlobal()[GLOBAL_KEY]?.destroy === destroyYouTubeSubtitles) {
    delete getGlobal()[GLOBAL_KEY];
  }
};

export { initYouTubeSubtitles };

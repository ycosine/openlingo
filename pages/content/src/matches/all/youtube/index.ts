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
import type { ButtonState, CaptionSource, PlayerButtonHandle, Status } from './player-button.js';
import type { TranslateSession } from './translate.js';
import type { VideoSubtitlesSettingsType } from '@extension/storage';

interface TimedtextMessage {
  type: 'YT_TIMEDTEXT_URL';
  url: string;
}

type ActiveSessionStatus = 'fetching' | 'translating' | 'translated' | 'no-cues' | 'error';

interface ActiveSession {
  videoId: string;
  trackKey: string;
  captionSource: CaptionSource;
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
let unsubscribeSettings: (() => void) | null = null;
let captionsOn = false;
let captionsWatchTimer = 0;
/** Per-video: user explicitly clicked "Hide this button"; suppress re-injection
 *  until they navigate to a new video. */
let perVideoHidden = false;

const GLOBAL_KEY = '__openlingoYouTubeSubtitles';

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

const captionSourceFor = (url: string): CaptionSource => {
  try {
    const kind = new URL(url, 'https://www.youtube.com').searchParams.get('kind');
    return kind === 'asr' ? 'ai' : 'human';
  } catch {
    return null;
  }
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
  const enabled = !!(lastSettings && featureOn(lastSettings) && perVideoEnabled);
  const noTrack = !lastTimedtextUrl && !active;
  const canDownloadSrt =
    !!active && active.cues.length > 0 && !!active.translateSession && active.translateSession.translations.size > 0;
  const patch: Partial<ButtonState> = {
    enabled,
    status,
    needsCaptions: enabled && noTrack && !captionsOn,
    captionSource: active?.captionSource ?? null,
    canDownloadSrt,
  };
  if (opts.statusText !== undefined) patch.statusText = opts.statusText;
  if (opts.errorMessage !== undefined) patch.errorMessage = opts.errorMessage;
  button.setState(patch);
};

const readCaptionsOn = (): boolean => {
  const btn = document.querySelector<HTMLElement>('.ytp-subtitles-button.ytp-button');
  if (!btn) return false;
  return btn.getAttribute('aria-pressed') === 'true';
};

const refreshCaptionsState = (): void => {
  const next = readCaptionsOn();
  if (next === captionsOn) return;
  captionsOn = next;
  setButtonStatus(statusForActive());
};

const enableYouTubeCaptions = (): void => {
  const btn = document.querySelector<HTMLElement>('.ytp-subtitles-button.ytp-button');
  if (!btn) return;
  if (btn.getAttribute('aria-pressed') === 'true') {
    captionsOn = true;
    setButtonStatus(statusForActive());
    return;
  }
  btn.click();
  // YouTube updates aria-pressed synchronously, but the timedtext request lags
  // a beat — re-check shortly so the UI reflects the new state.
  window.setTimeout(refreshCaptionsState, 50);
};

const statusForActive = (): Status => {
  if (!active) return 'idle';
  if (active.status === 'error') return 'error';
  if (active.status === 'no-cues') return 'no-cues';
  if (active.status === 'translated') return 'translated';
  return 'translating';
};

const currentPlaybackTimeMs = (): number => {
  const video = document.querySelector<HTMLVideoElement>('.html5-main-video, video.video-stream');
  return video && Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime * 1000) : 0;
};

const beginTranslation = async (url: string): Promise<void> => {
  if (!lastSettings) return;
  if (!featureOn(lastSettings) || !perVideoEnabled) return;

  const videoId = currentVideoId();
  if (!videoId) return;

  const key = trackKeyFor(url);
  if (active && active.trackKey === key && active.videoId === videoId) return;

  cancelActive();
  setButtonStatus('translating', { statusText: '', errorMessage: '' });

  const abortFetch = new AbortController();
  const session: ActiveSession = {
    videoId,
    trackKey: key,
    captionSource: captionSourceFor(url),
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

  const translateSession = startCueTranslation(cues, { priorityTimeMs: currentPlaybackTimeMs() });
  const overlay = createOverlay({
    cues,
    translations: translateSession.translations,
    subtitleStyle: lastSettings.subtitleStyle,
    fontScale: lastSettings.subtitleFontScale,
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
  lastTimedtextUrl = url;
  void beginTranslation(url);
};

const onNavigate = (): void => {
  const vid = currentVideoId();
  if (vid === lastNavVideoId) return;
  lastNavVideoId = vid;
  cancelActive();
  if (vid !== perVideoId) {
    perVideoId = vid;
    perVideoEnabled = true;
    perVideoHidden = false;
    ensureButton();
  }
  lastTimedtextUrl = null;
  setButtonStatus('idle', { statusText: '', errorMessage: '' });
};

const onTogglePerVideo = (enabled: boolean): void => {
  perVideoEnabled = enabled;
  if (!enabled) {
    cancelActive();
    setButtonStatus('idle', { statusText: '', errorMessage: '' });
    return;
  }
  refreshCaptionsState();
  if (lastTimedtextUrl) {
    void beginTranslation(lastTimedtextUrl);
  } else {
    setButtonStatus('idle', { statusText: captionsOn ? '' : 'Turn on CC to start' });
  }
};

const onOpenOptions = (): void => {
  chrome.runtime.sendMessage({ type: 'OL_OPEN_OPTIONS' }).catch(() => undefined);
};

const onHideButton = (): void => {
  perVideoHidden = true;
  button?.destroy();
  button = null;
};

const formatSrtTime = (ms: number): string => {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  const pad = (n: number, w: number) => n.toString().padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(milli, 3)}`;
};

const buildSrt = (cues: Cue[], translations: Map<number, string>): string => {
  const lines: string[] = [];
  cues.forEach((cue, i) => {
    const tr = translations.get(cue.id)?.trim();
    const body = tr ? `${cue.text}\n${tr}` : cue.text;
    lines.push(`${i + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${body}\n`);
  });
  return lines.join('\n');
};

const onDownloadSrt = (): void => {
  if (!active?.translateSession) return;
  const srt = buildSrt(active.cues, active.translateSession.translations);
  const blob = new Blob([srt], { type: 'application/x-subrip;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeId = active.videoId.replace(/[^\w-]/g, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `openlingo-${safeId || 'video'}.srt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const ensureButton = (): void => {
  if (button) return;
  if (perVideoHidden) return;
  button = createPlayerButton(
    {
      onToggleEnabled: onTogglePerVideo,
      onOpenOptions,
      onEnableCaptions: enableYouTubeCaptions,
      onHideButton,
      onDownloadSrt,
    },
    {
      enabled: !!(lastSettings && featureOn(lastSettings) && perVideoEnabled),
      status: 'idle',
      statusText: '',
      needsCaptions: false,
      captionSource: null,
      canDownloadSrt: false,
    },
  );
};

const applySettings = (settings: VideoSubtitlesSettingsType): void => {
  const previous = lastSettings;
  lastSettings = settings;
  if (previous && previous.subtitleStyle !== settings.subtitleStyle) {
    updateOverlayStyle(settings.subtitleStyle);
  }
  if (previous && previous.subtitleFontScale !== settings.subtitleFontScale) {
    active?.overlay?.setFontScale(settings.subtitleFontScale);
  }
  if (!featureOn(settings)) {
    cancelActive();
    setButtonStatus('idle', { statusText: '', errorMessage: '' });
    return;
  }
  setButtonStatus(statusForActive());
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
  });
  unsubscribeSettings = translationSettingsStorage.subscribe(() => {
    const snap = translationSettingsStorage.getSnapshot();
    if (snap) applySettings(snap.videoSubtitles);
  });

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  document.addEventListener('yt-navigate-finish', onNavigate, true);
  document.addEventListener('yt-page-data-updated', onNavigate, true);

  // YouTube doesn't fire a dedicated event when the user toggles CC, so poll
  // the subtitles button's aria-pressed at a low frequency to keep the prompt
  // in sync.
  captionsWatchTimer = window.setInterval(refreshCaptionsState, 800);

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
  if (captionsWatchTimer) {
    window.clearInterval(captionsWatchTimer);
    captionsWatchTimer = 0;
  }
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  document.removeEventListener('yt-navigate-finish', onNavigate, true);
  document.removeEventListener('yt-page-data-updated', onNavigate, true);
  lastTimedtextUrl = null;
  attached = false;
  if (getGlobal()[GLOBAL_KEY]?.destroy === destroyYouTubeSubtitles) {
    delete getGlobal()[GLOBAL_KEY];
  }
};

export { initYouTubeSubtitles };

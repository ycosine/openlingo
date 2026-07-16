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

import { appendSequentialCue, createAsrCue, replaceOverlappingCues } from './asr-cues.js';
import { currentVideoId, fetchCues } from './cues.js';
import { createOverlay, updateOverlayStyle } from './overlay.js';
import { createPlayerButton } from './player-button.js';
import { startCueTranslation, startIncrementalCueTranslation } from './translate.js';
import { translationSettingsStorage } from '@extension/storage';
import type { Cue } from './cues.js';
import type { OverlayHandle } from './overlay.js';
import type { ButtonState, CaptionSource, PlayerButtonHandle, Status } from './player-button.js';
import type { IncrementalTranslateSession, TranslateSession } from './translate.js';
import type { AsrCommittedEvent, AsrPlaybackContext, AsrSessionState, YouTubeAsrContext } from '@extension/shared';
import type { VideoSubtitlesSettingsType } from '@extension/storage';

interface TimedtextMessage {
  type: 'YT_TIMEDTEXT_URL';
  url: string;
}

interface AsrStateMessage {
  type: 'YT_ASR_STATE';
  state: AsrSessionState;
}

interface AsrPartialMessage {
  type: 'YT_ASR_PARTIAL';
  videoId: string;
  sessionId: string;
  text: string;
}

interface AsrCommittedMessage {
  type: 'YT_ASR_COMMITTED';
  event: AsrCommittedEvent;
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

interface ActiveAsrSession {
  videoId: string;
  status: AsrSessionState['status'];
  cues: Cue[];
  translations: Map<number, string>;
  translateSession: IncrementalTranslateSession;
  overlay: OverlayHandle;
  nextCueId: number;
  /** ElevenLabs stream id of the last committed event; a change means the
   *  timeline was re-anchored and overlapping cues must be replaced. */
  lastAsrStreamId: string | null;
  autoReconnects: number;
  detectedLanguage?: string;
  error?: string;
}

interface YouTubeSubtitlesGlobal {
  destroy: () => void;
}

let attached = false;
let active: ActiveSession | null = null;
let activeAsr: ActiveAsrSession | null = null;
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
let boundVideo: HTMLVideoElement | null = null;
let reanchorTimer = 0;
let videoBindTimer = 0;

/** Cap consecutive automatic reconnects after recoverable stream drops
 *  (network hiccups, ElevenLabs per-session time limits). */
const MAX_ASR_AUTO_RECONNECTS = 3;

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

const cancelActiveAsr = (): void => {
  if (!activeAsr) return;
  activeAsr.translateSession.cancel();
  activeAsr.overlay.destroy();
  activeAsr = null;
};

const featureOn = (settings: VideoSubtitlesSettingsType): boolean =>
  settings.enabled && settings.youtubeAutoEnable && settings.youtubeTranslate;

const asrFeatureOn = (settings: VideoSubtitlesSettingsType): boolean =>
  settings.enabled && settings.youtubeAutoEnable && settings.youtubeAsrFallbackEnabled;

const setButtonStatus = (status: Status, opts: { statusText?: string; errorMessage?: string } = {}): void => {
  if (!button) return;
  const enabled = !!(lastSettings && (featureOn(lastSettings) || asrFeatureOn(lastSettings)) && perVideoEnabled);
  const noTrack = !lastTimedtextUrl && !active;
  const canDownloadSrt =
    (!!active &&
      active.cues.length > 0 &&
      !!active.translateSession &&
      active.translateSession.translations.size > 0) ||
    !!activeAsr?.cues.length;
  const patch: Partial<ButtonState> = {
    enabled,
    status,
    needsCaptions: enabled && noTrack && !captionsOn && !activeAsr,
    captionSource: active?.captionSource ?? (activeAsr ? 'asr' : null),
    canDownloadSrt,
    asrFallback: !!(lastSettings && asrFeatureOn(lastSettings) && noTrack && !activeAsr),
    asrRunning: !!activeAsr,
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
  if (activeAsr) {
    if (activeAsr.status === 'error') return 'error';
    if (activeAsr.status === 'listening' || activeAsr.status === 'capturing' || activeAsr.status === 'paused') {
      return 'listening';
    }
    return 'translating';
  }
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

const currentPlaybackContext = (): AsrPlaybackContext | null => {
  const videoId = currentVideoId();
  const video = document.querySelector<HTMLVideoElement>('.html5-main-video, video.video-stream');
  if (!videoId || !video) return null;
  return {
    videoId,
    videoTimeMs: Math.max(0, video.currentTime * 1000),
    playbackRate: Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1,
  };
};

const ensureAsrSession = (videoId: string): ActiveAsrSession | null => {
  if (!lastSettings || !asrFeatureOn(lastSettings) || !perVideoEnabled) return null;
  if (activeAsr?.videoId === videoId) return activeAsr;

  cancelActive();
  cancelActiveAsr();
  const translateSession = startIncrementalCueTranslation();
  const translations = translateSession.translations;
  const overlay = createOverlay({
    cues: [],
    translations,
    subtitleStyle: lastSettings.subtitleStyle,
    fontScale: lastSettings.subtitleFontScale,
    mode: 'standalone-bilingual',
  });
  const session: ActiveAsrSession = {
    videoId,
    status: 'capturing',
    cues: [],
    translations,
    translateSession,
    overlay,
    nextCueId: 0,
    lastAsrStreamId: null,
    autoReconnects: 0,
  };
  activeAsr = session;
  translateSession.onUpdate(() => {
    if (activeAsr !== session) return;
    overlay.setCues(session.cues, session.translations);
    overlay.refresh();
    setButtonStatus(statusForActive(), {
      statusText: `${session.cues.length} live cues`,
      errorMessage: '',
    });
  });
  translateSession.onError(error => {
    if (activeAsr !== session) return;
    console.warn('[OpenLingo] ASR subtitle translation:', error);
    setButtonStatus(statusForActive(), {
      statusText: 'Live transcript active · translation unavailable',
      errorMessage: error,
    });
  });
  return session;
};

const cueFromAsrEvent = (session: ActiveAsrSession, event: AsrCommittedEvent): Cue | null => {
  const cue = createAsrCue(event, {
    id: session.nextCueId,
    currentPlaybackTimeMs: currentPlaybackTimeMs(),
    filterAmbient: !!lastSettings?.filterAmbient,
  });
  if (cue) session.nextCueId += 1;
  return cue;
};

const appendAsrCue = (event: AsrCommittedEvent): void => {
  const session = ensureAsrSession(event.videoId);
  if (!session || activeAsr !== session) return;
  const cue = cueFromAsrEvent(session, event);
  session.overlay.setPartialText('');
  if (!cue) return;

  session.cues =
    session.lastAsrStreamId === null || session.lastAsrStreamId === event.sessionId
      ? appendSequentialCue(session.cues, cue)
      : replaceOverlappingCues(session.cues, cue);
  session.lastAsrStreamId = event.sessionId;
  session.detectedLanguage = event.languageCode ?? session.detectedLanguage;
  session.overlay.setCues(session.cues, session.translations);
  session.overlay.refresh();
  session.translateSession.append([cue]);
  setButtonStatus('listening', {
    statusText: `${session.cues.length} live cues${session.detectedLanguage ? ` · ${session.detectedLanguage}` : ''}`,
    errorMessage: '',
  });
};

const scheduleAsrReanchor = (delay = 120): void => {
  if (!activeAsr) return;
  if (reanchorTimer) window.clearTimeout(reanchorTimer);
  reanchorTimer = window.setTimeout(() => {
    reanchorTimer = 0;
    const context = currentPlaybackContext();
    if (!activeAsr || !context || context.videoId !== activeAsr.videoId) return;
    chrome.runtime.sendMessage({ type: 'OL_ASR_REANCHOR', context }).catch(() => undefined);
  }, delay);
};

const onVideoPause = (): void => {
  if (!activeAsr) return;
  activeAsr.status = 'paused';
  chrome.runtime.sendMessage({ type: 'OL_ASR_PAUSE' }).catch(() => undefined);
  setButtonStatus('listening', { statusText: 'Live transcription paused' });
};

const onVideoPlay = (): void => scheduleAsrReanchor(80);
const onVideoSeeking = (): void => {
  if (!activeAsr) return;
  chrome.runtime.sendMessage({ type: 'OL_ASR_PAUSE' }).catch(() => undefined);
};
const onVideoSeeked = (): void => scheduleAsrReanchor(80);
const onVideoRateChange = (): void => scheduleAsrReanchor(80);

const bindVideoEvents = (): void => {
  const next = document.querySelector<HTMLVideoElement>('.html5-main-video, video.video-stream');
  if (next === boundVideo) return;
  if (boundVideo) {
    boundVideo.removeEventListener('pause', onVideoPause);
    boundVideo.removeEventListener('play', onVideoPlay);
    boundVideo.removeEventListener('seeking', onVideoSeeking);
    boundVideo.removeEventListener('seeked', onVideoSeeked);
    boundVideo.removeEventListener('ratechange', onVideoRateChange);
  }
  boundVideo = next;
  if (boundVideo) {
    boundVideo.addEventListener('pause', onVideoPause);
    boundVideo.addEventListener('play', onVideoPlay);
    boundVideo.addEventListener('seeking', onVideoSeeking);
    boundVideo.addEventListener('seeked', onVideoSeeked);
    boundVideo.addEventListener('ratechange', onVideoRateChange);
  }
};

const beginTranslation = async (url: string): Promise<void> => {
  if (!lastSettings) return;
  if (!featureOn(lastSettings) || !perVideoEnabled) return;

  const videoId = currentVideoId();
  if (!videoId) return;

  const key = trackKeyFor(url);
  if (active && active.trackKey === key && active.videoId === videoId) return;

  if (activeAsr) {
    chrome.runtime.sendMessage({ type: 'OL_ASR_STOP' }).catch(() => undefined);
    cancelActiveAsr();
  }
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

const onRuntimeMessage = (
  msg: unknown,
  _sender?: chrome.runtime.MessageSender,
  sendResponse?: (response?: unknown) => void,
): void => {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
  const type = (msg as { type: string }).type;
  if (type === 'YT_ASR_CONTEXT') {
    const context = currentPlaybackContext();
    const response: YouTubeAsrContext = context
      ? {
          ok: true,
          videoId: context.videoId,
          videoTimeMs: context.videoTimeMs,
          playbackRate: context.playbackRate,
          hasNativeCaptions: !!lastTimedtextUrl || !!active,
        }
      : { ok: false, message: 'Open a YouTube video first' };
    sendResponse?.(response);
    return;
  }
  if (type === 'YT_ASR_STATE') {
    const state = (msg as AsrStateMessage).state;
    const videoId = currentVideoId();
    if (!videoId || (state.videoId && state.videoId !== videoId)) return;
    if (state.status === 'idle') {
      cancelActiveAsr();
      setButtonStatus(active ? statusForActive() : 'idle', { statusText: '', errorMessage: '' });
      return;
    }
    const session = ensureAsrSession(videoId);
    if (!session) return;
    session.status = state.status;
    session.error = state.error;
    if (state.status === 'listening') session.autoReconnects = 0;
    const willAutoReconnect =
      state.status === 'error' &&
      !!state.recoverable &&
      session.autoReconnects < MAX_ASR_AUTO_RECONNECTS &&
      !!boundVideo &&
      !boundVideo.paused;
    if (willAutoReconnect) {
      session.autoReconnects += 1;
      scheduleAsrReanchor(900);
    }
    setButtonStatus(statusForActive(), {
      statusText:
        state.status === 'paused'
          ? 'Live transcription paused'
          : state.status === 'reconnecting' || willAutoReconnect
            ? 'Reconnecting live transcription…'
            : state.status === 'capturing'
              ? 'Starting audio capture…'
              : 'Listening with ElevenLabs',
      errorMessage: willAutoReconnect ? '' : (state.error ?? ''),
    });
    return;
  }
  if (type === 'YT_ASR_PARTIAL') {
    const partial = msg as AsrPartialMessage;
    if (partial.videoId !== currentVideoId()) return;
    const session = ensureAsrSession(partial.videoId);
    if (!session) return;
    session.overlay.setPartialText(partial.text);
    setButtonStatus('listening', { statusText: 'Listening with ElevenLabs', errorMessage: '' });
    return;
  }
  if (type === 'YT_ASR_COMMITTED') {
    appendAsrCue((msg as AsrCommittedMessage).event);
    return;
  }
  if (type !== 'YT_TIMEDTEXT_URL') return;
  const url = (msg as TimedtextMessage).url;
  lastTimedtextUrl = url;
  if (activeAsr) chrome.runtime.sendMessage({ type: 'OL_ASR_STOP' }).catch(() => undefined);
  void beginTranslation(url);
};

const onNavigate = (): void => {
  const vid = currentVideoId();
  if (vid === lastNavVideoId) return;
  lastNavVideoId = vid;
  cancelActive();
  if (activeAsr) {
    chrome.runtime.sendMessage({ type: 'OL_ASR_STOP' }).catch(() => undefined);
    cancelActiveAsr();
  }
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
    if (activeAsr) {
      chrome.runtime.sendMessage({ type: 'OL_ASR_STOP' }).catch(() => undefined);
      cancelActiveAsr();
    }
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

const onOpenPopup = (): void => {
  chrome.runtime.sendMessage({ type: 'OL_OPEN_POPUP' }).catch(() => undefined);
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
  const source = activeAsr
    ? { videoId: activeAsr.videoId, cues: activeAsr.cues, translations: activeAsr.translations }
    : active?.translateSession
      ? { videoId: active.videoId, cues: active.cues, translations: active.translateSession.translations }
      : null;
  if (!source || source.cues.length === 0) return;
  const srt = buildSrt(source.cues, source.translations);
  const blob = new Blob([srt], { type: 'application/x-subrip;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeId = source.videoId.replace(/[^\w-]/g, '');
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
      onOpenPopup,
    },
    {
      enabled: !!(lastSettings && (featureOn(lastSettings) || asrFeatureOn(lastSettings)) && perVideoEnabled),
      status: 'idle',
      statusText: '',
      needsCaptions: false,
      captionSource: null,
      canDownloadSrt: false,
      asrFallback: false,
      asrRunning: false,
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
    activeAsr?.overlay.setFontScale(settings.subtitleFontScale);
  }
  if (!featureOn(settings)) {
    cancelActive();
  }
  if (!asrFeatureOn(settings) && activeAsr) {
    chrome.runtime.sendMessage({ type: 'OL_ASR_STOP' }).catch(() => undefined);
    cancelActiveAsr();
  }
  if (!featureOn(settings) && !asrFeatureOn(settings)) {
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
  videoBindTimer = window.setInterval(bindVideoEvents, 1000);
  bindVideoEvents();

  lastNavVideoId = currentVideoId();
  perVideoId = lastNavVideoId;
  getGlobal()[GLOBAL_KEY] = { destroy: destroyYouTubeSubtitles };
};

const destroyYouTubeSubtitles = (): void => {
  if (!attached) return;
  cancelActive();
  if (activeAsr) {
    chrome.runtime.sendMessage({ type: 'OL_ASR_STOP' }).catch(() => undefined);
  }
  cancelActiveAsr();
  button?.destroy();
  button = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  if (captionsWatchTimer) {
    window.clearInterval(captionsWatchTimer);
    captionsWatchTimer = 0;
  }
  if (reanchorTimer) {
    window.clearTimeout(reanchorTimer);
    reanchorTimer = 0;
  }
  if (videoBindTimer) {
    window.clearInterval(videoBindTimer);
    videoBindTimer = 0;
  }
  if (boundVideo) {
    boundVideo.removeEventListener('pause', onVideoPause);
    boundVideo.removeEventListener('play', onVideoPlay);
    boundVideo.removeEventListener('seeking', onVideoSeeking);
    boundVideo.removeEventListener('seeked', onVideoSeeked);
    boundVideo.removeEventListener('ratechange', onVideoRateChange);
    boundVideo = null;
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

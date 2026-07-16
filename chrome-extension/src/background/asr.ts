import { asrCredentialsStorage, translationSettingsStorage } from '@extension/storage';
import type {
  AsrCommittedEvent,
  AsrPlaybackContext,
  AsrPrepareResponse,
  AsrSessionState,
  AsrStartResponse,
  AsrWord,
  YouTubeAsrContext,
} from '@extension/shared';

interface PreparedToken {
  token: string;
  expiresAt: number;
}

interface PrepareMessage {
  type: 'OL_ASR_PREPARE';
  tabId: number;
}

interface ValidateMessage {
  type: 'OL_ASR_VALIDATE';
  apiKey: string;
}

interface StartMessage {
  type: 'OL_ASR_START';
  tabId: number;
  streamId: string;
  context: AsrPlaybackContext;
}

interface StopMessage {
  type: 'OL_ASR_STOP';
  tabId?: number;
}

interface StateMessage {
  type: 'OL_ASR_GET_STATE';
  tabId: number;
}

interface PauseMessage {
  type: 'OL_ASR_PAUSE';
}

interface ReanchorMessage {
  type: 'OL_ASR_REANCHOR';
  context: AsrPlaybackContext;
}

interface OffscreenStateMessage {
  target: 'background';
  type: 'OL_ASR_OFFSCREEN_STATE';
  tabId: number;
  videoId: string;
  status: AsrSessionState['status'];
  error?: string;
  recoverable?: boolean;
}

interface OffscreenPartialMessage {
  target: 'background';
  type: 'OL_ASR_OFFSCREEN_PARTIAL';
  tabId: number;
  videoId: string;
  sessionId: string;
  text: string;
}

interface OffscreenCommittedMessage {
  target: 'background';
  type: 'OL_ASR_OFFSCREEN_COMMITTED';
  tabId: number;
  videoId: string;
  sessionId: string;
  text: string;
  words: AsrWord[];
  languageCode?: string;
  anchorVideoTimeMs: number;
  playbackRate: number;
}

type IncomingMessage =
  | PrepareMessage
  | ValidateMessage
  | StartMessage
  | StopMessage
  | StateMessage
  | PauseMessage
  | ReanchorMessage
  | OffscreenStateMessage
  | OffscreenPartialMessage
  | OffscreenCommittedMessage;

const preparedTokens = new Map<number, PreparedToken>();
const states = new Map<number, AsrSessionState>();
let activeTabId: number | null = null;
let creatingOffscreen: Promise<void> | null = null;

const preparedTokenKey = (tabId: number): string => `openlingo-asr-token-${tabId}`;

const savePreparedToken = async (tabId: number, entry: PreparedToken): Promise<void> => {
  preparedTokens.set(tabId, entry);
  await chrome.storage.session.set({ [preparedTokenKey(tabId)]: entry });
};

const loadPreparedToken = async (tabId: number): Promise<PreparedToken | undefined> => {
  const memory = preparedTokens.get(tabId);
  if (tokenIsFresh(memory)) return memory;
  const stored = await chrome.storage.session.get(preparedTokenKey(tabId));
  const entry = stored[preparedTokenKey(tabId)] as PreparedToken | undefined;
  if (tokenIsFresh(entry)) {
    preparedTokens.set(tabId, entry);
    return entry;
  }
  return undefined;
};

const removePreparedToken = async (tabId: number): Promise<void> => {
  preparedTokens.delete(tabId);
  await chrome.storage.session.remove(preparedTokenKey(tabId));
};

const tokenIsFresh = (entry: PreparedToken | undefined): entry is PreparedToken =>
  !!entry && entry.expiresAt > Date.now() + 30_000;

const requestToken = async (apiKey: string): Promise<string> => {
  const key = apiKey.trim();
  if (!key) throw new Error('ElevenLabs API key is not configured');
  const response = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
    method: 'POST',
    headers: { 'xi-api-key': key },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`ElevenLabs ${response.status}: ${detail || response.statusText}`);
  }
  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new Error('ElevenLabs did not return a single-use token');
  return data.token;
};

const ensureOffscreen = async (): Promise<void> => {
  if (!chrome.offscreen) throw new Error('Live transcription requires Chrome 116 or newer');
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: 'offscreen/index.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'Capture the current YouTube tab audio for user-initiated live transcription',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
};

const prepare = async (tabId: number): Promise<AsrPrepareResponse> => {
  if (!chrome.tabCapture || !chrome.offscreen) {
    return { ok: false, message: 'Live transcription requires Chrome 116 or newer' };
  }
  const credentials = await asrCredentialsStorage.get();
  if (!credentials.elevenlabsApiKey.trim()) {
    return { ok: false, message: 'Add an ElevenLabs API key in Options' };
  }
  await ensureOffscreen();
  const current = await loadPreparedToken(tabId);
  if (!tokenIsFresh(current)) {
    const token = await requestToken(credentials.elevenlabsApiKey);
    await savePreparedToken(tabId, { token, expiresAt: Date.now() + 14 * 60_000 });
  }
  return { ok: true, prepared: true };
};

const publishState = (state: AsrSessionState): void => {
  states.set(state.tabId, state);
  chrome.tabs.sendMessage(state.tabId, { type: 'YT_ASR_STATE', state }).catch(() => undefined);
};

const stop = async (tabId: number): Promise<void> => {
  await removePreparedToken(tabId);
  if (activeTabId === tabId) activeTabId = null;
  if (chrome.offscreen && (await chrome.offscreen.hasDocument())) {
    await chrome.runtime
      .sendMessage({ target: 'offscreen', type: 'OL_ASR_OFFSCREEN_STOP', tabId })
      .catch(() => undefined);
    // Nothing left to capture; don't keep the offscreen document alive.
    if (activeTabId === null) await chrome.offscreen.closeDocument().catch(() => undefined);
  }
  const current = states.get(tabId);
  if (current) publishState({ ...current, status: 'idle', error: undefined });
};

/** The audio stream's time origin is the moment ElevenLabs reports
 *  session_started, not when the start/reanchor request was issued. Re-read
 *  the playback position from the tab so word timestamps map accurately. */
const syncAnchor = async (tabId: number): Promise<void> => {
  const context = (await chrome.tabs.sendMessage(tabId, { type: 'YT_ASR_CONTEXT' }).catch(() => undefined)) as
    | YouTubeAsrContext
    | undefined;
  if (!context?.ok || !context.videoId) return;
  await chrome.runtime
    .sendMessage({
      target: 'offscreen',
      type: 'OL_ASR_OFFSCREEN_SET_CONTEXT',
      tabId,
      context: {
        videoId: context.videoId,
        videoTimeMs: context.videoTimeMs ?? 0,
        playbackRate: context.playbackRate ?? 1,
      },
    })
    .catch(() => undefined);
};

const start = async (message: StartMessage): Promise<AsrStartResponse> => {
  const prepared = await loadPreparedToken(message.tabId);
  if (!tokenIsFresh(prepared)) {
    return { ok: false, message: 'Transcription preparation expired. Reopen the popup and try again.' };
  }
  // Stop any other tab first — stop() may close the offscreen document.
  if (activeTabId !== null && activeTabId !== message.tabId) await stop(activeTabId);
  await ensureOffscreen();

  await removePreparedToken(message.tabId);
  activeTabId = message.tabId;
  const settings = await translationSettingsStorage.get();
  publishState({
    tabId: message.tabId,
    videoId: message.context.videoId,
    status: 'capturing',
  });
  const response = (await chrome.runtime
    .sendMessage({
      target: 'offscreen',
      type: 'OL_ASR_OFFSCREEN_START',
      tabId: message.tabId,
      streamId: message.streamId,
      token: prepared.token,
      language: settings.videoSubtitles.youtubeAsrLanguage,
      context: message.context,
    })
    .catch(() => undefined)) as AsrStartResponse | undefined;
  if (!response?.ok) {
    activeTabId = null;
    publishState({
      tabId: message.tabId,
      videoId: message.context.videoId,
      status: 'error',
      error: response?.message ?? 'Unable to start audio capture',
    });
    return { ok: false, message: response?.message ?? 'Unable to start audio capture' };
  }
  return { ok: true };
};

const reanchor = async (tabId: number, context: AsrPlaybackContext): Promise<AsrStartResponse> => {
  const credentials = await asrCredentialsStorage.get();
  const token = await requestToken(credentials.elevenlabsApiKey);
  const settings = await translationSettingsStorage.get();
  publishState({ tabId, videoId: context.videoId, status: 'reconnecting' });
  return (await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'OL_ASR_OFFSCREEN_REANCHOR',
    tabId,
    token,
    language: settings.videoSubtitles.youtubeAsrLanguage,
    context,
  })) as AsrStartResponse;
};

const getState = async (tabId: number): Promise<AsrSessionState> => {
  const memory = states.get(tabId);
  if (memory && memory.status !== 'idle') return memory;
  if (chrome.offscreen && (await chrome.offscreen.hasDocument())) {
    const state = (await chrome.runtime
      .sendMessage({ target: 'offscreen', type: 'OL_ASR_OFFSCREEN_GET_STATE', tabId })
      .catch(() => undefined)) as AsrSessionState | undefined;
    if (state) {
      states.set(tabId, state);
      if (state.status !== 'idle') activeTabId = tabId;
      return state;
    }
  }
  return { tabId, videoId: '', status: 'idle' };
};

const forwardPartial = (message: OffscreenPartialMessage): void => {
  chrome.tabs
    .sendMessage(message.tabId, {
      type: 'YT_ASR_PARTIAL',
      videoId: message.videoId,
      sessionId: message.sessionId,
      text: message.text,
    })
    .catch(() => undefined);
};

const forwardCommitted = (message: OffscreenCommittedMessage): void => {
  const event: AsrCommittedEvent = {
    tabId: message.tabId,
    videoId: message.videoId,
    sessionId: message.sessionId,
    text: message.text,
    words: message.words,
    languageCode: message.languageCode,
    anchorVideoTimeMs: message.anchorVideoTimeMs,
    playbackRate: message.playbackRate,
  };
  chrome.tabs.sendMessage(message.tabId, { type: 'YT_ASR_COMMITTED', event }).catch(() => undefined);
};

export const registerAsrMessageHandlers = (): void => {
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return false;
    const message = raw as IncomingMessage;

    if ('target' in message && message.target === 'background') {
      if (message.type === 'OL_ASR_OFFSCREEN_STATE') {
        publishState({
          tabId: message.tabId,
          videoId: message.videoId,
          status: message.status,
          error: message.error,
          recoverable: message.recoverable,
        });
        if (message.status === 'idle' && activeTabId === message.tabId) activeTabId = null;
        if (message.status === 'listening') void syncAnchor(message.tabId);
      } else if (message.type === 'OL_ASR_OFFSCREEN_PARTIAL') {
        forwardPartial(message);
      } else if (message.type === 'OL_ASR_OFFSCREEN_COMMITTED') {
        forwardCommitted(message);
      }
      return false;
    }

    if (message.type === 'OL_ASR_PREPARE') {
      void prepare(message.tabId)
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, message: (err as Error).message }));
      return true;
    }
    if (message.type === 'OL_ASR_VALIDATE') {
      void requestToken(message.apiKey)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, message: (err as Error).message }));
      return true;
    }
    if (message.type === 'OL_ASR_START') {
      void start(message)
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, message: (err as Error).message }));
      return true;
    }
    if (message.type === 'OL_ASR_STOP') {
      const tabId = message.tabId ?? sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({ ok: false, message: 'Missing tab id' });
        return false;
      }
      void stop(tabId).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === 'OL_ASR_GET_STATE') {
      void getState(message.tabId).then(sendResponse);
      return true;
    }
    if (message.type === 'OL_ASR_PAUSE') {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      void chrome.runtime.sendMessage({ target: 'offscreen', type: 'OL_ASR_OFFSCREEN_PAUSE', tabId });
      return false;
    }
    if (message.type === 'OL_ASR_REANCHOR') {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      void reanchor(tabId, message.context).catch(err => {
        publishState({
          tabId,
          videoId: message.context.videoId,
          status: 'error',
          error: (err as Error).message,
        });
      });
      return false;
    }
    return false;
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    if (activeTabId === tabId) void stop(tabId);
    void removePreparedToken(tabId);
    states.delete(tabId);
  });
};

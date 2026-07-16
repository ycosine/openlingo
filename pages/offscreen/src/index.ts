import type { AsrPlaybackContext, AsrWord } from '@extension/shared';

interface StartMessage {
  target: 'offscreen';
  type: 'OL_ASR_OFFSCREEN_START';
  tabId: number;
  streamId: string;
  token: string;
  language: string;
  context: AsrPlaybackContext;
}

interface StopMessage {
  target: 'offscreen';
  type: 'OL_ASR_OFFSCREEN_STOP';
  tabId: number;
}

interface PauseMessage {
  target: 'offscreen';
  type: 'OL_ASR_OFFSCREEN_PAUSE';
  tabId: number;
}

interface ReanchorMessage {
  target: 'offscreen';
  type: 'OL_ASR_OFFSCREEN_REANCHOR';
  tabId: number;
  token: string;
  language: string;
  context: AsrPlaybackContext;
}

interface GetStateMessage {
  target: 'offscreen';
  type: 'OL_ASR_OFFSCREEN_GET_STATE';
  tabId: number;
}

interface SetContextMessage {
  target: 'offscreen';
  type: 'OL_ASR_OFFSCREEN_SET_CONTEXT';
  tabId: number;
  context: AsrPlaybackContext;
}

type InboundMessage = StartMessage | StopMessage | PauseMessage | ReanchorMessage | GetStateMessage | SetContextMessage;

interface ElevenLabsMessage {
  message_type?: string;
  text?: string;
  language_code?: string;
  words?: AsrWord[];
  error?: string;
  message?: string;
}

const ELEVENLABS_ERROR_TYPES = new Set([
  'auth_error',
  'quota_exceeded',
  'transcriber_error',
  'input_error',
  'error',
  'commit_throttled',
  'unaccepted_terms',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'chunk_size_exceeded',
  'insufficient_audio_activity',
]);

interface ActiveCapture {
  tabId: number;
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  silentGain: GainNode;
  socket: WebSocket | null;
  sessionId: string;
  context: AsrPlaybackContext;
  paused: boolean;
  stopping: boolean;
  status: string;
}

let active: ActiveCapture | null = null;

const sendBackground = (message: Record<string, unknown>): void => {
  chrome.runtime.sendMessage({ target: 'background', ...message }).catch(() => undefined);
};

const updateState = (capture: ActiveCapture, status: string, error?: string, recoverable?: boolean): void => {
  capture.status = status;
  sendBackground({
    type: 'OL_ASR_OFFSCREEN_STATE',
    tabId: capture.tabId,
    videoId: capture.context.videoId,
    status,
    error,
    recoverable,
  });
};

const bytesToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const BLOCK = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + BLOCK)));
  }
  return btoa(binary);
};

const socketUrl = (token: string, language: string): string => {
  const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
  url.searchParams.set('model_id', 'scribe_v2_realtime');
  url.searchParams.set('token', token);
  url.searchParams.set('audio_format', 'pcm_16000');
  url.searchParams.set('include_timestamps', 'true');
  url.searchParams.set('include_language_detection', 'true');
  url.searchParams.set('commit_strategy', 'vad');
  url.searchParams.set('vad_silence_threshold_secs', '0.8');
  if (language && language !== 'auto') url.searchParams.set('language_code', language);
  return url.toString();
};

const handleSocketMessage = (capture: ActiveCapture, raw: string): void => {
  let message: ElevenLabsMessage;
  try {
    message = JSON.parse(raw) as ElevenLabsMessage;
  } catch {
    return;
  }
  if (active !== capture) return;

  if (message.message_type === 'session_started') {
    capture.paused = false;
    updateState(capture, 'listening');
    return;
  }
  if (message.message_type === 'partial_transcript') {
    sendBackground({
      type: 'OL_ASR_OFFSCREEN_PARTIAL',
      tabId: capture.tabId,
      videoId: capture.context.videoId,
      sessionId: capture.sessionId,
      text: message.text ?? '',
    });
    return;
  }
  if (message.message_type === 'committed_transcript_with_timestamps') {
    sendBackground({
      type: 'OL_ASR_OFFSCREEN_COMMITTED',
      tabId: capture.tabId,
      videoId: capture.context.videoId,
      sessionId: capture.sessionId,
      text: message.text ?? '',
      words: message.words ?? [],
      languageCode: message.language_code,
      anchorVideoTimeMs: capture.context.videoTimeMs,
      playbackRate: capture.context.playbackRate,
    });
    return;
  }
  if (message.message_type && ELEVENLABS_ERROR_TYPES.has(message.message_type)) {
    const error = message.error ?? message.message ?? message.message_type;
    // Hitting the per-session time limit only ends this stream; a fresh
    // token + socket can pick up where it left off.
    updateState(capture, 'error', error, message.message_type === 'session_time_limit_exceeded');
  }
};

const connectSocket = (capture: ActiveCapture, token: string, language: string): void => {
  capture.socket?.close();
  capture.sessionId = crypto.randomUUID();
  capture.paused = true;
  updateState(capture, 'reconnecting');

  const socket = new WebSocket(socketUrl(token, language));
  capture.socket = socket;
  socket.addEventListener('open', () => {
    if (active !== capture || capture.socket !== socket) {
      socket.close();
      return;
    }
    updateState(capture, 'capturing');
  });
  socket.addEventListener('message', event => {
    if (typeof event.data === 'string') handleSocketMessage(capture, event.data);
  });
  socket.addEventListener('error', () => {
    if (active === capture && !capture.stopping) updateState(capture, 'error', 'ElevenLabs connection failed');
  });
  socket.addEventListener('close', () => {
    if (active === capture && capture.socket === socket && !capture.stopping && !capture.paused) {
      updateState(capture, 'error', 'ElevenLabs connection closed', true);
    }
  });
};

const stopCapture = async (tabId?: number): Promise<void> => {
  const capture = active;
  if (!capture || (tabId !== undefined && capture.tabId !== tabId)) return;
  active = null;
  capture.stopping = true;
  capture.socket?.close();
  capture.worklet.port.onmessage = null;
  capture.worklet.disconnect();
  capture.source.disconnect();
  capture.silentGain.disconnect();
  for (const track of capture.stream.getTracks()) track.stop();
  await capture.audioContext.close().catch(() => undefined);
  sendBackground({
    type: 'OL_ASR_OFFSCREEN_STATE',
    tabId: capture.tabId,
    videoId: capture.context.videoId,
    status: 'idle',
  });
};

const startCapture = async (message: StartMessage): Promise<void> => {
  await stopCapture();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: message.streamId,
      },
    } as MediaTrackConstraints,
    video: false,
  });

  // Run the graph at the device's native rate so the re-routed playback keeps
  // full quality; the worklet downsamples its copy to 16 kHz for ElevenLabs.
  const audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule(chrome.runtime.getURL('offscreen/pcm-worklet.js'));
  await audioContext.resume();

  const source = audioContext.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioContext, 'openlingo-pcm-processor');
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  // Tab capture mutes the original tab output. Reconnect the captured stream so
  // the viewer continues to hear the video while ASR runs.
  source.connect(audioContext.destination);
  source.connect(worklet);
  worklet.connect(silentGain);
  silentGain.connect(audioContext.destination);

  const capture: ActiveCapture = {
    tabId: message.tabId,
    stream,
    audioContext,
    source,
    worklet,
    silentGain,
    socket: null,
    sessionId: crypto.randomUUID(),
    context: message.context,
    paused: true,
    stopping: false,
    status: 'capturing',
  };
  active = capture;
  updateState(capture, 'capturing');

  worklet.port.onmessage = event => {
    if (active !== capture || capture.paused || capture.socket?.readyState !== WebSocket.OPEN) return;
    const buffer = event.data as ArrayBuffer;
    capture.socket.send(
      JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: bytesToBase64(buffer),
        sample_rate: 16_000,
      }),
    );
  };

  connectSocket(capture, message.token, message.language);
};

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  if (!raw || typeof raw !== 'object') return false;
  const message = raw as Partial<InboundMessage>;
  if (message.target !== 'offscreen') return false;

  if (message.type === 'OL_ASR_OFFSCREEN_START') {
    void startCapture(message as StartMessage)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        const start = message as StartMessage;
        sendBackground({
          type: 'OL_ASR_OFFSCREEN_STATE',
          tabId: start.tabId,
          videoId: start.context.videoId,
          status: 'error',
          error: (err as Error).message,
        });
        sendResponse({ ok: false, message: (err as Error).message });
      });
    return true;
  }
  if (message.type === 'OL_ASR_OFFSCREEN_STOP') {
    void stopCapture((message as StopMessage).tabId).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'OL_ASR_OFFSCREEN_PAUSE') {
    const pause = message as PauseMessage;
    if (active?.tabId === pause.tabId) {
      active.paused = true;
      active.socket?.close();
      active.socket = null;
      updateState(active, 'paused');
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'OL_ASR_OFFSCREEN_REANCHOR') {
    const reanchor = message as ReanchorMessage;
    if (!active || active.tabId !== reanchor.tabId) {
      sendResponse({ ok: false, message: 'No active capture' });
      return false;
    }
    active.context = reanchor.context;
    connectSocket(active, reanchor.token, reanchor.language);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'OL_ASR_OFFSCREEN_SET_CONTEXT') {
    const sync = message as SetContextMessage;
    if (active?.tabId === sync.tabId) active.context = sync.context;
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'OL_ASR_OFFSCREEN_GET_STATE') {
    const query = message as GetStateMessage;
    sendResponse(
      active?.tabId === query.tabId
        ? {
            tabId: active.tabId,
            videoId: active.context.videoId,
            status: active.status,
          }
        : {
            tabId: query.tabId,
            videoId: '',
            status: 'idle',
          },
    );
    return false;
  }
  return false;
});

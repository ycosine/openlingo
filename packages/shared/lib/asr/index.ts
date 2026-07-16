export type AsrSessionStatus = 'idle' | 'preparing' | 'capturing' | 'listening' | 'paused' | 'reconnecting' | 'error';

export interface AsrPlaybackContext {
  videoId: string;
  videoTimeMs: number;
  playbackRate: number;
}

export interface AsrWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

export interface AsrSessionState {
  tabId: number;
  videoId: string;
  status: AsrSessionStatus;
  error?: string;
  detectedLanguage?: string;
}

export interface AsrCommittedEvent {
  tabId: number;
  videoId: string;
  sessionId: string;
  text: string;
  words: AsrWord[];
  languageCode?: string;
  anchorVideoTimeMs: number;
  playbackRate: number;
}

export interface YouTubeAsrContext {
  ok: boolean;
  videoId?: string;
  videoTimeMs?: number;
  playbackRate?: number;
  hasNativeCaptions?: boolean;
  message?: string;
}

export interface AsrPrepareResponse {
  ok: boolean;
  prepared?: boolean;
  message?: string;
}

export interface AsrStartResponse {
  ok: boolean;
  message?: string;
}

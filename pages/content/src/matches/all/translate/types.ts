export type PageStatus = 'idle' | 'translating' | 'translated';

export type UnitStatus = 'discovered' | 'queued' | 'sent' | 'done' | 'failed_retryable' | 'failed_final';

export interface PendingUnit {
  id: string;
  el: HTMLElement;
  /** Normalized HTML fragment sent to the translator. */
  html: string;
  placeholder: HTMLElement | null;
  status: UnitStatus;
  retries: number;
  /** Epoch ms when the current `sent` attempt times out. */
  deadline: number;
}

export interface TranslateResultMessage {
  type: 'TR_TRANSLATE_RESULT';
  sessionId: string;
  results: Array<{ id: string; html: string }>;
}

export interface TranslateErrorMessage {
  type: 'TR_TRANSLATE_ERROR';
  sessionId: string;
  code: string;
  message: string;
}

export interface TranslateBackoffMessage {
  type: 'TR_TRANSLATE_BACKOFF';
  sessionId: string;
  /** Extra ms to add to in-flight unit deadlines. */
  extendMs: number;
}

export type TransportInbound = TranslateResultMessage | TranslateErrorMessage | TranslateBackoffMessage;

export interface ScanOptions {
  /** Target language code (e.g. ZH, EN-US) for same-language skip heuristics. */
  targetLang?: string;
  /** Starting index for unit ids in this scan pass. */
  nextUnitIndex: number;
}

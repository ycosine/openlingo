export type ProviderId = 'deepl';

export type TagHandling = 'html' | 'xml' | 'none';

export interface TranslateRequest {
  texts: string[];
  sourceLang?: string;
  targetLang: string;
  tagHandling?: TagHandling;
  signal?: AbortSignal;
}

export interface ValidateResult {
  ok: boolean;
  message?: string;
}

export interface TranslationProvider {
  id: ProviderId;
  /** Translate a batch of texts. Result length === request.texts.length, same order. */
  translate(req: TranslateRequest): Promise<string[]>;
  /** Cheap auth check — usually hits a usage/account endpoint. */
  validate(apiKey: string): Promise<ValidateResult>;
  /** DeepL limit: 50 texts per request. */
  maxTextsPerRequest: number;
  /** Recommended total characters per request to avoid 413/timeouts. */
  softMaxCharsPerRequest: number;
}

export class TranslationError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

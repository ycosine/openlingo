export type ProviderId = 'google-free' | 'deepl' | 'openai-compatible';

export type CredentialField = 'apiKey' | 'baseUrl' | 'model' | 'systemPrompt';

export interface ProviderCredential {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
}

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
  validate(cred: ProviderCredential): Promise<ValidateResult>;
  maxTextsPerRequest: number;
  softMaxCharsPerRequest: number;
  /** True if the provider preserves HTML tags natively. Otherwise upstream strips tags before sending. */
  preservesHtml: boolean;
  /** Credential fields the provider needs — drives the Options UI form. */
  credentialFields: CredentialField[];
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

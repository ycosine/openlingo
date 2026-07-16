import { createAnthropicProvider } from './providers/anthropic.js';
import { createDeepLProvider } from './providers/deepl.js';
import { createGoogleFreeProvider } from './providers/google-free.js';
import {
  createDeepSeekProvider,
  createOpenAICompatibleProvider,
  createOpenAIProvider,
} from './providers/openai-compatible.js';
import type { CredentialField, ProviderCredential, ProviderId, TranslationProvider } from './types.js';

export const getProvider = (id: ProviderId, cred: ProviderCredential): TranslationProvider => {
  switch (id) {
    case 'google-free':
      return createGoogleFreeProvider();
    case 'deepl':
      return createDeepLProvider(cred.apiKey ?? '');
    case 'anthropic':
      return createAnthropicProvider(cred);
    case 'deepseek':
      return createDeepSeekProvider(cred);
    case 'openai':
      return createOpenAIProvider(cred);
    case 'openai-compatible':
      return createOpenAICompatibleProvider(cred);
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
};

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  /** Short tier/variant label shown next to the name. May be overridden at runtime (e.g. DeepL Free vs Pro). */
  tier: string;
  /** Endpoint label for the success banner. */
  endpoint: string;
  defaults?: Partial<ProviderCredential>;
  credentialFields: CredentialField[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'google-free',
    name: 'Google',
    tier: 'Free',
    endpoint: 'translate.googleapis.com',
    credentialFields: [],
  },
  {
    id: 'deepl',
    name: 'DeepL',
    tier: 'Free / Pro',
    endpoint: 'api.deepl.com',
    credentialFields: ['apiKey'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    tier: 'Claude',
    endpoint: 'api.anthropic.com',
    defaults: {
      model: 'claude-opus-4-8',
    },
    credentialFields: ['model', 'apiKey', 'systemPrompt'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tier: 'Chat',
    endpoint: 'api.deepseek.com',
    defaults: {
      model: 'deepseek-chat',
    },
    credentialFields: ['model', 'apiKey', 'systemPrompt'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tier: 'GPT',
    endpoint: 'api.openai.com',
    defaults: {
      model: 'gpt-4o-mini',
    },
    credentialFields: ['model', 'apiKey', 'systemPrompt'],
  },
  {
    id: 'openai-compatible',
    name: 'Custom',
    tier: 'OpenAI-compatible',
    endpoint: 'custom endpoint',
    credentialFields: ['baseUrl', 'model', 'apiKey', 'systemPrompt'],
  },
];

export const getProviderPreset = (id: ProviderId): ProviderPreset =>
  PROVIDER_PRESETS.find(p => p.id === id) ?? PROVIDER_PRESETS[0];

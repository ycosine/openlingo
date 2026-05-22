import { createDeepLProvider } from './providers/deepl.js';
import type { ProviderId, TranslationProvider } from './types.js';

export const getProvider = (id: ProviderId, apiKey: string): TranslationProvider => {
  switch (id) {
    case 'deepl':
      return createDeepLProvider(apiKey);
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
};

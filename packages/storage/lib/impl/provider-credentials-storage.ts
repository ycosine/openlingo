import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/index.js';

type ProviderIdLike = 'google-free' | 'deepl' | 'anthropic' | 'deepseek' | 'openai' | 'openai-compatible';

interface ProviderCredentialEntry {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
}

type ProviderCredentialsMap = Partial<Record<ProviderIdLike, ProviderCredentialEntry>>;

const STORAGE_KEY = 'provider-credentials';

// Sync storage so credentials survive uninstall/reinstall and follow the
// signed-in browser profile. Values are small and fit the per-item quota.
const base: BaseStorageType<ProviderCredentialsMap> = createStorage<ProviderCredentialsMap>(
  STORAGE_KEY,
  {},
  {
    storageEnum: StorageEnum.Sync,
    liveUpdate: true,
  },
);

interface ProviderCredentialsStorage extends BaseStorageType<ProviderCredentialsMap> {
  getFor: (id: ProviderIdLike) => Promise<ProviderCredentialEntry>;
  setFor: (id: ProviderIdLike, entry: ProviderCredentialEntry) => Promise<void>;
}

const providerCredentialsStorage: ProviderCredentialsStorage = {
  ...base,
  async getFor(id) {
    const map = await base.get();
    return map?.[id] ?? {};
  },
  async setFor(id, entry) {
    const map = (await base.get()) ?? {};
    await base.set({ ...map, [id]: entry });
  },
};

export type { ProviderIdLike, ProviderCredentialEntry, ProviderCredentialsMap, ProviderCredentialsStorage };
export { providerCredentialsStorage };

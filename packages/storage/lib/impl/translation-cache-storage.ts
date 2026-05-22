import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/index.js';

interface CacheEntryType {
  v: string;
  t: number;
}

interface TranslationCacheType {
  entries: Record<string, CacheEntryType>;
}

const MAX_ENTRIES = 2000;

const base: BaseStorageType<TranslationCacheType> = createStorage<TranslationCacheType>(
  'translation-cache',
  { entries: {} },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: false,
  },
);

export const translationCacheStorage = {
  ...base,
  async getMany(keys: string[]): Promise<Record<string, string | undefined>> {
    const { entries } = await base.get();
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = entries[k]?.v;
    return out;
  },
  async putMany(pairs: Record<string, string>): Promise<void> {
    await base.set(prev => {
      const next: Record<string, CacheEntryType> = { ...prev.entries };
      const now = Date.now();
      for (const [k, v] of Object.entries(pairs)) {
        next[k] = { v, t: now };
      }
      const all = Object.entries(next);
      if (all.length > MAX_ENTRIES) {
        all.sort((a, b) => a[1].t - b[1].t);
        const drop = all.slice(0, all.length - MAX_ENTRIES);
        for (const [k] of drop) delete next[k];
      }
      return { entries: next };
    });
  },
  async size(): Promise<number> {
    const { entries } = await base.get();
    return Object.keys(entries).length;
  },
  async clear(): Promise<void> {
    await base.set({ entries: {} });
  },
};

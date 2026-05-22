import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/index.js';

type ProviderIdType = 'google-free' | 'deepl' | 'openai-compatible';

type DisplayStyleType = 'block' | 'replace';

interface TranslationSettingsType {
  provider: ProviderIdType;
  targetLang: string;
  sourceLang: string;
  displayStyle: DisplayStyleType;
}

const DEFAULTS: TranslationSettingsType = {
  provider: 'google-free',
  targetLang: 'ZH',
  sourceLang: 'auto',
  displayStyle: 'block',
};

const translationSettingsStorage: BaseStorageType<TranslationSettingsType> = createStorage<TranslationSettingsType>(
  'translation-settings',
  DEFAULTS,
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export type { ProviderIdType };
export { translationSettingsStorage };

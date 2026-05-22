import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/index.js';

type ProviderIdType = 'deepl';

type DisplayStyleType = 'block' | 'replace';

interface TranslationSettingsType {
  provider: ProviderIdType;
  targetLang: string;
  sourceLang: string;
  displayStyle: DisplayStyleType;
}

const DEFAULTS: TranslationSettingsType = {
  provider: 'deepl',
  targetLang: 'ZH',
  sourceLang: 'auto',
  displayStyle: 'block',
};

export const translationSettingsStorage: BaseStorageType<TranslationSettingsType> =
  createStorage<TranslationSettingsType>('translation-settings', DEFAULTS, {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  });

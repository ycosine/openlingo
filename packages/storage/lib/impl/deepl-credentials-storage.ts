import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/index.js';

interface DeepLCredentialsType {
  apiKey: string;
}

export const deepLCredentialsStorage: BaseStorageType<DeepLCredentialsType> = createStorage<DeepLCredentialsType>(
  'deepl-credentials',
  { apiKey: '' },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

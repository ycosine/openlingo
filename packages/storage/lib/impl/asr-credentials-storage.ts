import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/index.js';

interface AsrCredentialsType {
  elevenlabsApiKey: string;
}

const asrCredentialsStorage: BaseStorageType<AsrCredentialsType> = createStorage<AsrCredentialsType>(
  'asr-credentials',
  { elevenlabsApiKey: '' },
  {
    storageEnum: StorageEnum.Sync,
    liveUpdate: true,
  },
);

export type { AsrCredentialsType };
export { asrCredentialsStorage };

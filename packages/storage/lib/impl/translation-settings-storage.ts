import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType, ValueOrUpdateType } from '../base/index.js';

type ProviderIdType = 'google-free' | 'deepl' | 'openai-compatible';

type DisplayStyleType = 'block' | 'replace';

type SubtitleStyleType = 'serif' | 'sans' | 'mono';

interface VideoSubtitlesSettingsType {
  /** Master switch — turn the feature on for every supported site. */
  enabled: boolean;
  /** Auto-engage on YouTube when the user opens a video. */
  youtubeAutoEnable: boolean;
  /** Route YouTube captions through OpenLingo translation pipeline. When off,
   *  rely on YouTube's own translation (handled by the player itself). */
  youtubeTranslate: boolean;
  /** Cleaner sentence-level re-segmentation of YouTube's auto-captions. */
  youtubeBasicSegmentation: boolean;
  /** LLM-driven re-segmentation (slower / costlier — opt-in). */
  youtubeAiSegmentation: boolean;
  /** Auto-translate live captions on Teams / Zoom / Meet. */
  meetingsAutoEnable: boolean;
  /** When multiple tracks exist, take a manual track over YouTube's `asr`. */
  preferHumanCaptions: boolean;
  /** Drop bracketed (music) / (applause) / (laughter) cues. */
  filterAmbient: boolean;
  /** Typography preset for the translation overlay line. */
  subtitleStyle: SubtitleStyleType;
}

interface TranslationSettingsType {
  provider: ProviderIdType;
  targetLang: string;
  sourceLang: string;
  displayStyle: DisplayStyleType;
  videoSubtitles: VideoSubtitlesSettingsType;
}

const VIDEO_SUBTITLES_DEFAULTS: VideoSubtitlesSettingsType = {
  enabled: true,
  youtubeAutoEnable: true,
  youtubeTranslate: true,
  youtubeBasicSegmentation: true,
  youtubeAiSegmentation: false,
  meetingsAutoEnable: true,
  preferHumanCaptions: true,
  filterAmbient: true,
  subtitleStyle: 'serif',
};

const DEFAULTS: TranslationSettingsType = {
  provider: 'google-free',
  targetLang: 'ZH',
  sourceLang: 'auto',
  displayStyle: 'block',
  videoSubtitles: VIDEO_SUBTITLES_DEFAULTS,
};

const hasFullVideoSubtitles = (v: VideoSubtitlesSettingsType | undefined): v is VideoSubtitlesSettingsType =>
  !!v &&
  typeof v === 'object' &&
  'enabled' in v &&
  'youtubeAutoEnable' in v &&
  'youtubeTranslate' in v &&
  'subtitleStyle' in v;

const normalize = (value: TranslationSettingsType | null | undefined): TranslationSettingsType => {
  if (!value) return DEFAULTS;
  if (hasFullVideoSubtitles(value.videoSubtitles)) return value;
  const partial: Partial<VideoSubtitlesSettingsType> =
    value.videoSubtitles && typeof value.videoSubtitles === 'object'
      ? (value.videoSubtitles as Partial<VideoSubtitlesSettingsType>)
      : {};
  return { ...value, videoSubtitles: { ...VIDEO_SUBTITLES_DEFAULTS, ...partial } };
};

const baseStorage: BaseStorageType<TranslationSettingsType> = createStorage<TranslationSettingsType>(
  'translation-settings',
  DEFAULTS,
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

const translationSettingsStorage: BaseStorageType<TranslationSettingsType> = {
  get: async () => normalize(await baseStorage.get()),
  set: (value: ValueOrUpdateType<TranslationSettingsType>) => {
    if (typeof value === 'function') {
      const updater = value as (
        prev: TranslationSettingsType,
      ) => Promise<TranslationSettingsType> | TranslationSettingsType;
      return baseStorage.set(async prev => updater(normalize(prev)));
    }
    return baseStorage.set(value);
  },
  subscribe: listener => baseStorage.subscribe(listener),
  getSnapshot: () => normalize(baseStorage.getSnapshot()),
};

export type { ProviderIdType, SubtitleStyleType, VideoSubtitlesSettingsType, TranslationSettingsType };
export { translationSettingsStorage, VIDEO_SUBTITLES_DEFAULTS };

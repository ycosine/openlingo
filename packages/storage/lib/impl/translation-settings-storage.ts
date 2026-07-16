import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType, ValueOrUpdateType } from '../base/index.js';

type ProviderIdType = 'google-free' | 'deepl' | 'openai-compatible';

type DisplayStyleType = 'block' | 'replace';

type PageTranslationFontType = 'lxgw-wenkai-lite' | 'page' | 'sans' | 'serif';

type SubtitleStyleType = 'serif' | 'sans' | 'mono';

type SubtitleFontScaleType = 0.65 | 0.75 | 0.85 | 1;

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
  /** Offer live ElevenLabs transcription when YouTube has no caption track. */
  youtubeAsrFallbackEnabled: boolean;
  /** ElevenLabs source language, or auto-detect when set to `auto`. */
  youtubeAsrLanguage: string;
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
  /** Scale factor applied to the translation line on top of the platform's
   *  own caption font size (so it follows player-size scaling). */
  subtitleFontScale: SubtitleFontScaleType;
}

interface TranslationSettingsType {
  provider: ProviderIdType;
  targetLang: string;
  sourceLang: string;
  displayStyle: DisplayStyleType;
  /** Font used for translations injected into webpages. */
  pageTranslationFont: PageTranslationFontType;
  videoSubtitles: VideoSubtitlesSettingsType;
}

const PAGE_TRANSLATION_FONTS: readonly PageTranslationFontType[] = ['lxgw-wenkai-lite', 'page', 'sans', 'serif'];

const DEFAULT_PAGE_TRANSLATION_FONT: PageTranslationFontType = 'lxgw-wenkai-lite';

const VIDEO_SUBTITLES_DEFAULTS: VideoSubtitlesSettingsType = {
  enabled: true,
  youtubeAutoEnable: true,
  youtubeTranslate: true,
  youtubeBasicSegmentation: true,
  youtubeAsrFallbackEnabled: true,
  youtubeAsrLanguage: 'auto',
  youtubeAiSegmentation: false,
  meetingsAutoEnable: true,
  preferHumanCaptions: true,
  filterAmbient: true,
  subtitleStyle: 'serif',
  subtitleFontScale: 1,
};

const DEFAULTS: TranslationSettingsType = {
  provider: 'google-free',
  targetLang: 'ZH',
  sourceLang: 'auto',
  displayStyle: 'block',
  pageTranslationFont: DEFAULT_PAGE_TRANSLATION_FONT,
  videoSubtitles: VIDEO_SUBTITLES_DEFAULTS,
};

const SUBTITLE_FONT_SCALES: readonly SubtitleFontScaleType[] = [0.65, 0.75, 0.85, 1];

const normalizeSubtitleFontScale = (value: unknown): SubtitleFontScaleType =>
  SUBTITLE_FONT_SCALES.includes(value as SubtitleFontScaleType) ? (value as SubtitleFontScaleType) : 1;

const normalizePageTranslationFont = (value: unknown): PageTranslationFontType =>
  PAGE_TRANSLATION_FONTS.includes(value as PageTranslationFontType)
    ? (value as PageTranslationFontType)
    : DEFAULT_PAGE_TRANSLATION_FONT;

let lastNormalizedSource: TranslationSettingsType | null | undefined;
let lastNormalizedValue: TranslationSettingsType = DEFAULTS;

const normalize = (value: TranslationSettingsType | null | undefined): TranslationSettingsType => {
  if (!value) return DEFAULTS;
  if (value === lastNormalizedSource) return lastNormalizedValue;

  const partial: Partial<VideoSubtitlesSettingsType> =
    value.videoSubtitles && typeof value.videoSubtitles === 'object'
      ? (value.videoSubtitles as Partial<VideoSubtitlesSettingsType>)
      : {};
  const normalized: TranslationSettingsType = {
    ...value,
    pageTranslationFont: normalizePageTranslationFont(value.pageTranslationFont),
    videoSubtitles: {
      ...VIDEO_SUBTITLES_DEFAULTS,
      ...partial,
      subtitleFontScale: normalizeSubtitleFontScale(partial.subtitleFontScale),
    },
  };

  lastNormalizedSource = value;
  lastNormalizedValue = normalized;
  return normalized;
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

export type {
  ProviderIdType,
  PageTranslationFontType,
  SubtitleStyleType,
  SubtitleFontScaleType,
  VideoSubtitlesSettingsType,
  TranslationSettingsType,
};
export { DEFAULT_PAGE_TRANSLATION_FONT, translationSettingsStorage, VIDEO_SUBTITLES_DEFAULTS };

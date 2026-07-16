import { useStorage } from '@extension/shared';
import { asrCredentialsStorage, translationSettingsStorage } from '@extension/storage';
import { useEffect, useState } from 'react';
import type { SubtitleFontScaleType, SubtitleStyleType, VideoSubtitlesSettingsType } from '@extension/storage';
import type { CSSProperties, ReactNode } from 'react';

const ACCENT = '#0F4F4A';
const INK = '#15201F';
const INK_SOFT = 'rgba(21,32,31,0.62)';
const CARD_BORDER = 'rgba(15,79,74,0.10)';

const SUPPORTED_SITES = ['YouTube'];
const ASR_LANGUAGES = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
];

const cardStyle: CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 14,
  border: `0.5px solid ${CARD_BORDER}`,
  padding: '20px 22px',
  marginBottom: 18,
};

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div style={cardStyle}>
    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0, marginBottom: 18 }}>{title}</div>
    <div>{children}</div>
  </div>
);

const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    role="switch"
    aria-checked={value}
    style={{
      position: 'relative',
      width: 36,
      height: 20,
      border: 0,
      padding: 0,
      borderRadius: 999,
      cursor: 'pointer',
      flexShrink: 0,
      background: value ? ACCENT : 'rgba(15,79,74,0.18)',
      transition: 'background 0.15s',
      boxShadow: value ? `inset 0 1px 0 rgba(255,255,255,0.18)` : 'none',
    }}>
    <span
      style={{
        position: 'absolute',
        top: 2,
        left: value ? 18 : 2,
        width: 16,
        height: 16,
        borderRadius: 99,
        background: '#fff',
        boxShadow: '0 1px 3px rgba(15,79,74,0.25)',
        transition: 'left 0.15s cubic-bezier(.3,.7,.4,1)',
      }}
    />
  </button>
);

const Row = ({
  title,
  hint,
  control,
  indent,
}: {
  title: ReactNode;
  hint?: string;
  control: ReactNode;
  indent?: boolean;
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      padding: '12px 0',
      paddingLeft: indent ? 18 : 0,
      borderTop: indent ? 'none' : `0.5px solid rgba(15,79,74,0.07)`,
    }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: INK, letterSpacing: 0 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: 'rgba(21,32,31,0.55)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
    </div>
    <div style={{ flexShrink: 0 }}>{control}</div>
  </div>
);

const FONT_SCALE_OPTIONS: Array<{ id: SubtitleFontScaleType; label: string }> = [
  { id: 0.65, label: '65%' },
  { id: 0.75, label: '75%' },
  { id: 0.85, label: '85%' },
  { id: 1, label: '100%' },
];

const FontScaleSegmented = ({
  value,
  onChange,
}: {
  value: SubtitleFontScaleType;
  onChange: (v: SubtitleFontScaleType) => void;
}) => (
  <div
    style={{
      display: 'flex',
      padding: 2,
      background: 'rgba(15,79,74,0.08)',
      borderRadius: 7,
      gap: 1,
    }}>
    {FONT_SCALE_OPTIONS.map(o => {
      const active = value === o.id;
      return (
        <button
          type="button"
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            border: 0,
            fontFamily: 'inherit',
            padding: '4px 10px',
            borderRadius: 5,
            cursor: 'pointer',
            fontSize: 11.5,
            fontWeight: 500,
            background: active ? '#FFFFFF' : 'transparent',
            color: active ? INK : INK_SOFT,
            boxShadow: active ? '0 1px 2px rgba(15,79,74,0.12)' : 'none',
            minWidth: 32,
          }}>
          {o.label}
        </button>
      );
    })}
  </div>
);

const StyleSegmented = ({
  value,
  onChange,
}: {
  value: SubtitleStyleType;
  onChange: (v: SubtitleStyleType) => void;
}) => {
  const options: Array<{ id: SubtitleStyleType; label: string }> = [
    { id: 'serif', label: 'Serif italic' },
    { id: 'sans', label: 'Sans' },
    { id: 'mono', label: 'Mono' },
  ];
  return (
    <div
      style={{
        display: 'flex',
        padding: 2,
        background: 'rgba(15,79,74,0.08)',
        borderRadius: 7,
        gap: 1,
      }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button
            type="button"
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              border: 0,
              fontFamily: 'inherit',
              padding: '4px 10px',
              borderRadius: 5,
              cursor: 'pointer',
              fontSize: 11.5,
              fontWeight: 500,
              background: active ? '#FFFFFF' : 'transparent',
              color: active ? INK : INK_SOFT,
              boxShadow: active ? '0 1px 2px rgba(15,79,74,0.12)' : 'none',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

const PreviewPlayer = ({ style, fontScale }: { style: SubtitleStyleType; fontScale: SubtitleFontScaleType }) => {
  const fontStack =
    style === 'serif'
      ? 'Georgia, "Times New Roman", serif'
      : style === 'mono'
        ? '"Geist Mono", ui-monospace, monospace'
        : '"Geist", system-ui, sans-serif';
  const italic = style === 'serif' ? 'italic' : 'normal';
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 7',
        background: '#0E1620',
        borderRadius: 10,
        overflow: 'hidden',
        fontFamily: '"Geist", system-ui, sans-serif',
        color: '#fff',
      }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10.5,
          color: 'rgba(255,255,255,0.45)',
          letterSpacing: 0,
        }}>
        Subtitle preview
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 18,
          transform: 'translateX(-50%)',
          maxWidth: '86%',
          textAlign: 'center',
          padding: '10px 18px',
          background: 'rgba(8,12,18,0.82)',
          borderRadius: 7,
        }}>
        <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35, textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
          When you start something new, it&apos;s easy to feel overwhelmed by the size of the problem.
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: fontStack,
            fontStyle: italic,
            opacity: 0.9,
            fontSize: 13 * fontScale,
            lineHeight: 1.35,
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}>
          当你开始一件新事时，很容易被问题的规模压得喘不过气。
        </div>
      </div>
    </div>
  );
};

const VideoSubtitlesTab = () => {
  const settings = useStorage(translationSettingsStorage);
  const asrCredentials = useStorage(asrCredentialsStorage);
  const v = settings.videoSubtitles;
  const [asrKey, setAsrKey] = useState('');
  const [asrDirty, setAsrDirty] = useState(false);
  const [asrValidating, setAsrValidating] = useState(false);
  const [asrResult, setAsrResult] = useState<{ ok: boolean; message?: string } | null>(null);

  useEffect(() => {
    setAsrKey(asrCredentials.elevenlabsApiKey);
    setAsrDirty(false);
    setAsrResult(null);
  }, [asrCredentials.elevenlabsApiKey]);

  const update = (patch: Partial<VideoSubtitlesSettingsType>) =>
    translationSettingsStorage.set(prev => ({
      ...prev,
      videoSubtitles: { ...prev.videoSubtitles, ...patch },
    }));

  const saveAsrKey = async () => {
    await asrCredentialsStorage.set({ elevenlabsApiKey: asrKey.trim() });
    setAsrDirty(false);
  };

  const validateAsrKey = async () => {
    setAsrValidating(true);
    setAsrResult(null);
    try {
      const result = (await chrome.runtime.sendMessage({
        type: 'OL_ASR_VALIDATE',
        apiKey: asrKey.trim(),
      })) as { ok: boolean; message?: string };
      setAsrResult(result);
    } finally {
      setAsrValidating(false);
    }
  };

  return (
    <>
      <div style={{ ...cardStyle, marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0, marginBottom: 4 }}>
          Bilingual video subtitles
        </div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, lineHeight: 1.5, marginBottom: 14 }}>
          Adds a translation under the original line while a video plays. Works on YouTube once the player&apos;s own
          captions are turned on.
        </div>
        <PreviewPlayer style={v.subtitleStyle} fontScale={v.subtitleFontScale} />
      </div>

      <Card title="Video subtitles">
        <Row
          title="Enable bilingual subtitles everywhere"
          hint="When a supported video plays, OpenLingo will pair the original captions with a translation."
          control={<Toggle value={v.enabled} onChange={val => update({ enabled: val })} />}
        />
      </Card>

      <Card title="YouTube">
        <Row
          title="Auto-enable on YouTube"
          hint="Show bilingual subtitles automatically when a YouTube video starts."
          control={<Toggle value={v.youtubeAutoEnable} onChange={val => update({ youtubeAutoEnable: val })} />}
        />
        <Row
          title="Translate captions with OpenLingo"
          hint="Use your selected provider to translate. When off, YouTube's own machine translation is used as a fallback."
          control={<Toggle value={v.youtubeTranslate} onChange={val => update({ youtubeTranslate: val })} />}
        />
        <Row
          title="Basic sentence re-segmentation"
          hint="Stitches YouTube's auto-captions into cleaner sentences before translating."
          control={
            <Toggle value={v.youtubeBasicSegmentation} onChange={val => update({ youtubeBasicSegmentation: val })} />
          }
        />
      </Card>

      <Card title="Live transcription fallback">
        <Row
          title="Use ElevenLabs when captions are unavailable"
          hint="Chrome 116+ only. Audio is captured only after you click Start live transcription in the extension popup."
          control={
            <Toggle value={v.youtubeAsrFallbackEnabled} onChange={val => update({ youtubeAsrFallbackEnabled: val })} />
          }
        />
        <Row
          title="Recognition language"
          hint="Auto detection works for most videos; fixing the language can improve speed and accuracy."
          control={
            <select
              value={v.youtubeAsrLanguage}
              onChange={event => update({ youtubeAsrLanguage: event.target.value })}
              style={{
                minWidth: 128,
                border: `0.5px solid ${CARD_BORDER}`,
                borderRadius: 7,
                padding: '6px 9px',
                background: '#fff',
                color: INK,
                font: 'inherit',
                fontSize: 11.5,
              }}>
              {ASR_LANGUAGES.map(language => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          }
        />
        <div style={{ padding: '12px 0 2px', borderTop: `0.5px solid rgba(15,79,74,0.07)` }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: INK }}>ElevenLabs API key</div>
          <div style={{ fontSize: 11, color: 'rgba(21,32,31,0.55)', marginTop: 3, lineHeight: 1.45 }}>
            Stored locally. OpenLingo exchanges it for a 15-minute single-use Scribe token before audio capture starts.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              type="password"
              value={asrKey}
              placeholder="sk_…"
              onChange={event => {
                setAsrKey(event.target.value);
                setAsrDirty(true);
                setAsrResult(null);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: `0.5px solid ${CARD_BORDER}`,
                borderRadius: 8,
                padding: '8px 10px',
                background: '#fff',
                color: INK,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                fontSize: 11.5,
              }}
            />
            <button
              type="button"
              disabled={!asrKey.trim() || asrValidating}
              onClick={validateAsrKey}
              style={{
                border: `0.5px solid ${CARD_BORDER}`,
                borderRadius: 8,
                padding: '7px 12px',
                background: '#fff',
                color: ACCENT,
                cursor: !asrKey.trim() || asrValidating ? 'default' : 'pointer',
                opacity: !asrKey.trim() || asrValidating ? 0.45 : 1,
                font: 'inherit',
                fontSize: 11.5,
                fontWeight: 600,
              }}>
              {asrValidating ? 'Testing…' : 'Test'}
            </button>
            <button
              type="button"
              disabled={!asrDirty}
              onClick={() => void saveAsrKey()}
              style={{
                border: 0,
                borderRadius: 8,
                padding: '7px 12px',
                background: ACCENT,
                color: '#fff',
                cursor: asrDirty ? 'pointer' : 'default',
                opacity: asrDirty ? 1 : 0.45,
                font: 'inherit',
                fontSize: 11.5,
                fontWeight: 600,
              }}>
              Save
            </button>
          </div>
          {asrResult && (
            <div
              style={{
                marginTop: 9,
                padding: '8px 10px',
                borderRadius: 8,
                background: asrResult.ok ? '#E8F2EA' : '#FBEAEA',
                color: asrResult.ok ? '#1F5A41' : '#7A2828',
                fontSize: 11.5,
              }}>
              {asrResult.ok ? 'Key works. ElevenLabs Scribe is ready.' : asrResult.message || 'Key validation failed.'}
            </div>
          )}
        </div>
      </Card>

      <Card title="Caption preferences">
        <Row
          title="Filter out non-speech sounds"
          hint="Drops bracketed cues like (music) or (applause) so the line stays focused on dialogue."
          control={<Toggle value={v.filterAmbient} onChange={val => update({ filterAmbient: val })} />}
        />
        <Row
          title="Subtitle style"
          hint="Typography applied to the translated line. Original line always follows the platform's own caption style."
          control={<StyleSegmented value={v.subtitleStyle} onChange={val => update({ subtitleStyle: val })} />}
        />
        <Row
          title="Subtitle font size"
          hint="Relative to the platform's original caption size."
          control={
            <FontScaleSegmented value={v.subtitleFontScale} onChange={val => update({ subtitleFontScale: val })} />
          }
        />
      </Card>

      <Card title="Supported sites">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
          {SUPPORTED_SITES.map(s => (
            <span
              key={s}
              style={{
                fontSize: 11.5,
                padding: '4px 10px',
                borderRadius: 99,
                background: 'rgba(15,79,74,0.06)',
                color: INK,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                letterSpacing: 0,
              }}>
              {s}
            </span>
          ))}
        </div>
      </Card>
    </>
  );
};

export default VideoSubtitlesTab;

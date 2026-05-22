import { useStorage } from '@extension/shared';
import { translationSettingsStorage } from '@extension/storage';
import type { SubtitleStyleType, VideoSubtitlesSettingsType } from '@extension/storage';
import type { CSSProperties, ReactNode } from 'react';

const ACCENT = '#0F4F4A';
const INK = '#15201F';
const INK_SOFT = 'rgba(21,32,31,0.62)';
const INK_FAINT = 'rgba(21,32,31,0.42)';
const CARD_BORDER = 'rgba(15,79,74,0.10)';

const SUPPORTED_SITES = [
  'YouTube',
  'Bilibili',
  'Vimeo',
  'Udemy',
  'Disney+',
  'Netflix',
  'Coursera',
  'TED',
  'Twitch',
  'Teams',
  'Zoom',
  'Google Meet',
];

const cardStyle: CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 14,
  border: `0.5px solid ${CARD_BORDER}`,
  boxShadow: '0 1px 0 rgba(255,255,255,0.6) inset, 0 4px 14px rgba(15,79,74,0.06)',
  padding: '20px 22px',
  marginBottom: 18,
};

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div style={cardStyle}>
    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 18 }}>{title}</div>
    <div>{children}</div>
  </div>
);

const Beta = () => (
  <span
    style={{
      marginLeft: 6,
      fontSize: 9.5,
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      padding: '1px 5px',
      borderRadius: 4,
      background: 'rgba(15,79,74,0.10)',
      color: 'rgba(15,79,74,0.85)',
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      verticalAlign: 'middle',
    }}>
    Beta
  </span>
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
      <div style={{ fontSize: 12.5, fontWeight: 500, color: INK, letterSpacing: '-0.005em' }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: 'rgba(21,32,31,0.55)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
    </div>
    <div style={{ flexShrink: 0 }}>{control}</div>
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

const PreviewPlayer = ({ style }: { style: SubtitleStyleType }) => {
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
        background: 'linear-gradient(155deg, #1a2a36 0%, #0e1620 55%, #050a10 100%)',
        borderRadius: 10,
        overflow: 'hidden',
        fontFamily: '"Geist", system-ui, sans-serif',
        color: '#fff',
      }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(60% 40% at 35% 30%, rgba(255,220,160,0.10), transparent 60%), radial-gradient(50% 70% at 80% 80%, rgba(80,140,160,0.20), transparent 70%)',
        }}
      />
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
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          letterSpacing: '0.05em',
        }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: '#E25555' }} />
        LIVE · talk.mp4
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
          background: 'rgba(8,12,18,0.55)',
          backdropFilter: 'blur(4px)',
          borderRadius: 10,
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
            fontSize: 13,
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
  const v = settings.videoSubtitles;

  const update = (patch: Partial<VideoSubtitlesSettingsType>) =>
    translationSettingsStorage.set(prev => ({
      ...prev,
      videoSubtitles: { ...prev.videoSubtitles, ...patch },
    }));

  return (
    <>
      <div style={{ ...cardStyle, marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 4 }}>
          Bilingual video subtitles
        </div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, lineHeight: 1.5, marginBottom: 14 }}>
          Adds a translation under the original line while a video plays. Works on supported sites once the
          player&apos;s own captions are turned on.
        </div>
        <PreviewPlayer style={v.subtitleStyle} />
      </div>

      <Card title="Video subtitles">
        <Row
          title="Enable bilingual subtitles everywhere"
          hint="When a video plays on any supported site, OpenLingo will pair the original captions with a translation."
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
          indent
          title="Basic sentence re-segmentation"
          hint="Stitches YouTube's auto-captions into cleaner sentences before translating."
          control={
            <Toggle value={v.youtubeBasicSegmentation} onChange={val => update({ youtubeBasicSegmentation: val })} />
          }
        />
        <Row
          indent
          title={
            <span>
              AI sentence segmentation <Beta />
            </span>
          }
          hint="Higher-quality segmentation via an extra LLM pass — costs slightly more tokens."
          control={<Toggle value={v.youtubeAiSegmentation} onChange={val => update({ youtubeAiSegmentation: val })} />}
        />
      </Card>

      <Card title="Meeting platforms">
        <Row
          title="Auto-enable on Teams, Zoom, Google Meet"
          hint="Translates live captions during meetings — captions must be enabled in the meeting first."
          control={<Toggle value={v.meetingsAutoEnable} onChange={val => update({ meetingsAutoEnable: val })} />}
        />
      </Card>

      <Card title="Caption preferences">
        <Row
          title="Prefer human-made captions when available"
          hint="On YouTube, Udemy, Disney+, etc. — use the creator's captions over auto-generated ones."
          control={<Toggle value={v.preferHumanCaptions} onChange={val => update({ preferHumanCaptions: val })} />}
        />
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
                letterSpacing: '0.01em',
              }}>
              {s}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: INK_FAINT, marginTop: 10 }}>
          v0.1 ships with YouTube; the other sites are scaffolding for upcoming adapter releases.
        </div>
      </Card>
    </>
  );
};

export default VideoSubtitlesTab;

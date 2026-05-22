import '@src/Popup.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { providerCredentialsStorage, translationSettingsStorage } from '@extension/storage';
import { getProviderPreset, PROVIDER_PRESETS } from '@extension/translation';
import { ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useEffect, useRef, useState } from 'react';
import type { ProviderId } from '@extension/translation';
import type { CSSProperties } from 'react';

type PageStatus = 'idle' | 'translating' | 'translated' | 'unknown';
type PopupState = 'noKey' | 'idle' | 'translating' | 'translated' | 'error';

const ACCENT = '#0F4F4A';
const BG = '#FBF7EE';
const FOOTER_BG = '#F6F1E5';
const INK = '#15201F';
const INK_SOFT = 'rgba(21,32,31,0.62)';
const INK_FAINT = 'rgba(21,32,31,0.42)';
const CARD_BORDER = 'rgba(15,79,74,0.10)';
const ACCENT_SOFT = `${ACCENT}14`;

interface LangSpec {
  native: string;
  code: string;
  english: string;
}

const LANGS: Record<string, LangSpec> = {
  ZH: { native: '中文', code: 'ZH', english: 'Chinese' },
  'EN-US': { native: 'English', code: 'EN', english: 'English (US)' },
  'EN-GB': { native: 'English', code: 'EN', english: 'English (UK)' },
  JA: { native: '日本語', code: 'JA', english: 'Japanese' },
  KO: { native: '한국어', code: 'KO', english: 'Korean' },
  FR: { native: 'Français', code: 'FR', english: 'French' },
  DE: { native: 'Deutsch', code: 'DE', english: 'German' },
  ES: { native: 'Español', code: 'ES', english: 'Spanish' },
  PT: { native: 'Português', code: 'PT', english: 'Portuguese' },
  RU: { native: 'Русский', code: 'RU', english: 'Russian' },
};

// ─── Icons ──────────────────────────────────────────────────────────────────

const SpeechMark = ({ color = ACCENT, size = 22 }: { color?: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <rect x="2" y="3" width="13" height="10" rx="2.8" fill={color} fillOpacity="0.28" />
    <rect x="7.5" y="9" width="14.5" height="11" rx="2.8" fill={color} />
    <path d="M10.6 19 L9 22.7 L13.8 19.3 Z" fill={color} />
  </svg>
);

const GearIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    <circle cx="12" cy="12" r="2.6" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const KeyIcon = ({ size = 26, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    <circle cx="7.5" cy="15.5" r="3.5" />
    <path d="M10 13 L20 3" />
    <path d="M16 7 L19 10" />
    <path d="M18.5 4.5 L21.5 7.5" />
  </svg>
);

const CheckIcon = ({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    <path d="M4 12 L10 18 L20 6" />
  </svg>
);

const AlertIcon = ({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    <path d="M12 9 V13" />
    <circle cx="12" cy="16.5" r="0.6" fill={color} stroke="none" />
    <path d="M10.6 3.6 L2.8 17.4 a1.6 1.6 0 0 0 1.4 2.4 H19.8 a1.6 1.6 0 0 0 1.4-2.4 L13.4 3.6 a1.6 1.6 0 0 0-2.8 0z" />
  </svg>
);

const ChevronIcon = ({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    <path d="M6 9 L12 15 L18 9" />
  </svg>
);

const Spinner = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    aria-hidden="true"
    style={{ animation: 'ol-spin 0.9s linear infinite' }}>
    <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M21 12 A9 9 0 0 0 12 3" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

// ─── Per-provider mini glyphs ──────────────────────────────────────────────

const ProviderGlyph = ({ id, color = ACCENT, size = 12 }: { id: ProviderId; color?: string; size?: number }) => {
  if (id === 'google-free') {
    // Google Translate: "A 文" letter-swap mark
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <text x="2" y="13" fontSize="11" fontWeight="700" fill={color} fontFamily="Geist, system-ui, sans-serif">
          A
        </text>
        <text
          x="11"
          y="21"
          fontSize="11"
          fontWeight="700"
          fill={color}
          fillOpacity="0.65"
          fontFamily="Geist, system-ui, sans-serif">
          文
        </text>
      </svg>
    );
  }
  if (id === 'deepl') {
    // DeepL: rounded blue square with a downward translation arrow
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <rect
          x="2"
          y="2"
          width="20"
          height="20"
          rx="4.5"
          fill={color}
          fillOpacity="0.16"
          stroke={color}
          strokeWidth="1.4"
        />
        <path
          d="M12 7 V16 M8 12.5 L12 16.5 L16 12.5"
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // OpenAI: simplified "Blossom" — three interlocking ellipses rotated around center
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
        <ellipse cx="12" cy="12" rx="8.5" ry="3.2" />
        <ellipse cx="12" cy="12" rx="8.5" ry="3.2" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="8.5" ry="3.2" transform="rotate(120 12 12)" />
      </g>
    </svg>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ProviderStatus {
  isReady: boolean;
  tier: string;
  detail: string;
}

const getProviderStatus = (
  providerId: ProviderId,
  cred: { apiKey?: string; baseUrl?: string; model?: string },
): ProviderStatus => {
  if (providerId === 'google-free') return { isReady: true, tier: 'Free', detail: 'free' };
  if (providerId === 'deepl') {
    const key = (cred.apiKey ?? '').trim();
    if (!key) return { isReady: false, tier: 'Free / Pro', detail: '' };
    const isFree = key.endsWith(':fx');
    const tail = key.replace(/:fx$/, '').slice(-3) || '···';
    return { isReady: true, tier: isFree ? 'Free' : 'Pro', detail: `··${tail}` };
  }
  const ready = !!(cred.apiKey?.trim() && cred.baseUrl?.trim() && cred.model?.trim());
  return { isReady: ready, tier: 'Compatible', detail: cred.model?.trim() || 'openai' };
};

const sendToActiveTab = async <T,>(msg: { type: string }): Promise<T | undefined> => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return undefined;
    return (await chrome.tabs.sendMessage(tab.id, msg)) as T;
  } catch {
    return undefined;
  }
};

// ─── Style atoms ────────────────────────────────────────────────────────────

const iconBtn = (color: string): CSSProperties => ({
  width: 26,
  height: 26,
  borderRadius: 7,
  border: 0,
  padding: 0,
  background: 'transparent',
  color,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.12s',
});

const linkBtn = (color: string): CSSProperties => ({
  background: 'transparent',
  border: 0,
  padding: 0,
  color,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'inherit',
});

const labelEyebrow = (color: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color,
  marginBottom: 6,
  fontFamily: '"Geist Mono", ui-monospace, monospace',
});

const langChip = (accent: string, ink: string, open: boolean): CSSProperties => ({
  width: '100%',
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 13px',
  background: open ? '#FFFFFF' : '#FFFFFFAA',
  border: `0.5px solid ${accent}${open ? '55' : '26'}`,
  borderRadius: 11,
  color: ink,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'background 0.12s, border-color 0.12s',
});

const primaryBtn = (accent: string, disabled = false): CSSProperties => ({
  position: 'relative',
  width: '100%',
  padding: '11px 14px',
  background: accent,
  color: '#fff',
  border: 0,
  borderRadius: 11,
  fontSize: 13.5,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  cursor: disabled ? 'default' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: disabled ? 'none' : `0 1px 0 rgba(255,255,255,0.18) inset, 0 6px 14px ${accent}33`,
  overflow: 'hidden',
  fontFamily: 'inherit',
});

const secondaryBtn = (ink: string): CSSProperties => ({
  width: '100%',
  padding: '11px 14px',
  background: 'rgba(21,32,31,0.06)',
  color: ink,
  border: '0.5px solid rgba(21,32,31,0.08)',
  borderRadius: 11,
  fontSize: 13.5,
  fontWeight: 500,
  letterSpacing: '-0.01em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

// ─── Popovers ───────────────────────────────────────────────────────────────

const LanguageMenu = ({ active, onPick }: { active: string; onPick: (code: string) => void }) => (
  <div
    style={{
      position: 'absolute',
      top: 'calc(100% + 6px)',
      left: 0,
      right: 0,
      zIndex: 3,
      background: '#FFFFFF',
      border: '0.5px solid rgba(15,79,74,0.14)',
      borderRadius: 12,
      boxShadow: '0 12px 28px rgba(15,79,74,0.18), 0 2px 6px rgba(15,79,74,0.08)',
      padding: 6,
      maxHeight: 240,
      overflowY: 'auto',
      animation: 'ol-popin 0.14s ease both',
    }}>
    {Object.entries(LANGS).map(([key, l]) => {
      const isActive = key === active;
      return (
        <button
          key={key}
          onClick={() => onPick(key)}
          style={{
            width: '100%',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 10px',
            borderRadius: 8,
            border: 0,
            background: isActive ? `${ACCENT}12` : 'transparent',
            color: INK,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => {
            if (!isActive) e.currentTarget.style.background = 'rgba(15,79,74,0.04)';
          }}
          onMouseLeave={e => {
            if (!isActive) e.currentTarget.style.background = 'transparent';
          }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>{l.native}</span>
            <span
              style={{
                fontSize: 10.5,
                color: INK_FAINT,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                letterSpacing: '0.04em',
              }}>
              {l.code}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: INK_FAINT }}>{l.english}</span>
            {isActive && (
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 99,
                  background: ACCENT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <CheckIcon size={9} color="#fff" />
              </span>
            )}
          </span>
        </button>
      );
    })}
  </div>
);

const ProviderMenu = ({ active, onPick }: { active: ProviderId; onPick: (id: ProviderId) => void }) => (
  <div
    style={{
      position: 'absolute',
      bottom: 'calc(100% + 4px)',
      right: 8,
      zIndex: 3,
      width: 220,
      background: '#FFFFFF',
      border: '0.5px solid rgba(15,79,74,0.14)',
      borderRadius: 12,
      boxShadow: '0 12px 28px rgba(15,79,74,0.18), 0 2px 6px rgba(15,79,74,0.08)',
      padding: 6,
      animation: 'ol-popin 0.14s ease both',
      fontFamily: '"Geist", system-ui, sans-serif',
    }}>
    <div
      style={{
        padding: '6px 10px 4px',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: INK_FAINT,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
      }}>
      Provider
    </div>
    {PROVIDER_PRESETS.map(p => {
      const isActive = p.id === active;
      return (
        <button
          key={p.id}
          onClick={() => onPick(p.id)}
          style={{
            width: '100%',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 8,
            border: 0,
            background: isActive ? `${ACCENT}12` : 'transparent',
            color: INK,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => {
            if (!isActive) e.currentTarget.style.background = 'rgba(15,79,74,0.04)';
          }}
          onMouseLeave={e => {
            if (!isActive) e.currentTarget.style.background = 'transparent';
          }}>
          <span style={{ color: ACCENT, flexShrink: 0, display: 'inline-flex' }}>
            <ProviderGlyph id={p.id} color={ACCENT} size={14} />
          </span>
          <span style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</span>
            <span
              style={{
                fontSize: 10.5,
                color: INK_FAINT,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                letterSpacing: '0.03em',
              }}>
              {p.tier}
            </span>
          </span>
          {isActive && (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 99,
                background: ACCENT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
              <CheckIcon size={9} color="#fff" />
            </span>
          )}
        </button>
      );
    })}
  </div>
);

// ─── Bodies ─────────────────────────────────────────────────────────────────

const BodyNoKey = ({
  providerId,
  providerName,
  onOpenOptions,
}: {
  providerId: ProviderId;
  providerName: string;
  onOpenOptions: () => void;
}) => {
  const title = providerId === 'deepl' ? `Add your ${providerName} API key` : 'Add a translation provider';
  const subtitle =
    providerId === 'deepl'
      ? `OpenLingo never sees it. Translations go straight from your browser to ${providerName}.`
      : 'Pick a model and add your credentials in Options. Your key stays in this browser.';
  return (
    <div style={{ padding: '8px 0 4px' }}>
      <div
        style={{
          margin: '6px auto 14px',
          width: 56,
          height: 56,
          borderRadius: 14,
          background: ACCENT_SOFT,
          border: `1px dashed ${ACCENT}33`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: ACCENT,
        }}>
        <KeyIcon size={26} color={ACCENT} />
      </div>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: INK, marginBottom: 4, letterSpacing: '-0.01em' }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, lineHeight: 1.45, maxWidth: 280, margin: '0 auto' }}>
          {subtitle}
        </div>
      </div>
      <button onClick={onOpenOptions} style={primaryBtn(ACCENT)}>
        Open Options
        <span style={{ marginLeft: 6, opacity: 0.85 }}>→</span>
      </button>
    </div>
  );
};

interface BodyHasKeyProps {
  state: PopupState;
  targetLang: string;
  openMenu: 'lang' | 'provider' | null;
  setOpenMenu: (m: 'lang' | 'provider' | null) => void;
  onPickLang: (code: string) => void;
  errorCode?: string;
  errorMsg?: string;
  onTranslate: () => void;
  onRestore: () => void;
}

const BodyHasKey = ({
  state,
  targetLang,
  openMenu,
  setOpenMenu,
  onPickLang,
  errorCode,
  errorMsg,
  onTranslate,
  onRestore,
}: BodyHasKeyProps) => {
  const translating = state === 'translating';
  const translated = state === 'translated';
  const error = state === 'error';
  const targ = LANGS[targetLang] ?? LANGS.ZH;

  return (
    <>
      <div style={{ marginTop: 4, position: 'relative' }}>
        <div style={labelEyebrow(INK_FAINT)}>Translate to</div>
        <button
          onClick={() => setOpenMenu(openMenu === 'lang' ? null : 'lang')}
          disabled={translating}
          style={{ ...langChip(ACCENT, INK, openMenu === 'lang'), opacity: translating ? 0.55 : 1 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em' }}>{targ.native}</span>
            <span
              style={{
                fontSize: 11,
                color: INK_FAINT,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                letterSpacing: '0.04em',
              }}>
              {targ.code}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: INK_FAINT, fontSize: 11 }}>
            <span>from Auto</span>
            <ChevronIcon size={11} />
          </span>
        </button>

        {openMenu === 'lang' && <LanguageMenu active={targetLang} onPick={onPickLang} />}
      </div>

      {translated && (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#2C7A5C' }}>
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 99,
              background: '#2C7A5C',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <CheckIcon size={11} color="#fff" />
          </span>
          <span style={{ color: INK }}>Page translated</span>
        </div>
      )}

      <div style={{ marginTop: translated ? 8 : 14 }}>
        {translating ? (
          <button disabled style={primaryBtn(ACCENT, true)}>
            <Spinner size={13} color="#fff" />
            <span style={{ marginLeft: 9 }}>Translating…</span>
          </button>
        ) : translated ? (
          <button onClick={onRestore} style={secondaryBtn(INK)}>
            Restore original
          </button>
        ) : (
          <button onClick={onTranslate} style={primaryBtn(ACCENT)}>
            Translate this page
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: '9px 11px',
            background: '#FBEAEA',
            border: '0.5px solid rgba(194,74,74,0.25)',
            borderRadius: 10,
            display: 'flex',
            gap: 9,
            alignItems: 'flex-start',
            fontSize: 12,
            color: '#7A2828',
            lineHeight: 1.4,
          }}>
          <span style={{ color: '#C24A4A', flexShrink: 0, marginTop: 1 }}>
            <AlertIcon size={13} color="#C24A4A" />
          </span>
          <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {errorCode && (
              <span
                style={{
                  fontFamily: '"Geist Mono", ui-monospace, monospace',
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  color: '#C24A4A',
                }}>
                {errorCode}
              </span>
            )}
            <span style={{ color: '#7A2828' }}>{errorMsg}</span>
          </div>
        </div>
      )}
    </>
  );
};

// ─── Main ───────────────────────────────────────────────────────────────────

const Popup = () => {
  const settings = useStorage(translationSettingsStorage);
  const credsMap = useStorage(providerCredentialsStorage);
  const providerId = settings.provider;
  const preset = getProviderPreset(providerId);
  const cred = credsMap?.[providerId] ?? {};
  const status = getProviderStatus(providerId, cred);

  const [openMenu, setOpenMenu] = useState<'lang' | 'provider' | null>(null);
  const [pageStatus, setPageStatus] = useState<PageStatus>('unknown');
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await sendToActiveTab<{ status: PageStatus; error?: string }>({ type: 'TR_PAGE_STATE' });
      if (cancelled) return;
      setPageStatus(res?.status ?? 'idle');
      if (res?.error) parseAndSetError(res.error);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openMenu]);

  const parseAndSetError = (raw: string) => {
    const m = raw.match(/^([A-Z_]+):\s*(.*)$/);
    if (m) {
      setErrorCode(m[1]);
      setErrorMsg(m[2]);
    } else {
      setErrorCode(undefined);
      setErrorMsg(raw);
    }
  };

  const clearError = () => {
    setErrorCode(undefined);
    setErrorMsg('');
  };

  const onTranslate = async () => {
    clearError();
    setPageStatus('translating');
    const res = await sendToActiveTab<{ ok: boolean; message?: string }>({ type: 'TR_PAGE_TRANSLATE' });
    if (!res) {
      setPageStatus('idle');
      parseAndSetError('PAGE: Cannot translate this page (e.g. chrome:// or extension page).');
      return;
    }
    if (!res.ok) {
      setPageStatus('idle');
      parseAndSetError(res.message ?? 'Translation failed');
      return;
    }
    window.close();
  };

  const onRestore = async () => {
    clearError();
    await sendToActiveTab({ type: 'TR_PAGE_RESTORE' });
    setPageStatus('idle');
    window.close();
  };

  const onOpenOptions = () => chrome.runtime.openOptionsPage();

  const onPickLang = (code: string) => {
    void translationSettingsStorage.set(prev => ({ ...prev, targetLang: code }));
    setOpenMenu(null);
  };

  const onPickProvider = (id: ProviderId) => {
    void translationSettingsStorage.set(prev => ({ ...prev, provider: id }));
    setOpenMenu(null);
  };

  const popupState: PopupState = !status.isReady
    ? 'noKey'
    : errorMsg
      ? 'error'
      : pageStatus === 'translating'
        ? 'translating'
        : pageStatus === 'translated'
          ? 'translated'
          : 'idle';

  return (
    <div
      ref={rootRef}
      style={{
        width: 360,
        position: 'relative',
        background: BG,
        overflow: 'hidden',
        fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        color: INK,
        fontFeatureSettings: '"ss01", "cv11"',
      }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <SpeechMark color={ACCENT} size={22} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>OpenLingo</span>
            <span
              style={{
                fontSize: 10.5,
                color: INK_FAINT,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                letterSpacing: '0.02em',
              }}>
              v0.1
            </span>
          </div>
        </div>
        <button onClick={onOpenOptions} title="Options" style={iconBtn(INK_SOFT)}>
          <GearIcon size={15} />
        </button>
      </div>

      <div style={{ padding: '4px 16px 14px' }}>
        {popupState === 'noKey' ? (
          <BodyNoKey providerId={providerId} providerName={preset.name} onOpenOptions={onOpenOptions} />
        ) : (
          <BodyHasKey
            state={popupState}
            targetLang={settings.targetLang}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
            onPickLang={onPickLang}
            errorCode={errorCode}
            errorMsg={errorMsg}
            onTranslate={onTranslate}
            onRestore={onRestore}
          />
        )}
      </div>

      <div
        style={{
          borderTop: `0.5px solid ${CARD_BORDER}`,
          background: FOOTER_BG,
          padding: '7px 10px 7px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11.5,
          color: INK_SOFT,
          position: 'relative',
        }}>
        <button
          onClick={onOpenOptions}
          style={{ ...linkBtn(INK_SOFT), display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0' }}>
          <GearIcon size={11} />
          <span>Options</span>
        </button>

        <button
          onClick={() => setOpenMenu(openMenu === 'provider' ? null : 'provider')}
          style={{
            ...linkBtn(INK_SOFT),
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '4px 8px',
            borderRadius: 7,
            background: openMenu === 'provider' ? 'rgba(15,79,74,0.06)' : 'transparent',
            transition: 'background 0.12s',
          }}>
          {status.isReady ? (
            <span style={{ color: ACCENT, display: 'flex', alignItems: 'center' }}>
              <ProviderGlyph id={providerId} color={ACCENT} size={12} />
            </span>
          ) : (
            <span style={{ width: 5, height: 5, borderRadius: 99, background: '#C58B3A' }} />
          )}
          <span
            style={{
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              fontSize: 10.5,
              letterSpacing: '0.04em',
              color: INK,
            }}>
            {preset.name}
            <span style={{ color: INK_FAINT }}>
              {status.isReady ? (
                <>
                  {' '}
                  · {status.tier}
                  {status.detail ? ` · ${status.detail}` : ''}
                </>
              ) : (
                ' · no key'
              )}
            </span>
          </span>
          <ChevronIcon size={10} color={INK_FAINT} />
        </button>

        {openMenu === 'provider' && <ProviderMenu active={providerId} onPick={onPickProvider} />}
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);

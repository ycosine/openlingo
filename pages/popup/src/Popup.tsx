import '@src/Popup.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { deepLCredentialsStorage, translationSettingsStorage } from '@extension/storage';
import { ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useEffect, useState } from 'react';
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

const LANGS: Record<string, { native: string; code: string }> = {
  ZH: { native: '中文', code: 'ZH' },
  EN: { native: 'English', code: 'EN' },
  'EN-US': { native: 'English', code: 'EN' },
  'EN-GB': { native: 'English', code: 'EN' },
  JA: { native: '日本語', code: 'JA' },
  KO: { native: '한국어', code: 'KO' },
  FR: { native: 'Français', code: 'FR' },
  DE: { native: 'Deutsch', code: 'DE' },
  ES: { native: 'Español', code: 'ES' },
  PT: { native: 'Português', code: 'PT' },
  RU: { native: 'Русский', code: 'RU' },
};

// ─── SVG marks ──────────────────────────────────────────────────────────────

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

const CheckIcon = ({ size = 11, color = 'currentColor' }: { size?: number; color?: string }) => (
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

const AlertIcon = ({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) => (
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

const ChevronIcon = ({ size = 11, color = 'currentColor' }: { size?: number; color?: string }) => (
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

const Spinner = ({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) => (
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

// ─── Style atoms ─────────────────────────────────────────────────────────────

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

const langChip = (accent: string, ink: string): CSSProperties => ({
  width: '100%',
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 13px',
  background: '#FFFFFFAA',
  border: `0.5px solid ${accent}26`,
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

// ─── Chrome plumbing ────────────────────────────────────────────────────────

const queryActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
  return tab;
};

const sendToActiveTab = async <T,>(message: unknown): Promise<T | undefined> => {
  const tab = await queryActiveTab();
  if (!tab?.id) return undefined;
  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) as T;
  } catch {
    return undefined;
  }
};

// ─── Body sub-components ─────────────────────────────────────────────────────

const BodyNoKey = ({ onOpenOptions }: { onOpenOptions: () => void }) => (
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
        Add your DeepL API key
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, lineHeight: 1.45, maxWidth: 280, margin: '0 auto' }}>
        OpenLingo never sees it. Translations go straight from your browser to DeepL.
      </div>
    </div>
    <button onClick={onOpenOptions} style={primaryBtn(ACCENT)}>
      Open Options
      <span style={{ marginLeft: 6, opacity: 0.85 }}>→</span>
    </button>
  </div>
);

interface BodyHasKeyProps {
  state: PopupState;
  targetLang: string;
  sourceLang: string;
  errorCode?: string;
  errorMsg?: string;
  onTranslate: () => void;
  onRestore: () => void;
  onChangeTarget: () => void;
}

const BodyHasKey = ({
  state,
  targetLang,
  sourceLang,
  errorCode,
  errorMsg,
  onTranslate,
  onRestore,
  onChangeTarget,
}: BodyHasKeyProps) => {
  const translating = state === 'translating';
  const translated = state === 'translated';
  const error = state === 'error';
  const targ = LANGS[targetLang] || LANGS.ZH;

  return (
    <>
      <div style={{ marginTop: 4 }}>
        <div style={labelEyebrow(INK_FAINT)}>Translate to</div>
        <button
          onClick={onChangeTarget}
          disabled={translating}
          style={{ ...langChip(ACCENT, INK), opacity: translating ? 0.55 : 1 }}>
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
            <span>from {sourceLang === 'auto' ? 'Auto' : sourceLang}</span>
            <ChevronIcon size={11} />
          </span>
        </button>
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
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
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
        </div>
      )}
    </>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────

const Popup = () => {
  const { apiKey } = useStorage(deepLCredentialsStorage);
  const settings = useStorage(translationSettingsStorage);
  const [status, setStatus] = useState<PageStatus>('unknown');
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await sendToActiveTab<{ status: PageStatus; error?: string }>({ type: 'TR_PAGE_STATE' });
      if (cancelled) return;
      setStatus(res?.status ?? 'idle');
      if (res?.error) parseAndSetError(res.error);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const parseAndSetError = (raw: string) => {
    // raw is "CODE: message" or just "message"
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

  const hasKey = apiKey.trim().length > 0;
  const freeKey = apiKey.trim().endsWith(':fx');
  const keyTail = apiKey.trim().replace(/:fx$/, '').slice(-3) || '···';

  const onTranslate = async () => {
    clearError();
    setStatus('translating');
    const res = await sendToActiveTab<{ ok: boolean; message?: string }>({ type: 'TR_PAGE_TRANSLATE' });
    if (!res) {
      setStatus('idle');
      parseAndSetError('PAGE: Cannot translate this page (e.g. chrome:// or extension page).');
      return;
    }
    if (!res.ok) {
      setStatus('idle');
      parseAndSetError(res.message ?? 'Translation failed');
      return;
    }
    // Progress is shown per-row on the page itself; no need to keep the popup open.
    window.close();
  };

  const onRestore = async () => {
    clearError();
    await sendToActiveTab({ type: 'TR_PAGE_RESTORE' });
    setStatus('idle');
    window.close();
  };

  const onOpenOptions = () => chrome.runtime.openOptionsPage();

  // Compute the visual state from the combined inputs.
  const popupState: PopupState = !hasKey
    ? 'noKey'
    : errorMsg
      ? 'error'
      : status === 'translating'
        ? 'translating'
        : status === 'translated'
          ? 'translated'
          : 'idle';

  return (
    <div
      style={{
        width: 360,
        background: BG,
        borderRadius: 18,
        boxShadow:
          '0 1px 0 rgba(255,255,255,0.6) inset, 0 14px 40px rgba(15,79,74,0.12), 0 2px 8px rgba(15,79,74,0.06)',
        border: `0.5px solid ${CARD_BORDER}`,
        overflow: 'hidden',
        fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        color: INK,
        fontFeatureSettings: '"ss01", "cv11"',
      }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 10px',
        }}>
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

      {/* Body */}
      <div style={{ padding: '4px 16px 14px' }}>
        {popupState === 'noKey' ? (
          <BodyNoKey onOpenOptions={onOpenOptions} />
        ) : (
          <BodyHasKey
            state={popupState}
            targetLang={settings.targetLang}
            sourceLang={settings.sourceLang}
            errorCode={errorCode}
            errorMsg={errorMsg}
            onTranslate={onTranslate}
            onRestore={onRestore}
            onChangeTarget={onOpenOptions}
          />
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: `0.5px solid ${CARD_BORDER}`,
          background: FOOTER_BG,
          padding: '9px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11.5,
          color: INK_SOFT,
        }}>
        <button onClick={onOpenOptions} style={{ ...linkBtn(INK_SOFT), display: 'flex', alignItems: 'center', gap: 5 }}>
          <GearIcon size={11} />
          <span>Options</span>
        </button>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: '"Geist Mono", ui-monospace, monospace',
            fontSize: 10.5,
          }}>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: !hasKey ? '#C58B3A' : popupState === 'error' ? '#C24A4A' : '#3FA678',
            }}
          />
          <span style={{ letterSpacing: '0.04em' }}>
            {!hasKey ? (
              'NO KEY'
            ) : (
              <>
                DeepL&nbsp;{freeKey ? 'Free' : 'Pro'} <span style={{ color: INK_FAINT }}>· ··{keyTail}</span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);

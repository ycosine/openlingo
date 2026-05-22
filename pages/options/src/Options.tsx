import '@src/Options.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { deepLCredentialsStorage, translationSettingsStorage } from '@extension/storage';
import { ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useState } from 'react';
import type { CSSProperties } from 'react';

const ACCENT = '#0F4F4A';
const INK = '#15201F';
const INK_SOFT = 'rgba(21,32,31,0.62)';
const INK_FAINT = 'rgba(21,32,31,0.42)';
const CARD_BG = '#FBF7EE';
const CARD_BORDER = 'rgba(15,79,74,0.10)';

const LANG_OPTIONS = [
  { code: 'ZH', label: '中文 (Chinese)' },
  { code: 'EN', label: 'English' },
  { code: 'EN-US', label: 'English (US)' },
  { code: 'EN-GB', label: 'English (UK)' },
  { code: 'JA', label: '日本語' },
  { code: 'KO', label: '한국어' },
  { code: 'FR', label: 'Français' },
  { code: 'DE', label: 'Deutsch' },
  { code: 'ES', label: 'Español' },
  { code: 'PT', label: 'Português' },
  { code: 'RU', label: 'Русский' },
];

const SOURCE_OPTIONS = [{ code: 'auto', label: 'Auto-detect' }, ...LANG_OPTIONS];

const SpeechMark = ({ size = 28 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <rect x="2" y="3" width="13" height="10" rx="2.8" fill={ACCENT} fillOpacity="0.28" />
    <rect x="7.5" y="9" width="14.5" height="11" rx="2.8" fill={ACCENT} />
    <path d="M10.6 19 L9 22.7 L13.8 19.3 Z" fill={ACCENT} />
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

const card: CSSProperties = {
  background: CARD_BG,
  border: `0.5px solid ${CARD_BORDER}`,
  borderRadius: 14,
  padding: 20,
  boxShadow: '0 1px 0 rgba(255,255,255,0.6) inset, 0 8px 24px rgba(15,79,74,0.06)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const sectionHeader: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: INK,
};

const sectionHint: CSSProperties = {
  fontSize: 12.5,
  color: INK_SOFT,
  lineHeight: 1.45,
  margin: 0,
};

const eyebrow: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: INK_FAINT,
  fontFamily: '"Geist Mono", ui-monospace, monospace',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 13px',
  background: '#FFFFFFAA',
  border: `0.5px solid ${ACCENT}26`,
  borderRadius: 11,
  fontSize: 13.5,
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  color: INK,
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtn = (disabled = false): CSSProperties => ({
  padding: '9px 16px',
  background: ACCENT,
  color: '#fff',
  border: 0,
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.45 : 1,
  fontFamily: 'inherit',
  boxShadow: disabled ? 'none' : `0 1px 0 rgba(255,255,255,0.18) inset, 0 4px 10px ${ACCENT}33`,
});

const secondaryBtn = (disabled = false): CSSProperties => ({
  padding: '9px 16px',
  background: 'rgba(21,32,31,0.06)',
  color: INK,
  border: '0.5px solid rgba(21,32,31,0.08)',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '-0.01em',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.45 : 1,
  fontFamily: 'inherit',
});

const Options = () => {
  const credentials = useStorage(deepLCredentialsStorage);
  const settings = useStorage(translationSettingsStorage);

  const [draftKey, setDraftKey] = useState<string>(credentials.apiKey);
  const [keyDirty, setKeyDirty] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const saveKey = async () => {
    await deepLCredentialsStorage.set({ apiKey: draftKey.trim() });
    setKeyDirty(false);
  };

  const testKey = async () => {
    setValidating(true);
    setValidateResult(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'TR_VALIDATE_KEY',
        apiKey: draftKey.trim(),
      })) as { ok: boolean; message?: string };
      setValidateResult(res);
    } finally {
      setValidating(false);
    }
  };

  const onTargetChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    translationSettingsStorage.set(prev => ({ ...prev, targetLang: e.target.value }));

  const onSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    translationSettingsStorage.set(prev => ({ ...prev, sourceLang: e.target.value }));

  const trimmed = draftKey.trim();
  const freeKey = trimmed.endsWith(':fx');

  return (
    <div style={{ minHeight: '100vh', padding: '48px 24px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <SpeechMark size={32} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: INK }}>
              OpenLingo
            </h1>
            <span
              style={{
                fontSize: 11,
                color: INK_FAINT,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                letterSpacing: '0.04em',
              }}>
              Options
            </span>
          </div>
        </header>

        <section style={card}>
          <div>
            <div style={eyebrow}>Section A</div>
            <div style={{ ...sectionHeader, marginTop: 4 }}>DeepL API Key</div>
          </div>
          <p style={sectionHint}>
            Keys ending in <code style={{ fontSize: 12 }}>:fx</code> use DeepL Free (api-free.deepl.com); otherwise
            DeepL Pro (api.deepl.com). The key never leaves your browser except to call DeepL directly.
          </p>
          <input
            type="password"
            value={draftKey}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx[:fx]"
            onChange={e => {
              setDraftKey(e.target.value);
              setKeyDirty(true);
              setValidateResult(null);
            }}
            style={inputStyle}
          />
          {trimmed && (
            <div
              style={{
                fontSize: 11,
                color: INK_FAINT,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                letterSpacing: '0.04em',
              }}>
              Endpoint: {freeKey ? 'DeepL Free' : 'DeepL Pro'} · ··{trimmed.replace(/:fx$/, '').slice(-3)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={saveKey} disabled={!keyDirty} style={primaryBtn(!keyDirty)}>
              Save
            </button>
            <button
              type="button"
              onClick={testKey}
              disabled={!trimmed || validating}
              style={secondaryBtn(!trimmed || validating)}>
              {validating ? 'Testing…' : 'Test'}
            </button>
          </div>
          {validateResult &&
            (validateResult.ok ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#2C7A5C' }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 99,
                    background: '#2C7A5C',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <CheckIcon size={11} color="#fff" />
                </span>
                <span>API key is valid</span>
              </div>
            ) : (
              <div
                style={{
                  padding: '9px 11px',
                  background: '#FBEAEA',
                  border: '0.5px solid rgba(194,74,74,0.25)',
                  borderRadius: 10,
                  display: 'flex',
                  gap: 9,
                  alignItems: 'flex-start',
                  fontSize: 12.5,
                  color: '#7A2828',
                  lineHeight: 1.4,
                }}>
                <AlertIcon size={13} color="#C24A4A" />
                <span>API key invalid: {validateResult.message ?? ''}</span>
              </div>
            ))}
        </section>

        <section style={card}>
          <div>
            <div style={eyebrow}>Section B</div>
            <div style={{ ...sectionHeader, marginTop: 4 }}>Translation preferences</div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...eyebrow, fontSize: 9.5 }}>Target language</span>
            <select value={settings.targetLang} onChange={onTargetChange} style={inputStyle}>
              {LANG_OPTIONS.map(o => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...eyebrow, fontSize: 9.5 }}>Source language</span>
            <select value={settings.sourceLang} onChange={onSourceChange} style={inputStyle}>
              {SOURCE_OPTIONS.map(o => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <footer
          style={{
            display: 'flex',
            justifyContent: 'center',
            color: INK_FAINT,
            fontSize: 11,
            fontFamily: '"Geist Mono", ui-monospace, monospace',
            letterSpacing: '0.04em',
            marginTop: 8,
          }}>
          OpenLingo v0.1 · MIT
        </footer>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);

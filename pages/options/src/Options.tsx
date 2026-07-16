import '@src/Options.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { providerCredentialsStorage, translationSettingsStorage } from '@extension/storage';
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE, getProviderPreset, PROVIDER_PRESETS } from '@extension/translation';
import { ErrorDisplay, LoadingSpinner } from '@extension/ui';
import VideoSubtitlesTab from '@src/VideoSubtitlesTab';
import { useEffect, useMemo, useState } from 'react';
import type { ProviderCredential, ProviderId } from '@extension/translation';
import type { CSSProperties, ReactNode } from 'react';

type TabId = 'general' | 'video';

const ACCENT = '#0F4F4A';
const INK = '#15201F';
const INK_SOFT = 'rgba(21,32,31,0.62)';
const INK_FAINT = 'rgba(21,32,31,0.42)';
const PAGE_BG = '#F4EFE3';
const CARD_BORDER = 'rgba(15,79,74,0.10)';

interface LangSpec {
  native: string;
  english: string;
}

interface ModelPreset {
  id: string;
  name: string;
  tier: 'Pro' | 'Max';
  baseUrl: string;
  model: string;
}

const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    tier: 'Pro',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'qwen-3.5-plus',
    name: 'Qwen 3.5 Plus',
    tier: 'Pro',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    tier: 'Pro',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.0-flash',
  },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', tier: 'Pro', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  { id: 'glm-4.7', name: 'GLM-4.7', tier: 'Pro', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7' },
  { id: 'gpt-5.4', name: 'GPT-5.4', tier: 'Max', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4' },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    tier: 'Max',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.1-pro',
  },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', tier: 'Max', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.5' },
  { id: 'glm-5', name: 'GLM-5', tier: 'Max', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5' },
];

const LANGS: Record<string, LangSpec> = {
  ZH: { native: '中文', english: 'Chinese' },
  'EN-US': { native: 'English', english: 'English (US)' },
  'EN-GB': { native: 'English', english: 'English (UK)' },
  JA: { native: '日本語', english: 'Japanese' },
  KO: { native: '한국어', english: 'Korean' },
  FR: { native: 'Français', english: 'French' },
  DE: { native: 'Deutsch', english: 'German' },
  ES: { native: 'Español', english: 'Spanish' },
  PT: { native: 'Português', english: 'Portuguese' },
  RU: { native: 'Русский', english: 'Russian' },
};

// ─── Icons ──────────────────────────────────────────────────────────────────

const SpeechMark = ({ color = ACCENT, size = 22 }: { color?: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <rect x="2" y="3" width="13" height="10" rx="2.8" fill={color} fillOpacity="0.28" />
    <rect x="7.5" y="9" width="14.5" height="11" rx="2.8" fill={color} />
    <path d="M10.6 19 L9 22.7 L13.8 19.3 Z" fill={color} />
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

const GithubIcon = ({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true">
    <path d="M12 .5C5.6.5.5 5.6.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6V20c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2.9-.3 1.9-.4 3-.4s2.1.1 3 .4c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.6 18.4.5 12 .5z" />
  </svg>
);

const EyeIcon = ({ open, size = 14, color = 'currentColor' }: { open: boolean; size?: number; color?: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    {open ? (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M3 3 L21 21" />
        <path d="M9.9 5.2 A11 11 0 0 1 23 12 c-.6 1.4-1.6 2.7-2.8 3.7 M6.2 6.6 A11 11 0 0 0 1 12 s4 8 11 8 c1.7 0 3.4-.4 4.8-1.1" />
      </>
    )}
  </svg>
);

const ProviderGlyph = ({ id, color = ACCENT, size = 15 }: { id: ProviderId; color?: string; size?: number }) => {
  if (id === 'google-free') {
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

// ─── Style helpers ──────────────────────────────────────────────────────────

const optBtn = (accent: string, primary: boolean, disabled = false): CSSProperties => {
  const base: CSSProperties = {
    height: 38,
    padding: '0 16px',
    borderRadius: 9,
    fontSize: 12.5,
    fontWeight: 500,
    letterSpacing: '-0.005em',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
  return primary
    ? {
        ...base,
        background: accent,
        color: '#fff',
        border: 0,
      }
    : {
        ...base,
        background: '#FBF9F2',
        color: accent,
        border: `0.5px solid ${accent}33`,
      };
};

const mono = (color: string): CSSProperties => ({
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  fontSize: '0.9em',
  color,
  background: 'rgba(15,79,74,0.06)',
  padding: '1px 5px',
  borderRadius: 4,
});

// ─── Small components ───────────────────────────────────────────────────────

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div
    style={{
      background: '#FFFFFF',
      borderRadius: 14,
      border: `0.5px solid ${CARD_BORDER}`,
      padding: '20px 22px',
      marginBottom: 18,
    }}>
    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 18 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>{children}</div>
  </div>
);

const Field = ({
  label,
  right,
  hint,
  children,
}: {
  label: string;
  right?: ReactNode;
  hint?: string;
  children: ReactNode;
}) => (
  <div>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: INK, letterSpacing: '-0.005em' }}>{label}</label>
      {right}
    </div>
    {children}
    {hint && <div style={{ fontSize: 11, color: 'rgba(21,32,31,0.55)', marginTop: 6, lineHeight: 1.45 }}>{hint}</div>}
  </div>
);

const KeyField = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) => {
  const [reveal, setReveal] = useState(false);
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        background: '#FBF9F2',
        border: `0.5px solid ${CARD_BORDER}`,
        borderRadius: 9,
        height: 38,
        transition: 'border-color 0.12s, background 0.12s',
      }}
      onFocusCapture={e => {
        e.currentTarget.style.borderColor = `${ACCENT}66`;
        e.currentTarget.style.background = '#FFFFFF';
      }}
      onBlurCapture={e => {
        e.currentTarget.style.borderColor = CARD_BORDER;
        e.currentTarget.style.background = '#FBF9F2';
      }}>
      <input
        type={reveal ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        style={{
          flex: 1,
          background: 'transparent',
          border: 0,
          outline: 'none',
          padding: '0 12px',
          height: '100%',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 12.5,
          color: INK,
          letterSpacing: '0.01em',
          minWidth: 0,
        }}
      />
      <button
        type="button"
        onClick={() => setReveal(r => !r)}
        title={reveal ? 'Hide' : 'Show'}
        style={{
          background: 'transparent',
          border: 0,
          padding: '0 12px',
          height: '100%',
          color: 'rgba(21,32,31,0.5)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}>
        <EyeIcon open={reveal} size={14} />
      </button>
    </div>
  );
};

const PlainInput = ({
  value,
  onChange,
  placeholder,
  monoFont,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  monoFont?: boolean;
  disabled?: boolean;
}) => (
  <input
    type="text"
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    disabled={disabled}
    spellCheck={false}
    autoCorrect="off"
    autoCapitalize="off"
    style={{
      width: '100%',
      boxSizing: 'border-box',
      background: disabled ? 'rgba(15,79,74,0.04)' : '#FBF9F2',
      border: `0.5px solid ${CARD_BORDER}`,
      borderRadius: 9,
      height: 38,
      padding: '0 12px',
      fontFamily: monoFont ? '"Geist Mono", ui-monospace, monospace' : 'inherit',
      fontSize: 12.5,
      color: disabled ? INK_SOFT : INK,
      letterSpacing: '0.01em',
      outline: 'none',
      cursor: disabled ? 'not-allowed' : 'text',
      transition: 'border-color 0.12s, background 0.12s',
    }}
    onFocus={e => {
      if (disabled) return;
      e.target.style.borderColor = `${ACCENT}66`;
      e.target.style.background = '#FFFFFF';
    }}
    onBlur={e => {
      if (disabled) return;
      e.target.style.borderColor = CARD_BORDER;
      e.target.style.background = '#FBF9F2';
    }}
  />
);

const Textarea = ({
  value,
  onChange,
  placeholder,
  minHeight = 80,
  monoFont,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  minHeight?: number;
  monoFont?: boolean;
}) => (
  <textarea
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    spellCheck={false}
    style={{
      width: '100%',
      boxSizing: 'border-box',
      background: '#FBF9F2',
      border: `0.5px solid ${CARD_BORDER}`,
      borderRadius: 9,
      padding: '10px 12px',
      minHeight,
      fontFamily: monoFont ? '"Geist Mono", ui-monospace, monospace' : 'inherit',
      fontSize: 12.5,
      color: INK,
      lineHeight: 1.55,
      outline: 'none',
      resize: 'vertical',
      transition: 'border-color 0.12s, background 0.12s',
    }}
    onFocus={e => {
      e.target.style.borderColor = `${ACCENT}66`;
      e.target.style.background = '#FFFFFF';
    }}
    onBlur={e => {
      e.target.style.borderColor = CARD_BORDER;
      e.target.style.background = '#FBF9F2';
    }}
  />
);

const ModelPresetSelect = ({
  baseUrl,
  model,
  onPick,
}: {
  baseUrl: string;
  model: string;
  onPick: (p: ModelPreset) => void;
}) => {
  const matchId = MODEL_PRESETS.find(p => p.baseUrl === baseUrl.trim() && p.model === model.trim())?.id ?? '';
  const proPresets = MODEL_PRESETS.filter(p => p.tier === 'Pro');
  const maxPresets = MODEL_PRESETS.filter(p => p.tier === 'Max');
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={matchId}
        onChange={e => {
          const found = MODEL_PRESETS.find(p => p.id === e.target.value);
          if (found) onPick(found);
        }}
        style={{
          width: '100%',
          appearance: 'none',
          WebkitAppearance: 'none',
          background: '#FBF9F2',
          border: `0.5px solid ${CARD_BORDER}`,
          borderRadius: 9,
          height: 38,
          padding: '0 36px 0 12px',
          fontFamily: '"Geist", system-ui, sans-serif',
          fontSize: 13,
          color: INK,
          cursor: 'pointer',
        }}>
        <option value="" disabled>
          {matchId ? '' : 'Custom — pick a preset to autofill'}
        </option>
        <optgroup label="Pro models">
          {proPresets.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Max models">
          {maxPresets.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      </select>
      <div
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          color: INK_FAINT,
          pointerEvents: 'none',
        }}>
        <ChevronIcon size={11} />
      </div>
    </div>
  );
};

const LangSelect = ({
  value,
  onChange,
  includeAuto,
}: {
  value: string;
  onChange: (v: string) => void;
  includeAuto?: boolean;
}) => (
  <div style={{ position: 'relative' }}>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        appearance: 'none',
        WebkitAppearance: 'none',
        background: '#FBF9F2',
        border: `0.5px solid ${CARD_BORDER}`,
        borderRadius: 9,
        height: 38,
        padding: '0 36px 0 12px',
        fontFamily: '"Geist", system-ui, sans-serif',
        fontSize: 13,
        color: INK,
        cursor: 'pointer',
      }}>
      {includeAuto && <option value="auto">Auto-detect</option>}
      {Object.entries(LANGS).map(([k, l]) => (
        <option key={k} value={k}>
          {l.native} — {l.english}
        </option>
      ))}
    </select>
    <div
      style={{
        position: 'absolute',
        right: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        color: INK_FAINT,
        pointerEvents: 'none',
      }}>
      <ChevronIcon size={11} />
    </div>
  </div>
);

// ─── Main ───────────────────────────────────────────────────────────────────

const Options = () => {
  const settings = useStorage(translationSettingsStorage);
  const credsMap = useStorage(providerCredentialsStorage);

  const providerId = settings.provider;
  const preset = useMemo(() => getProviderPreset(providerId), [providerId]);

  const storedCred: ProviderCredential = useMemo(() => credsMap?.[providerId] ?? {}, [credsMap, providerId]);

  const [draft, setDraft] = useState<ProviderCredential>({});
  const [dirty, setDirty] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const [tab, setTab] = useState<TabId>('general');

  useEffect(() => {
    const merged: ProviderCredential = { ...(preset.defaults ?? {}), ...storedCred };
    if (preset.credentialFields.includes('systemPrompt') && !merged.systemPrompt?.trim()) {
      merged.systemPrompt = DEFAULT_SYSTEM_PROMPT_TEMPLATE;
    }
    setDraft(merged);
    setDirty(false);
    setValidateResult(null);
    setSaveState('idle');
  }, [providerId, storedCred, preset.defaults, preset.credentialFields]);

  const updateDraft = (patch: Partial<ProviderCredential>) => {
    setDraft(prev => ({ ...prev, ...patch }));
    setDirty(true);
    setValidateResult(null);
    setSaveState('idle');
  };

  const onProviderChange = (id: ProviderId) => translationSettingsStorage.set(prev => ({ ...prev, provider: id }));

  const onTargetChange = (v: string) => translationSettingsStorage.set(prev => ({ ...prev, targetLang: v }));

  const onSourceChange = (v: string) => translationSettingsStorage.set(prev => ({ ...prev, sourceLang: v }));

  const save = async () => {
    const trimmed: ProviderCredential = {
      apiKey: draft.apiKey?.trim(),
      baseUrl: draft.baseUrl?.trim(),
      model: draft.model?.trim(),
      systemPrompt: draft.systemPrompt?.trim() ? draft.systemPrompt : undefined,
    };
    await providerCredentialsStorage.setFor(providerId, trimmed);
    setDirty(false);
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1400);
  };

  const test = async () => {
    setValidating(true);
    setValidateResult(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'TR_VALIDATE_KEY',
        providerId,
        credential: {
          apiKey: draft.apiKey?.trim(),
          baseUrl: draft.baseUrl?.trim(),
          model: draft.model?.trim(),
          systemPrompt: draft.systemPrompt,
        },
      })) as { ok: boolean; message?: string };
      setValidateResult(res);
    } finally {
      setValidating(false);
    }
  };

  const onOpenPopup = () => {
    void chrome.action.openPopup?.().catch(() => undefined);
  };

  const fields = preset.credentialFields;
  const requiresKey = fields.includes('apiKey');
  const requiresBaseUrl = fields.includes('baseUrl');
  const requiresModel = fields.includes('model');
  const hasAdvanced = fields.includes('systemPrompt');

  const trimmedKey = draft.apiKey?.trim() ?? '';
  const detectedTier = providerId === 'deepl' && trimmedKey ? (trimmedKey.endsWith(':fx') ? 'Free' : 'Pro') : null;

  const endpointLabel = (() => {
    if (providerId === 'google-free') return 'translate.googleapis.com';
    if (providerId === 'deepl') return trimmedKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const base = draft.baseUrl?.trim() || preset.defaults?.baseUrl || '';
    try {
      return new URL(base).host;
    } catch {
      return base || preset.endpoint;
    }
  })();

  const requiredFilled = fields
    .filter(f => f !== 'systemPrompt')
    .every(f => {
      const v = draft[f];
      return typeof v === 'string' && v.trim().length > 0;
    });

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: PAGE_BG,
        fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        color: INK,
        fontFeatureSettings: '"ss01", "cv11"',
      }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: PAGE_BG,
          borderBottom: `0.5px solid ${CARD_BORDER}`,
          padding: '14px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <SpeechMark color={ACCENT} size={22} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>OpenLingo</span>
            <span style={{ fontSize: 11, color: INK_FAINT, fontFamily: '"Geist Mono", ui-monospace, monospace' }}>
              Options
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: INK_SOFT }}>
          <a
            href="https://github.com/ycosine/openlingo"
            target="_blank"
            rel="noreferrer noopener"
            style={{
              color: INK_SOFT,
              textDecoration: 'none',
              display: 'inline-flex',
              gap: 5,
              alignItems: 'center',
            }}>
            <GithubIcon size={13} />
            github.com/ycosine/openlingo
          </a>
          <button
            onClick={onOpenPopup}
            style={{ ...optBtn(ACCENT, true), height: 32, padding: '0 12px', fontSize: 12 }}>
            <SpeechMark color="#fff" size={12} />
            <span style={{ marginLeft: 6 }}>Open popup</span>
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 660, margin: '0 auto', padding: '40px 32px 80px' }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>Settings</div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 22,
            borderBottom: `0.5px solid ${CARD_BORDER}`,
          }}>
          {(
            [
              { id: 'general', label: 'General' },
              { id: 'video', label: 'Video subtitles' },
            ] as const
          ).map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  position: 'relative',
                  border: 0,
                  background: 'transparent',
                  padding: '10px 14px 12px',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? INK : INK_SOFT,
                  cursor: 'pointer',
                  letterSpacing: '-0.005em',
                }}>
                {t.label}
                <span
                  style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    bottom: -1,
                    height: 2,
                    background: active ? ACCENT : 'transparent',
                    borderRadius: 2,
                    transition: 'background 0.15s',
                  }}
                />
              </button>
            );
          })}
        </div>

        {tab === 'video' && <VideoSubtitlesTab />}

        {tab === 'general' && (
          <>
            <Card title="Provider & API key">
              <Field
                label="Translation provider"
                hint="Each provider needs its own credentials. Switching here changes which ones are used.">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                    gap: 8,
                  }}>
                  {PROVIDER_PRESETS.map(p => {
                    const active = p.id === providerId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onProviderChange(p.id)}
                        style={{
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          padding: '10px 12px',
                          height: 44,
                          background: active ? `${ACCENT}0F` : '#FBF7EE',
                          border: `1px solid ${active ? `${ACCENT}88` : 'rgba(15,79,74,0.10)'}`,
                          borderRadius: 10,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                          transition: 'border-color 0.12s, background 0.12s',
                          outline: active ? `2px solid ${ACCENT}22` : 'none',
                          outlineOffset: '-1px',
                        }}>
                        <span style={{ color: ACCENT, display: 'inline-flex' }}>
                          <ProviderGlyph id={p.id} color={ACCENT} size={15} />
                        </span>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{p.name}</span>
                          <span
                            style={{
                              fontSize: 10,
                              color: INK_FAINT,
                              fontFamily: '"Geist Mono", ui-monospace, monospace',
                            }}>
                            {p.tier}
                          </span>
                        </span>
                        <span
                          style={{
                            flexShrink: 0,
                            width: 14,
                            height: 14,
                            borderRadius: 99,
                            background: active ? ACCENT : 'transparent',
                            border: active ? 'none' : '1.5px solid rgba(15,79,74,0.20)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                          {active && <CheckIcon size={9} color="#fff" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {requiresKey && (
                <Field
                  label={`${preset.name} key`}
                  right={
                    detectedTier && (
                      <span
                        style={{
                          fontSize: 11,
                          color: INK_FAINT,
                          fontFamily: '"Geist Mono", ui-monospace, monospace',
                          letterSpacing: '0.04em',
                        }}>
                        Detected: <span style={{ color: INK }}>{detectedTier}</span>
                      </span>
                    )
                  }>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <KeyField
                      value={draft.apiKey ?? ''}
                      onChange={v => updateDraft({ apiKey: v })}
                      placeholder={providerId === 'deepl' ? '00000000-0000-0000-0000-000000000000:fx' : 'sk-…'}
                    />
                    <button
                      type="button"
                      onClick={test}
                      disabled={!requiredFilled || validating}
                      style={optBtn(ACCENT, false, !requiredFilled || validating)}>
                      {validating ? (
                        <>
                          <Spinner size={12} color={ACCENT} />
                          <span style={{ marginLeft: 7 }}>Testing</span>
                        </>
                      ) : (
                        'Test'
                      )}
                    </button>
                    <button type="button" onClick={save} disabled={!dirty} style={optBtn(ACCENT, true, !dirty)}>
                      {saveState === 'saved' ? (
                        <>
                          <CheckIcon size={12} color="#fff" />
                          <span style={{ marginLeft: 7 }}>Saved</span>
                        </>
                      ) : (
                        'Save'
                      )}
                    </button>
                  </div>

                  {validateResult && (
                    <div
                      style={{
                        marginTop: 10,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 9,
                        padding: '9px 11px',
                        borderRadius: 9,
                        background: validateResult.ok ? '#E8F2EA' : '#FBEAEA',
                        border: validateResult.ok
                          ? '0.5px solid rgba(44,122,92,0.25)'
                          : '0.5px solid rgba(194,74,74,0.25)',
                        fontSize: 12.5,
                        lineHeight: 1.4,
                        color: validateResult.ok ? '#1F5A41' : '#7A2828',
                        animation: 'ol-fadeup 0.2s ease both',
                      }}>
                      {validateResult.ok ? (
                        <>
                          <span style={{ color: '#2C7A5C', flexShrink: 0, marginTop: 1 }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                width: 15,
                                height: 15,
                                borderRadius: 99,
                                background: '#2C7A5C',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}>
                              <CheckIcon size={9} color="#fff" />
                            </span>
                          </span>
                          <div style={{ flex: 1 }}>
                            <strong style={{ fontWeight: 600 }}>Key works.</strong> &nbsp;Endpoint:{' '}
                            <code style={mono('#1F5A41')}>{endpointLabel}</code>
                          </div>
                        </>
                      ) : (
                        <>
                          <span style={{ color: '#C24A4A', flexShrink: 0, marginTop: 1 }}>
                            <AlertIcon size={13} color="#C24A4A" />
                          </span>
                          <div style={{ flex: 1 }}>
                            <strong style={{ fontWeight: 600 }}>Test failed.</strong>{' '}
                            <span style={mono('#C24A4A')}>AUTH</span>{' '}
                            {validateResult.message ?? `${preset.name} rejected the credentials.`}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </Field>
              )}

              {requiresBaseUrl && (
                <Field
                  label="Model preset"
                  hint="Quick-fill Base URL + Model for popular providers. Anything OpenAI-compatible works here. Pick one and tweak below if you need.">
                  <ModelPresetSelect
                    baseUrl={draft.baseUrl ?? ''}
                    model={draft.model ?? ''}
                    onPick={p => updateDraft({ baseUrl: p.baseUrl, model: p.model })}
                  />
                </Field>
              )}

              {requiresBaseUrl && (
                <Field
                  label="Base URL"
                  right={
                    <span
                      style={{
                        fontSize: 11,
                        color: INK_FAINT,
                        fontFamily: '"Geist Mono", ui-monospace, monospace',
                      }}>
                      Default: {preset.defaults?.baseUrl ?? '—'}
                    </span>
                  }>
                  <PlainInput
                    value={draft.baseUrl ?? ''}
                    onChange={v => updateDraft({ baseUrl: v })}
                    placeholder={preset.defaults?.baseUrl ?? 'https://api.example.com/v1'}
                    monoFont
                  />
                </Field>
              )}

              {providerId === 'deepl' && (
                <Field
                  label="Base URL"
                  right={
                    <span
                      style={{
                        fontSize: 11,
                        color: INK_FAINT,
                        fontFamily: '"Geist Mono", ui-monospace, monospace',
                      }}>
                      Auto · key-derived
                    </span>
                  }
                  hint="DeepL's endpoint is derived from your API key — :fx keys hit the Free host, otherwise Pro.">
                  <PlainInput
                    value={
                      trimmedKey
                        ? trimmedKey.endsWith(':fx')
                          ? 'https://api-free.deepl.com'
                          : 'https://api.deepl.com'
                        : ''
                    }
                    onChange={() => undefined}
                    placeholder="https://api-free.deepl.com"
                    monoFont
                    disabled
                  />
                </Field>
              )}

              {requiresModel && (
                <Field
                  label="Model"
                  right={
                    <span
                      style={{
                        fontSize: 11,
                        color: INK_FAINT,
                        fontFamily: '"Geist Mono", ui-monospace, monospace',
                      }}>
                      Default: {preset.defaults?.model ?? '—'}
                    </span>
                  }>
                  <PlainInput
                    value={draft.model ?? ''}
                    onChange={v => updateDraft({ model: v })}
                    placeholder={preset.defaults?.model ?? 'gpt-4o-mini'}
                    monoFont
                  />
                </Field>
              )}

              {hasAdvanced && (
                <Field
                  label="System prompt"
                  right={
                    <button
                      type="button"
                      onClick={() => updateDraft({ systemPrompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE })}
                      style={{
                        background: 'transparent',
                        border: 0,
                        padding: 0,
                        cursor: 'pointer',
                        color: ACCENT,
                        fontSize: 11,
                        fontFamily: '"Geist Mono", ui-monospace, monospace',
                        letterSpacing: '0.04em',
                      }}>
                      {draft.systemPrompt?.trim() ? 'Reset to default' : 'Insert default template'}
                    </button>
                  }
                  hint="Placeholders: {{to}} → target language. Unknown placeholders are stripped. Leave empty to use the built-in template.">
                  <Textarea
                    value={draft.systemPrompt ?? ''}
                    onChange={v => updateDraft({ systemPrompt: v })}
                    placeholder={DEFAULT_SYSTEM_PROMPT_TEMPLATE}
                    minHeight={220}
                    monoFont
                  />
                </Field>
              )}

              {!requiresKey && !requiresBaseUrl && (
                <div
                  style={{
                    marginTop: -4,
                    padding: '9px 11px',
                    borderRadius: 9,
                    background: '#FBF9F2',
                    border: `0.5px solid ${CARD_BORDER}`,
                    fontSize: 12.5,
                    color: INK_SOFT,
                    display: 'flex',
                    gap: 9,
                    alignItems: 'flex-start',
                  }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      width: 15,
                      height: 15,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: 1,
                    }}>
                    <CheckIcon size={12} color={ACCENT} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontWeight: 600, color: INK }}>No API key required.</strong> Uses the public{' '}
                    <code style={mono(ACCENT)}>translate.googleapis.com</code> endpoint — unofficial, Google may
                    rate-limit heavy use.
                  </div>
                </div>
              )}
            </Card>

            <Card title="Translation">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Target language" hint="Where translations land.">
                  <LangSelect value={settings.targetLang} onChange={onTargetChange} />
                </Field>
                <Field label="Source language" hint="Auto-detect handles almost every page well.">
                  <LangSelect value={settings.sourceLang} onChange={onSourceChange} includeAuto />
                </Field>
              </div>
            </Card>
          </>
        )}

        <div style={{ fontSize: 11, color: INK_FAINT, textAlign: 'center', marginTop: 32 }}>
          Settings sync live across all your tabs.
        </div>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);

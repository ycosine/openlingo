/**
 * Inject the OpenLingo button into YouTube's player controls and manage a
 * lightweight per-video menu (status, bilingual toggle, link to Options).
 *
 * YouTube rebuilds the right-controls bar on navigation and on player resize,
 * so we re-inject defensively from a slow timer instead of a frame loop.
 */

const ACCENT = '#0F4F4A';
const BUTTON_ID = 'openlingo-yt-button';
const MENU_ID = 'openlingo-yt-menu';
const STYLE_TAG_ID = 'openlingo-yt-button-styles';

type Status = 'idle' | 'translating' | 'translated' | 'no-cues' | 'error';

type CaptionSource = 'ai' | 'human' | null;

interface ButtonState {
  enabled: boolean;
  status: Status;
  statusText: string;
  errorMessage?: string;
  /** YouTube CC is off; show the actionable "Turn on captions" notice. */
  needsCaptions: boolean;
  /** Which kind of captions feed the translation — drives the menu header. */
  captionSource: CaptionSource;
  /** Download .srt is only meaningful once translations have arrived. */
  canDownloadSrt: boolean;
}

interface ButtonCallbacks {
  onToggleEnabled: (enabled: boolean) => void;
  onOpenOptions: () => void;
  /** Programmatically click YouTube's CC button (or guide user there). */
  onEnableCaptions: () => void;
  /** Hide the OL button for the rest of this video. */
  onHideButton: () => void;
  /** Export the active session as an .srt file. */
  onDownloadSrt: () => void;
}

interface PlayerButtonHandle {
  setState: (patch: Partial<ButtonState>) => void;
  destroy: () => void;
}

const ensureStyleTag = (): void => {
  if (document.getElementById(STYLE_TAG_ID)) return;
  const css = `
    #${BUTTON_ID} {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      vertical-align: top;
      width: 48px;
      min-width: 48px;
      height: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: #fff;
      cursor: pointer;
      flex-shrink: 0;
      font: inherit;
    }
    .openlingo-yt-button-bubble {
      position: relative;
      width: 36px;
      height: 36px;
      border-radius: 9px;
      background: ${ACCENT};
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 1px 6px;
      box-sizing: border-box;
    }
    .openlingo-yt-button-mark {
      position: relative;
      display: block;
      width: 22px;
      height: 18px;
      flex-shrink: 0;
      pointer-events: none;
    }
    .openlingo-yt-button-mark-back,
    .openlingo-yt-button-mark-front {
      position: absolute;
      display: block;
      box-sizing: border-box;
      border-radius: 3px;
    }
    .openlingo-yt-button-mark-back {
      top: 0;
      left: 0;
      width: 14px;
      height: 10px;
      background: rgba(255,255,255,0.38);
    }
    .openlingo-yt-button-mark-front {
      right: 0;
      bottom: 0;
      width: 16px;
      height: 11px;
      background: #fff;
    }
    .openlingo-yt-button-mark-front::after {
      content: "";
      position: absolute;
      left: 3px;
      bottom: -3px;
      width: 0;
      height: 0;
      border-top: 4px solid #fff;
      border-right: 4px solid transparent;
    }
    .openlingo-yt-button-dot {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 9px;
      height: 9px;
      border-radius: 99px;
      background: #3FA678;
      border: 1.5px solid rgba(0,0,0,0.75);
    }
    .openlingo-yt-button-dot[data-status="translating"] {
      background: #E2B23F;
    }
    .openlingo-yt-button-dot[data-status="error"] {
      background: #C24A4A;
    }
    .openlingo-yt-button-dot[data-status="no-cues"] {
      background: #888;
    }
    .openlingo-yt-button-dot[data-status="idle"] {
      display: none;
    }
    .openlingo-yt-button-dot[data-needs-captions="1"] {
      display: block;
      background: #E2B23F;
    }

    #${MENU_ID} {
      position: absolute;
      right: 0;
      bottom: 44px;
      width: 240px;
      box-sizing: border-box;
      background: #171B20;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.32);
      padding: 6px;
      color: #fff;
      font-family: "Geist", -apple-system, system-ui, sans-serif;
      font-size: 12.5px;
      z-index: 70;
      animation: openlingo-popin 0.14s ease both;
    }
    @keyframes openlingo-popin {
      from { opacity: 0; transform: translateY(3px); }
      to { opacity: 1; transform: none; }
    }
    .openlingo-yt-menu-header {
      padding: 8px 10px 6px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      font-family: "Geist", -apple-system, system-ui, sans-serif;
      letter-spacing: 0;
    }
    .openlingo-yt-menu-item {
      width: 100%;
      text-align: left;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-radius: 7px;
      border: 0;
      background: transparent;
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-size: 12.5px;
    }
    .openlingo-yt-menu-item:hover:not(:disabled) {
      background: rgba(255,255,255,0.06);
    }
    .openlingo-yt-menu-item:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .openlingo-yt-menu-item .openlingo-yt-menu-tail {
      color: rgba(255,255,255,0.45);
      font-size: 11px;
      flex-shrink: 0;
    }
    .openlingo-yt-menu-check {
      width: 16px;
      height: 16px;
      border-radius: 4px;
      background: ${ACCENT};
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .openlingo-yt-menu-check[data-on="0"] {
      background: rgba(255,255,255,0.08);
    }
    .openlingo-yt-menu-check[data-on="0"] svg {
      visibility: hidden;
    }
    .openlingo-yt-menu-sep {
      height: 1px;
      background: rgba(255,255,255,0.08);
      margin: 4px 6px;
    }
    .openlingo-yt-menu-status {
      padding: 4px 10px 8px;
      font-size: 11px;
      color: rgba(255,255,255,0.62);
      line-height: 1.4;
    }
    .openlingo-yt-menu-error {
      padding: 4px 10px 8px;
      font-size: 10.5px;
      color: #E89B9B;
      line-height: 1.4;
    }
    .openlingo-yt-menu-caption-notice {
      margin: 4px 6px 6px;
      padding: 10px 11px 11px;
      background: #20252B;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .openlingo-yt-menu-caption-notice-title {
      font-size: 12px;
      font-weight: 600;
      color: #FFFFFF;
      line-height: 1.35;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .openlingo-yt-menu-caption-notice-title svg {
      flex-shrink: 0;
      margin-top: 1px;
    }
    .openlingo-yt-menu-caption-notice-body {
      font-size: 11px;
      line-height: 1.45;
      color: rgba(255,255,255,0.78);
    }
    .openlingo-yt-menu-caption-notice-cta {
      align-self: stretch;
      border: 0;
      border-radius: 5px;
      background: #E2B23F;
      color: #2A1F00;
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      padding: 7px 10px;
      cursor: pointer;
      transition: filter 0.12s ease;
    }
    .openlingo-yt-menu-caption-notice-cta:hover {
      filter: brightness(1.06);
    }
  `;
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
};

const speechMarkSvg = (size: number, opacity: number = 1): string => `
  <svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <rect x="2" y="3" width="13" height="10" rx="2.8" fill="#fff" fill-opacity="${0.28 * opacity}" />
    <rect x="7.5" y="9" width="14.5" height="11" rx="2.8" fill="#fff" fill-opacity="${opacity}" />
    <path d="M10.6 19 L9 22.7 L13.8 19.3 Z" fill="#fff" fill-opacity="${opacity}" />
  </svg>`;

const buttonMarkHtml = (): string => `
  <span class="openlingo-yt-button-mark" aria-hidden="true">
    <span class="openlingo-yt-button-mark-back"></span>
    <span class="openlingo-yt-button-mark-front"></span>
  </span>`;

const headerLabelFor = (state: ButtonState): string => {
  if (!state.enabled) return 'OpenLingo paused';
  if (state.status === 'error') return 'Translation error';
  if (state.status === 'no-cues') return 'No captions available';
  if (state.needsCaptions) return 'Captions are off';
  if (state.captionSource === 'ai') return 'Using auto-generated captions';
  if (state.captionSource === 'human') return 'Using creator captions';
  if (state.status === 'translating') return 'Translating…';
  return 'Waiting for captions';
};

const captionAlertSvg = (size: number): string => `
  <svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">
    <path d="M8 1.5 L15 14 L1 14 Z" fill="none" stroke="#FFD984" stroke-width="1.4" stroke-linejoin="round" />
    <rect x="7.2" y="6" width="1.6" height="4.4" rx="0.6" fill="#FFD984" />
    <rect x="7.2" y="11.2" width="1.6" height="1.6" rx="0.6" fill="#FFD984" />
  </svg>`;

const createPlayerButton = (callbacks: ButtonCallbacks, initial: ButtonState): PlayerButtonHandle => {
  ensureStyleTag();

  let state: ButtonState = { ...initial };
  let reinjectTimer = 0;
  let destroyed = false;
  let menuOpen = false;
  let removeOutsideClick: (() => void) | null = null;

  const menuStateKey = (value: ButtonState): string =>
    [
      value.enabled,
      value.status,
      value.errorMessage ?? '',
      value.needsCaptions,
      value.captionSource ?? '',
      value.canDownloadSrt,
    ].join('|');

  const buildButtonElement = (): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'ytp-button';
    btn.setAttribute('aria-label', 'OpenLingo bilingual subtitles');
    btn.title = 'OpenLingo';
    btn.innerHTML = `
      <span class="openlingo-yt-button-bubble">
        ${buttonMarkHtml()}
        <span class="openlingo-yt-button-dot" data-status="${state.status}" data-needs-captions="0"></span>
      </span>
    `;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      menuOpen = !menuOpen;
      paintMenu();
    });
    return btn;
  };

  const paintButton = (): void => {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const dot = btn.querySelector<HTMLElement>('.openlingo-yt-button-dot');
    if (dot) {
      dot.setAttribute('data-status', state.enabled ? state.status : 'idle');
      const showCaptionsHint =
        state.enabled && state.needsCaptions && state.status !== 'translating' && state.status !== 'translated';
      dot.setAttribute('data-needs-captions', showCaptionsHint ? '1' : '0');
    }
    btn.title = state.enabled && state.needsCaptions ? 'OpenLingo — turn on YouTube CC to start' : 'OpenLingo';
  };

  const removeMenu = (): void => {
    removeOutsideClick?.();
    removeOutsideClick = null;
    const existing = document.getElementById(MENU_ID);
    if (existing) existing.remove();
  };

  const paintMenu = (): void => {
    removeMenu();
    if (!menuOpen) return;
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const anchor = btn.closest<HTMLElement>('.ytp-chrome-bottom') ?? btn.parentElement;
    if (!anchor) return;

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    const showCallout =
      state.enabled && state.needsCaptions && state.status !== 'translating' && state.status !== 'translated';
    const headerLabel = headerLabelFor(state);
    menu.innerHTML = `
      <div class="openlingo-yt-menu-header">
        ${speechMarkSvg(10, 0.6)}
        <span>${escapeHtml(headerLabel)}</span>
      </div>
      ${
        state.status === 'error' && state.errorMessage
          ? `<div class="openlingo-yt-menu-error">${escapeHtml(state.errorMessage)}</div>`
          : ''
      }
      ${
        showCallout
          ? `<div class="openlingo-yt-menu-caption-notice">
              <div class="openlingo-yt-menu-caption-notice-title">
                ${captionAlertSvg(14)}
                <span>Turn on YouTube captions to start translating</span>
              </div>
              <div class="openlingo-yt-menu-caption-notice-body">
                OpenLingo translates the captions YouTube provides, so the player's CC button needs to be on for this video.
              </div>
              <button type="button" class="openlingo-yt-menu-caption-notice-cta" data-action="enable-captions">Turn on CC</button>
            </div>`
          : ''
      }
      <button class="openlingo-yt-menu-item" data-action="toggle">
        <span>Bilingual ${state.enabled ? 'on' : 'off'} for this video</span>
        <span class="openlingo-yt-menu-check" data-on="${state.enabled ? '1' : '0'}">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12 L10 18 L20 6"/>
          </svg>
        </span>
      </button>
      <button class="openlingo-yt-menu-item" data-action="hide">
        <span>Hide this button</span>
      </button>
      <button class="openlingo-yt-menu-item" data-action="download" ${state.canDownloadSrt ? '' : 'disabled'}>
        <span>Download .srt</span>
      </button>
      <div class="openlingo-yt-menu-sep"></div>
      <button class="openlingo-yt-menu-item" data-action="options">
        <span>Caption settings…</span>
        <span class="openlingo-yt-menu-tail">→</span>
      </button>
    `;
    anchor.appendChild(menu);

    menu.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const trigger = target.closest<HTMLElement>('[data-action]');
      if (!trigger) return;
      if (trigger.hasAttribute('disabled')) return;
      const action = trigger.getAttribute('data-action');
      if (action === 'enable-captions') {
        callbacks.onEnableCaptions();
        return;
      }
      if (action === 'toggle') {
        callbacks.onToggleEnabled(!state.enabled);
        return;
      }
      if (action === 'hide') {
        callbacks.onHideButton();
        menuOpen = false;
        return;
      }
      if (action === 'download') {
        callbacks.onDownloadSrt();
        menuOpen = false;
        paintMenu();
        return;
      }
      if (action === 'options') {
        callbacks.onOpenOptions();
        menuOpen = false;
        paintMenu();
      }
    });

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menu.contains(t) || btn.contains(t)) return;
      menuOpen = false;
      paintMenu();
    };
    document.addEventListener('mousedown', onDocClick, true);
    removeOutsideClick = () => document.removeEventListener('mousedown', onDocClick, true);
  };

  const escapeHtml = (s: string): string =>
    s.replace(/[&<>"']/g, ch =>
      ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
    );

  const ensureInjected = (): void => {
    if (document.getElementById(BUTTON_ID)) return;
    const rightControls =
      document.querySelector<HTMLElement>('.ytp-right-controls-left') ??
      document.querySelector<HTMLElement>('.ytp-right-controls');
    if (!rightControls) return;
    const btn = buildButtonElement();
    // Insert at the start of the right-controls bar so it sits left of CC,
    // settings, subtitles, etc. — close to where users look for caption
    // affordances.
    rightControls.insertBefore(btn, rightControls.firstChild);
    paintButton();
  };

  ensureInjected();
  reinjectTimer = window.setInterval(() => {
    if (!destroyed) ensureInjected();
  }, 750);

  return {
    setState: patch => {
      const previousMenuState = menuStateKey(state);
      state = { ...state, ...patch };
      paintButton();
      if (menuOpen && previousMenuState !== menuStateKey(state)) paintMenu();
    },
    destroy: () => {
      destroyed = true;
      if (reinjectTimer) window.clearInterval(reinjectTimer);
      document.getElementById(BUTTON_ID)?.remove();
      removeMenu();
    },
  };
};

export type { ButtonState, ButtonCallbacks, CaptionSource, PlayerButtonHandle, Status };
export { createPlayerButton };

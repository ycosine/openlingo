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

interface ButtonState {
  enabled: boolean;
  status: Status;
  statusText: string;
  errorMessage?: string;
  /** YouTube CC is off; show the actionable "Turn on captions" callout. */
  needsCaptions: boolean;
}

interface ButtonCallbacks {
  onToggleEnabled: (enabled: boolean) => void;
  onOpenOptions: () => void;
  /** Programmatically click YouTube's CC button (or guide user there). */
  onEnableCaptions: () => void;
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
    #${BUTTON_ID}:hover .openlingo-yt-button-bubble {
      transform: scale(1.04);
    }
    .openlingo-yt-button-bubble {
      position: relative;
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: ${ACCENT};
      box-shadow: 0 4px 14px ${ACCENT}55, 0 0 0 1px rgba(255,255,255,0.12) inset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.12s ease;
    }
    .openlingo-yt-button-bubble svg {
      display: block;
      width: 28px;
      height: 28px;
    }
    .openlingo-yt-button-dot {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 10px;
      height: 10px;
      border-radius: 99px;
      background: #3FA678;
      border: 1.5px solid rgba(0,0,0,0.75);
      box-shadow: 0 0 6px rgba(63,166,120,0.6);
    }
    .openlingo-yt-button-dot[data-status="translating"] {
      background: #E2B23F;
      animation: openlingo-pulse 1.2s ease-in-out infinite;
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
      animation: openlingo-pulse 1.4s ease-in-out infinite;
    }
    @keyframes openlingo-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }

    #${MENU_ID} {
      position: absolute;
      right: 8px;
      bottom: 56px;
      width: 260px;
      background: rgba(20,26,34,0.96);
      backdrop-filter: blur(16px) saturate(140%);
      -webkit-backdrop-filter: blur(16px) saturate(140%);
      border: 0.5px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      box-shadow: 0 14px 40px rgba(0,0,0,0.45);
      padding: 6px;
      color: #fff;
      font-family: "Geist", -apple-system, system-ui, sans-serif;
      font-size: 12.5px;
      z-index: 70;
      animation: openlingo-popin 0.14s ease both;
    }
    @keyframes openlingo-popin {
      from { opacity: 0; transform: scale(0.96) translateY(4px); }
      to { opacity: 1; transform: none; }
    }
    .openlingo-yt-menu-header {
      padding: 8px 10px 6px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 10.5px;
      color: rgba(255,255,255,0.55);
      font-family: "Geist Mono", ui-monospace, monospace;
      letter-spacing: 0;
      text-transform: uppercase;
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
    .openlingo-yt-menu-item:hover {
      background: rgba(255,255,255,0.06);
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
      font-family: "Geist Mono", ui-monospace, monospace;
      letter-spacing: 0;
    }
    .openlingo-yt-menu-callout {
      margin: 4px 6px 6px;
      padding: 10px 11px 11px;
      background: linear-gradient(180deg, rgba(226,178,63,0.18), rgba(226,178,63,0.10));
      border: 0.5px solid rgba(226,178,63,0.45);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .openlingo-yt-menu-callout-title {
      font-size: 12px;
      font-weight: 500;
      color: #FFD984;
      line-height: 1.35;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .openlingo-yt-menu-callout-title svg {
      flex-shrink: 0;
      margin-top: 1px;
    }
    .openlingo-yt-menu-callout-body {
      font-size: 11px;
      line-height: 1.45;
      color: rgba(255,255,255,0.78);
    }
    .openlingo-yt-menu-callout-cta {
      align-self: stretch;
      border: 0;
      border-radius: 6px;
      background: #E2B23F;
      color: #2A1F00;
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      padding: 7px 10px;
      cursor: pointer;
      transition: filter 0.12s ease;
    }
    .openlingo-yt-menu-callout-cta:hover {
      filter: brightness(1.06);
    }
    .openlingo-yt-toggle {
      position: relative;
      width: 30px;
      height: 17px;
      border-radius: 99px;
      background: rgba(255,255,255,0.18);
      transition: background 0.15s;
      flex-shrink: 0;
    }
    .openlingo-yt-toggle[data-on="1"] {
      background: ${ACCENT};
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
    }
    .openlingo-yt-toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 13px;
      height: 13px;
      border-radius: 99px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(0,0,0,0.4);
      transition: left 0.15s cubic-bezier(.3,.7,.4,1);
    }
    .openlingo-yt-toggle[data-on="1"] .openlingo-yt-toggle-knob {
      left: 15px;
    }
  `;
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
};

const speechMarkSvg = (size: number): string => `
  <svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <path d="M3.5 4 H20.5 A1.5 1.5 0 0 1 22 5.5 V15.5 A1.5 1.5 0 0 1 20.5 17 H11.5 L7 21.2 V17 H3.5 A1.5 1.5 0 0 1 2 15.5 V5.5 A1.5 1.5 0 0 1 3.5 4 Z" fill="#fff"/>
    <path d="M6.4 13.5 L8.6 7.5 H10.4 L12.6 13.5 H11 L10.5 12 H8.5 L8 13.5 Z M8.85 10.75 H10.15 L9.5 8.85 Z" fill="${ACCENT}"/>
    <path d="M14.4 13.5 V7.5 H16 V8.6 H18.4 V9.7 H17.6 C17.4 10.6 17.05 11.4 16.55 12.05 C16.95 12.35 17.4 12.6 17.9 12.8 L17.45 13.85 C16.9 13.6 16.4 13.3 15.95 12.95 C15.55 13.3 15.1 13.6 14.6 13.85 L14.15 12.8 C14.6 12.6 15 12.4 15.4 12.1 C14.95 11.5 14.7 10.85 14.55 10.15 H15.65 C15.75 10.55 15.9 10.95 16.15 11.3 C16.45 10.85 16.65 10.3 16.75 9.7 H14.4 Z" fill="${ACCENT}"/>
  </svg>`;

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Waiting for captions',
  translating: 'Translating captions…',
  translated: 'Bilingual subtitles on',
  'no-cues': 'No captions available',
  error: 'Translation error',
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

  const buildButtonElement = (): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'ytp-button';
    btn.setAttribute('aria-label', 'OpenLingo bilingual subtitles');
    btn.title = 'OpenLingo';
    btn.innerHTML = `
      <span class="openlingo-yt-button-bubble">
        ${speechMarkSvg(22)}
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
    const statusKey = state.enabled ? state.status : 'idle';
    const showCallout =
      state.enabled && state.needsCaptions && state.status !== 'translating' && state.status !== 'translated';
    menu.innerHTML = `
      <div class="openlingo-yt-menu-header">
        ${speechMarkSvg(10)}
        <span>OpenLingo</span>
      </div>
      <div class="openlingo-yt-menu-status">${STATUS_LABEL[statusKey]}${
        state.statusText ? ` · ${escapeHtml(state.statusText)}` : ''
      }</div>
      ${
        state.status === 'error' && state.errorMessage
          ? `<div class="openlingo-yt-menu-error">${escapeHtml(state.errorMessage)}</div>`
          : ''
      }
      ${
        showCallout
          ? `<div class="openlingo-yt-menu-callout">
              <div class="openlingo-yt-menu-callout-title">
                ${captionAlertSvg(14)}
                <span>Turn on YouTube captions to start translating</span>
              </div>
              <div class="openlingo-yt-menu-callout-body">
                OpenLingo translates the captions YouTube provides, so the player's CC button needs to be on for this video.
              </div>
              <button type="button" class="openlingo-yt-menu-callout-cta" data-action="enable-captions">Turn on CC</button>
            </div>`
          : ''
      }
      <button class="openlingo-yt-menu-item" data-action="toggle">
        <span>Bilingual subtitles for this video</span>
        <span class="openlingo-yt-toggle" data-on="${state.enabled ? '1' : '0'}">
          <span class="openlingo-yt-toggle-knob"></span>
        </span>
      </button>
      <div class="openlingo-yt-menu-sep"></div>
      <button class="openlingo-yt-menu-item" data-action="options">
        <span>Open OpenLingo options</span>
        <span style="color:rgba(255,255,255,0.45); font-size:11px;">→</span>
      </button>
    `;
    anchor.appendChild(menu);

    menu.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const cta = target.closest<HTMLElement>('[data-action]');
      const action = cta?.getAttribute('data-action');
      if (action === 'enable-captions') {
        callbacks.onEnableCaptions();
        return;
      }
      const item = target.closest<HTMLElement>('.openlingo-yt-menu-item');
      if (!item) return;
      const itemAction = item.getAttribute('data-action');
      if (itemAction === 'toggle') {
        callbacks.onToggleEnabled(!state.enabled);
        menuOpen = false;
        paintMenu();
      } else if (itemAction === 'options') {
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
      state = { ...state, ...patch };
      paintButton();
      if (menuOpen) paintMenu();
    },
    destroy: () => {
      destroyed = true;
      if (reinjectTimer) window.clearInterval(reinjectTimer);
      document.getElementById(BUTTON_ID)?.remove();
      removeMenu();
    },
  };
};

export type { ButtonState, ButtonCallbacks, PlayerButtonHandle, Status };
export { createPlayerButton };

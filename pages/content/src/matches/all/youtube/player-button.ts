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
}

interface ButtonCallbacks {
  onToggleEnabled: (enabled: boolean) => void;
  onOpenOptions: () => void;
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
      width: 40px;
      min-width: 40px;
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
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: ${ACCENT};
      box-shadow: 0 4px 12px ${ACCENT}44, 0 0 0 1px rgba(255,255,255,0.1) inset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.12s ease;
    }
    .openlingo-yt-button-bubble svg {
      display: block;
      width: 18px;
      height: 18px;
    }
    .openlingo-yt-button-dot {
      position: absolute;
      top: -1px;
      right: -1px;
      width: 8px;
      height: 8px;
      border-radius: 99px;
      background: #3FA678;
      border: 1px solid rgba(0,0,0,0.65);
      box-shadow: 0 0 6px rgba(63,166,120,0.55);
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
    <rect x="2" y="3" width="13" height="10" rx="2.8" fill="#fff" fill-opacity="0.32" />
    <rect x="7.5" y="9" width="14.5" height="11" rx="2.8" fill="#fff" />
    <path d="M10.6 19 L9 22.7 L13.8 19.3 Z" fill="#fff" />
  </svg>`;

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Waiting for captions',
  translating: 'Translating captions…',
  translated: 'Bilingual subtitles on',
  'no-cues': 'No captions available',
  error: 'Translation error',
};

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
        ${speechMarkSvg(18)}
        <span class="openlingo-yt-button-dot" data-status="${state.status}"></span>
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
    if (dot) dot.setAttribute('data-status', state.enabled ? state.status : 'idle');
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
      const item = target.closest<HTMLElement>('.openlingo-yt-menu-item');
      if (!item) return;
      const action = item.getAttribute('data-action');
      if (action === 'toggle') {
        callbacks.onToggleEnabled(!state.enabled);
        menuOpen = false;
        paintMenu();
      } else if (action === 'options') {
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

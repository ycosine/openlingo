type State = 'idle' | 'translating' | 'translated';

interface PendingUnit {
  id: string;
  el: HTMLElement;
  placeholder: HTMLElement | null;
  sent: boolean;
  done: boolean;
}

interface TranslateResultMessage {
  type: 'TR_TRANSLATE_RESULT';
  sessionId: string;
  results: Array<{ id: string; html: string }>;
  done: boolean;
}

interface TranslateErrorMessage {
  type: 'TR_TRANSLATE_ERROR';
  sessionId: string;
  code: string;
  message: string;
}

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'CANVAS',
  'PRE',
  'CODE',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'IFRAME',
  'IMG',
  'VIDEO',
  'AUDIO',
  'OBJECT',
  'EMBED',
  'MAP',
  'AREA',
  'METER',
  'PROGRESS',
  'TEMPLATE',
]);

const BLOCK_DEFAULT_TAGS = new Set([
  'DIV',
  'P',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'MAIN',
  'NAV',
  'ASIDE',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'CAPTION',
  'COLGROUP',
  'COL',
  'FORM',
  'FIELDSET',
  'LEGEND',
  'BLOCKQUOTE',
  'ADDRESS',
  'FIGURE',
  'FIGCAPTION',
  'DETAILS',
  'SUMMARY',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'DL',
  'DT',
  'DD',
  'HTML',
  'BODY',
  'HEAD',
]);

const APPEND_INSIDE_TAGS = new Set(['LI', 'TD', 'TH', 'DT', 'DD']);

const SOURCE_ATTR = 'data-immersive-source';
const SOURCE_ID_ATTR = 'data-immersive-source-id';
const TARGET_ATTR = 'data-immersive-translated';
const TARGET_CLASS = 'immersive-translate-target';
const LOADING_CLASS = `${TARGET_CLASS}--loading`;
const BLOCK_CLASS = `${TARGET_CLASS}--block`;
const INLINE_CLASS = `${TARGET_CLASS}--inline`;
const STYLE_ELEMENT_ID = 'immersive-translate-style';

const VIEWPORT_ROOT_MARGIN = '300px 0px';
const ENQUEUE_DEBOUNCE_MS = 80;

const state = {
  status: 'idle' as State,
  sessionId: '' as string,
  units: new Map<string, PendingUnit>(),
  errorMessage: '' as string,
  mutationObserver: null as MutationObserver | null,
  mutationTimer: 0 as number,
  intersectionObserver: null as IntersectionObserver | null,
  pendingQueue: new Set<string>(),
  flushTimer: 0 as number,
  nextUnitIndex: 0,
};

const ensureStyle = (): void => {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
.${TARGET_CLASS} {
  font-style: italic;
  font-family: Georgia, "Times New Roman", serif;
  color: #15201F;
  opacity: .9;
}
.${BLOCK_CLASS} {
  display: block;
  margin-top: .15em;
}
.${INLINE_CLASS} {
  margin-left: .35em;
}
.${LOADING_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  opacity: .6;
}
.${LOADING_CLASS}.${BLOCK_CLASS} {
  display: flex;
}
.${LOADING_CLASS} > i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #0F4F4A;
  animation: ol-dot 1.1s infinite ease-in-out;
  display: inline-block;
}
.${LOADING_CLASS} > i:nth-child(2) { animation-delay: .15s; }
.${LOADING_CLASS} > i:nth-child(3) { animation-delay: .3s; }
@keyframes ol-dot {
  0%, 80%, 100% { transform: translateY(0); opacity: .35; }
  40% { transform: translateY(-2px); opacity: 1; }
}
`;
  document.head.appendChild(style);
};

const isHiddenStyle = (el: Element): boolean => {
  const cs = window.getComputedStyle(el as HTMLElement);
  if (cs.display === 'none' || cs.visibility === 'hidden') return true;
  if ((el as HTMLElement).getAttribute('aria-hidden') === 'true') return true;
  return false;
};

const isMeaningfulText = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return false;
  return true;
};

const containsBlockDescendant = (el: Element): boolean => {
  for (const child of Array.from(el.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (BLOCK_DEFAULT_TAGS.has(child.tagName)) return true;
    if (containsBlockDescendant(child)) return true;
  }
  return false;
};

const isLeafTextContainer = (el: HTMLElement): boolean => {
  if (SKIP_TAGS.has(el.tagName)) return false;
  if (el.hasAttribute(SOURCE_ATTR) || el.hasAttribute(TARGET_ATTR)) return false;
  if (el.classList?.contains(TARGET_CLASS)) return false;
  if ((el as HTMLElement).getAttribute('contenteditable') === 'true') return false;
  if (isHiddenStyle(el)) return false;
  const text = el.textContent?.trim() ?? '';
  if (!isMeaningfulText(text)) return false;
  if (containsBlockDescendant(el)) return false;
  return true;
};

const hasRecordedAncestor = (el: Element): boolean => {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (cur.hasAttribute(SOURCE_ATTR)) return true;
    cur = cur.parentElement;
  }
  return false;
};

const collectCandidates = (root: ParentNode = document.body): PendingUnit[] => {
  const units: PendingUnit[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (el.hasAttribute(SOURCE_ATTR) || el.hasAttribute(TARGET_ATTR)) return NodeFilter.FILTER_REJECT;
      if (el.classList?.contains(TARGET_CLASS)) return NodeFilter.FILTER_REJECT;
      if (isHiddenStyle(el)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const el = node as HTMLElement;
    if (!hasRecordedAncestor(el) && isLeafTextContainer(el)) {
      const id = `u${state.nextUnitIndex++}`;
      el.setAttribute(SOURCE_ATTR, '1');
      el.setAttribute(SOURCE_ID_ATTR, id);
      units.push({ id, el, placeholder: null, sent: false, done: false });
    }
    node = walker.nextNode();
  }
  return units;
};

const isBlockLikeDisplay = (el: HTMLElement): boolean => {
  const cs = window.getComputedStyle(el);
  const d = cs.display;
  return d === 'block' || d === 'list-item' || d === 'flex' || d === 'grid' || d.startsWith('table');
};

const placeTargetNode = (sourceEl: HTMLElement, target: HTMLElement): void => {
  // Block sources (paragraphs, headings, divs styled as block) get the
  // translation as a sibling on the next line.
  if (isBlockLikeDisplay(sourceEl) && !APPEND_INSIDE_TAGS.has(sourceEl.tagName)) {
    target.classList.add(BLOCK_CLASS);
    sourceEl.insertAdjacentElement('afterend', target);
    return;
  }
  // List items / table cells need block-flow translation but as an inner child
  // (their parent <ul>/<tr> doesn't accept arbitrary block siblings).
  if (APPEND_INSIDE_TAGS.has(sourceEl.tagName)) {
    target.classList.add(BLOCK_CLASS);
    sourceEl.appendChild(target);
    return;
  }
  // Inline sources (links, buttons, span labels, badges, form labels) —
  // nest the translation INSIDE the source. This keeps the translation:
  //   - styled the same as the original (font, color, weight)
  //   - inside the click hit area (button labels, anchor links, <label>s)
  //   - scoped to the same flex/grid item (no layout perturbation)
  target.classList.add(INLINE_CLASS);
  sourceEl.appendChild(target);
};

const createPlaceholder = (sourceEl: HTMLElement): HTMLElement => {
  const node = document.createElement('span');
  node.setAttribute(TARGET_ATTR, '1');
  node.classList.add(TARGET_CLASS, LOADING_CLASS);
  node.innerHTML = '<i></i><i></i><i></i>';
  placeTargetNode(sourceEl, node);
  return node;
};

const swapPlaceholderToTranslation = (unit: PendingUnit, translatedHtml: string): void => {
  if (!unit.placeholder) return;
  unit.placeholder.classList.remove(LOADING_CLASS);
  unit.placeholder.innerHTML = translatedHtml;
  unit.done = true;
};

const removePlaceholder = (unit: PendingUnit): void => {
  if (unit.placeholder) {
    unit.placeholder.remove();
    unit.placeholder = null;
  }
};

const restoreAll = (): void => {
  document.querySelectorAll(`[${TARGET_ATTR}="1"]`).forEach(n => n.remove());
  document.querySelectorAll(`[${SOURCE_ATTR}="1"]`).forEach(n => {
    n.removeAttribute(SOURCE_ATTR);
    n.removeAttribute(SOURCE_ID_ATTR);
  });
  state.units.clear();
  state.pendingQueue.clear();
  if (state.flushTimer) {
    window.clearTimeout(state.flushTimer);
    state.flushTimer = 0;
  }
};

const newSessionId = (): string => `s${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const enqueueForTranslation = (unit: PendingUnit): void => {
  if (unit.sent || unit.done) return;
  if (!unit.el.isConnected) return;
  unit.sent = true;
  unit.placeholder = createPlaceholder(unit.el);
  state.pendingQueue.add(unit.id);
  if (state.flushTimer) window.clearTimeout(state.flushTimer);
  state.flushTimer = window.setTimeout(flushPendingQueue, ENQUEUE_DEBOUNCE_MS);
};

const flushPendingQueue = (): void => {
  state.flushTimer = 0;
  if (state.pendingQueue.size === 0) return;
  if (!state.sessionId) return;

  const batch: Array<{ id: string; html: string }> = [];
  for (const id of state.pendingQueue) {
    const unit = state.units.get(id);
    if (!unit) continue;
    batch.push({ id, html: unit.el.innerHTML });
  }
  state.pendingQueue.clear();

  if (batch.length === 0) return;

  chrome.runtime
    .sendMessage({
      type: 'TR_TRANSLATE_BATCH',
      sessionId: state.sessionId,
      units: batch,
    })
    .catch(() => {
      // background unloading — ignore
    });
};

const handleResult = (msg: TranslateResultMessage): void => {
  if (msg.sessionId !== state.sessionId) return;
  for (const r of msg.results) {
    const unit = state.units.get(r.id);
    if (!unit) continue;
    swapPlaceholderToTranslation(unit, r.html);
  }
  // We don't switch to 'translated' on msg.done anymore because translation is
  // viewport-progressive — there's no final "done" until user stops scrolling.
  // Status flips to 'translated' as soon as the first batch lands.
  if (state.status === 'translating') {
    state.status = 'translated';
    startMutationObserver();
  }
};

const handleError = (msg: TranslateErrorMessage): void => {
  if (msg.sessionId !== state.sessionId) return;
  // Clear any spinning placeholders so the page doesn't look stuck.
  for (const unit of state.units.values()) {
    if (unit.placeholder && !unit.done) {
      removePlaceholder(unit);
      unit.sent = false;
    }
  }
  state.errorMessage = `${msg.code}: ${msg.message}`;
  // Keep status as-is so the user can still Restore; idle if nothing landed yet.
  const anyDone = [...state.units.values()].some(u => u.done);
  if (!anyDone) state.status = 'idle';
};

const observeUnit = (unit: PendingUnit): void => {
  if (!state.intersectionObserver) return;
  state.intersectionObserver.observe(unit.el);
};

const startIntersectionObserver = (): void => {
  if (state.intersectionObserver) return;
  state.intersectionObserver = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        const id = el.getAttribute(SOURCE_ID_ATTR);
        if (!id) continue;
        const unit = state.units.get(id);
        if (!unit) continue;
        enqueueForTranslation(unit);
        state.intersectionObserver?.unobserve(el);
      }
    },
    { rootMargin: VIEWPORT_ROOT_MARGIN },
  );
};

const stopIntersectionObserver = (): void => {
  if (state.intersectionObserver) {
    state.intersectionObserver.disconnect();
    state.intersectionObserver = null;
  }
};

const startTranslate = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
  if (state.status !== 'idle') return { ok: true };
  ensureStyle();
  const units = collectCandidates();
  if (units.length === 0) {
    return { ok: false, message: 'No translatable content found on this page' };
  }
  for (const u of units) state.units.set(u.id, u);
  state.sessionId = newSessionId();
  state.status = 'translating';
  state.errorMessage = '';

  startIntersectionObserver();
  for (const u of units) observeUnit(u);
  // IntersectionObserver fires its initial callback asynchronously for currently
  // intersecting elements, so the in-viewport units enqueue themselves on the
  // next microtask. No need to scan manually.

  return { ok: true };
};

const stopTranslate = (): void => {
  if (state.status === 'idle' && state.units.size === 0) return;
  if (state.sessionId) {
    chrome.runtime.sendMessage({ type: 'TR_TRANSLATE_CANCEL', sessionId: state.sessionId }).catch(() => {});
  }
  stopMutationObserver();
  stopIntersectionObserver();
  restoreAll();
  state.nextUnitIndex = 0;
  state.status = 'idle';
  state.sessionId = '';
  state.errorMessage = '';
};

const startMutationObserver = (): void => {
  if (state.mutationObserver) return;
  const obs = new MutationObserver(() => {
    if (state.status !== 'translated' && state.status !== 'translating') return;
    if (state.mutationTimer) window.clearTimeout(state.mutationTimer);
    state.mutationTimer = window.setTimeout(() => {
      const fresh = collectCandidates();
      for (const u of fresh) {
        state.units.set(u.id, u);
        observeUnit(u);
      }
    }, 600);
  });
  obs.observe(document.body, { childList: true, subtree: true });
  state.mutationObserver = obs;
};

const stopMutationObserver = (): void => {
  if (state.mutationObserver) {
    state.mutationObserver.disconnect();
    state.mutationObserver = null;
  }
  if (state.mutationTimer) {
    window.clearTimeout(state.mutationTimer);
    state.mutationTimer = 0;
  }
};

export const initImmersiveTranslate = (): void => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

    if (msg.type === 'TR_PAGE_TRANSLATE') {
      void startTranslate().then(r => sendResponse(r));
      return true;
    }
    if (msg.type === 'TR_PAGE_RESTORE') {
      stopTranslate();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'TR_PAGE_STATE') {
      sendResponse({ status: state.status, error: state.errorMessage });
      return;
    }
    if (msg.type === 'TR_TRANSLATE_RESULT') {
      handleResult(msg as TranslateResultMessage);
      return;
    }
    if (msg.type === 'TR_TRANSLATE_ERROR') {
      handleError(msg as TranslateErrorMessage);
      return;
    }
    return;
  });
};

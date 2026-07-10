import { MUTATION_DEBOUNCE_MS, SOURCE_ATTR, SOURCE_ID_ATTR, TARGET_ATTR, TARGET_CLASS } from './constants.js';
import { clearAllMarks, ensureStyle, removeAttachedTargets } from './renderer.js';
import { scanRoot, scanRoots, textExcludingTargets } from './scanner.js';
import { TranslateScheduler } from './scheduler.js';
import { TranslateTransport } from './transport.js';
import type { PageStatus, TransportInbound } from './types.js';

const session = {
  status: 'idle' as PageStatus,
  sessionId: '' as string,
  errorMessage: '' as string,
  targetLang: '' as string,
  nextUnitIndex: 0,
  mutationObserver: null as MutationObserver | null,
  mutationTimer: 0 as number,
  pendingScanRoots: new Set<Element>(),
  // Marked sources whose content the page rewrote (re-render / recycled
  // virtual-list row) — their translation is stale and must be redone.
  pendingDirtySources: new Set<HTMLElement>(),
};

const transport = new TranslateTransport();
const scheduler = new TranslateScheduler();

const newSessionId = (): string => `s${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isOwnMutationNode = (node: Node): boolean => {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  if (el.hasAttribute(TARGET_ATTR) || el.classList?.contains(TARGET_CLASS)) return true;
  if (el.closest?.(`[${TARGET_ATTR}="1"]`)) return true;
  return false;
};

const ingestUnits = (units: ReturnType<typeof scanRoot>['units']): void => {
  if (units.length === 0) return;
  scheduler.addUnits(units);
};

const runScan = (root: ParentNode = document.body): number => {
  const { units, nextUnitIndex } = scanRoot(root, {
    targetLang: session.targetLang || undefined,
    nextUnitIndex: session.nextUnitIndex,
  });
  session.nextUnitIndex = nextUnitIndex;
  ingestUnits(units);
  return units.length;
};

/**
 * Invalidate dirty sources: if the text actually changed, drop the unit and its
 * stale translation, unmark the element, and queue it for a fresh scan.
 * Unchanged text (cosmetic DOM shuffle) keeps the existing translation.
 */
const processDirtySources = (): void => {
  const dirty = [...session.pendingDirtySources];
  session.pendingDirtySources.clear();
  for (const src of dirty) {
    const id = src.getAttribute(SOURCE_ID_ATTR);
    if (!src.isConnected) {
      if (id) scheduler.removeUnit(id);
      continue;
    }
    const unit = id ? scheduler.unitMap.get(id) : undefined;
    if (unit && textExcludingTargets(src).trim() === unit.sourceText) continue;
    if (id) scheduler.removeUnit(id);
    removeAttachedTargets(src);
    src.removeAttribute(SOURCE_ATTR);
    src.removeAttribute(SOURCE_ID_ATTR);
    session.pendingScanRoots.add(src);
  }
};

const flushPendingScans = (): void => {
  session.mutationTimer = 0;
  if (session.status !== 'translated' && session.status !== 'translating') {
    session.pendingDirtySources.clear();
    session.pendingScanRoots.clear();
    return;
  }

  processDirtySources();

  const roots = [...session.pendingScanRoots];
  session.pendingScanRoots.clear();
  if (roots.length === 0) return;

  // Drop disconnected roots; prefer deepest unique subtrees.
  const live = roots.filter(r => r.isConnected);
  if (live.length === 0) return;

  const { units, nextUnitIndex } = scanRoots(live, {
    targetLang: session.targetLang || undefined,
    nextUnitIndex: session.nextUnitIndex,
  });
  session.nextUnitIndex = nextUnitIndex;
  ingestUnits(units);
};

const scheduleMutationFlush = (): void => {
  if (session.mutationTimer) return;
  session.mutationTimer = window.setTimeout(flushPendingScans, MUTATION_DEBOUNCE_MS);
};

const queueScanTarget = (el: Element): void => {
  if (isOwnMutationNode(el)) return;
  if (el.hasAttribute(SOURCE_ATTR)) return;
  session.pendingScanRoots.add(el);
  scheduleMutationFlush();
};

const queueDirtySource = (src: HTMLElement): void => {
  session.pendingDirtySources.add(src);
  scheduleMutationFlush();
};

/** Marked source containing this node, or null when unrelated / inside our own target. */
const findContainingSource = (node: Node): HTMLElement | null => {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;
  return el.closest(`[${SOURCE_ATTR}="1"]`) as HTMLElement | null;
};

const startMutationObserver = (): void => {
  if (session.mutationObserver) return;
  const obs = new MutationObserver(records => {
    if (session.status !== 'translated' && session.status !== 'translating') return;

    for (const rec of records) {
      // Mutations inside one of our translation nodes (placeholder insert /
      // swap) are our own writes — never trigger scans from them.
      const recEl = rec.target.nodeType === Node.ELEMENT_NODE ? (rec.target as Element) : rec.target.parentElement;
      if (recEl?.closest(`[${TARGET_ATTR}="1"]`)) continue;

      if (rec.type === 'characterData') {
        const src = findContainingSource(rec.target);
        if (src) queueDirtySource(src);
        else if (rec.target.parentElement) queueScanTarget(rec.target.parentElement);
        continue;
      }

      if (rec.type === 'childList') {
        const foreignAdded = Array.from(rec.addedNodes).filter(n => !isOwnMutationNode(n));
        const foreignRemoved = Array.from(rec.removedNodes).filter(n => !isOwnMutationNode(n));
        // Only our own placeholder/translation churn — ignore.
        if (foreignAdded.length === 0 && foreignRemoved.length === 0) continue;

        const src = findContainingSource(rec.target);
        if (src) {
          // Page rewrote content inside a translated unit (recycled row).
          queueDirtySource(src);
          continue;
        }
        for (const node of foreignAdded) {
          if (node.nodeType === Node.ELEMENT_NODE) queueScanTarget(node as Element);
          else if (node.parentElement) queueScanTarget(node.parentElement);
        }
        // Pure removal can leave the parent as a fresh paragraph candidate.
        if (foreignAdded.length === 0 && recEl) queueScanTarget(recEl);
        continue;
      }

      // attributes: flips (class/style/hidden) may reveal previously skipped content.
      const t = rec.target as Element;
      if (isOwnMutationNode(t)) continue;
      queueScanTarget(t);
    }
  });
  obs.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
  });
  session.mutationObserver = obs;
};

const stopMutationObserver = (): void => {
  if (session.mutationObserver) {
    session.mutationObserver.disconnect();
    session.mutationObserver = null;
  }
  if (session.mutationTimer) {
    window.clearTimeout(session.mutationTimer);
    session.mutationTimer = 0;
  }
  session.pendingScanRoots.clear();
  session.pendingDirtySources.clear();
};

const onTransportMessage = (msg: TransportInbound): void => {
  if (msg.type === 'TR_TRANSLATE_RESULT') {
    scheduler.handleResult(msg);
    if (session.status === 'translating') {
      session.status = 'translated';
    }
    return;
  }
  if (msg.type === 'TR_TRANSLATE_ERROR') {
    scheduler.handleError(msg);
    return;
  }
  if (msg.type === 'TR_TRANSLATE_BACKOFF') {
    if (msg.sessionId === session.sessionId) {
      scheduler.handleBackoff(msg.extendMs);
    }
  }
};

const startTranslate = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
  if (session.status !== 'idle') return { ok: true };

  ensureStyle();

  // Best-effort language filter; storage key matches @extension/storage.
  try {
    const stored = await chrome.storage.local.get('translation-settings');
    const raw = stored?.['translation-settings'] as { targetLang?: string } | undefined;
    session.targetLang = raw?.targetLang ?? '';
  } catch {
    session.targetLang = '';
  }

  session.sessionId = newSessionId();
  session.status = 'translating';
  session.errorMessage = '';

  transport.connect({
    onMessage: onTransportMessage,
    onDisconnect: () => scheduler.handleDisconnect(),
  });

  scheduler.start(session.sessionId, transport, {
    onFirstResult: () => {
      // Mutation observer starts with translate (P4); keep status flip here.
      if (session.status === 'translating') session.status = 'translated';
    },
    onFatalError: (code, message) => {
      session.errorMessage = `${code}: ${message}`;
      if (scheduler.doneCount === 0) session.status = 'idle';
    },
  });

  // P4: observe dynamic content immediately, not after first batch lands.
  startMutationObserver();

  const found = runScan(document.body);
  if (found === 0) {
    stopTranslate();
    return { ok: false, message: 'No translatable content found on this page' };
  }

  return { ok: true };
};

const stopTranslate = (): void => {
  if (session.status === 'idle' && scheduler.unitMap.size === 0) return;
  if (session.sessionId) {
    transport.sendCancel(session.sessionId);
  }
  stopMutationObserver();
  transport.disconnect();
  scheduler.clear();
  clearAllMarks();
  session.nextUnitIndex = 0;
  session.status = 'idle';
  session.sessionId = '';
  session.errorMessage = '';
  session.targetLang = '';
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
      sendResponse({
        status: session.status,
        error: session.errorMessage,
        pendingCount: scheduler.pendingCount,
        failedCount: scheduler.failedCount,
      });
      return;
    }
    // Legacy: results may still arrive via sendMessage during transition;
    // Port is the primary channel after P3.
    if (
      msg.type === 'TR_TRANSLATE_RESULT' ||
      msg.type === 'TR_TRANSLATE_ERROR' ||
      msg.type === 'TR_TRANSLATE_BACKOFF'
    ) {
      onTransportMessage(msg as TransportInbound);
      return;
    }
    return;
  });
};

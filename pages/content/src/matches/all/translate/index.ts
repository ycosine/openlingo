import { MUTATION_DEBOUNCE_MS, SOURCE_ATTR, TARGET_ATTR, TARGET_CLASS } from './constants.js';
import { clearAllMarks, ensureStyle } from './renderer.js';
import { scanRoot, scanRoots } from './scanner.js';
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

const flushPendingScans = (): void => {
  session.mutationTimer = 0;
  if (session.status !== 'translated' && session.status !== 'translating') return;
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

const queueScanTarget = (el: Element): void => {
  if (isOwnMutationNode(el)) return;
  if (el.hasAttribute(SOURCE_ATTR)) return;
  session.pendingScanRoots.add(el);
  if (session.mutationTimer) return;
  session.mutationTimer = window.setTimeout(flushPendingScans, MUTATION_DEBOUNCE_MS);
};

const startMutationObserver = (): void => {
  if (session.mutationObserver) return;
  const obs = new MutationObserver(records => {
    if (session.status !== 'translated' && session.status !== 'translating') return;

    for (const rec of records) {
      if (rec.type === 'childList') {
        rec.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (isOwnMutationNode(node)) return;
          queueScanTarget(node as Element);
        });
      } else if (rec.type === 'attributes') {
        const t = rec.target as Element;
        if (isOwnMutationNode(t)) return;
        // Attribute flips (class/style/hidden) may reveal previously skipped content.
        queueScanTarget(t);
      }
    }
  });
  obs.observe(document.body, {
    childList: true,
    subtree: true,
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

import { TranslateSession } from './translate-session';
import { providerCredentialsStorage, translationSettingsStorage } from '@extension/storage';
import { getProvider } from '@extension/translation';
import type {
  TranslateBackoffMessage,
  TranslateBatchRequest,
  TranslateCancelRequest,
  TranslateErrorMessage,
  TranslatePartialMessage,
  TranslateResultMessage,
} from './translate-session';
import type { ProviderCredential, ProviderId } from '@extension/translation';

interface TranslateValidateRequest {
  type: 'TR_VALIDATE_KEY';
  providerId?: ProviderId;
  credential?: ProviderCredential;
  /** Legacy: callers that still send only apiKey for the current settings provider. */
  apiKey?: string;
}

type Outbound = TranslateResultMessage | TranslatePartialMessage | TranslateErrorMessage | TranslateBackoffMessage;

/** Sessions keyed by port; one session object per connected content script. */
const portSessions = new Map<chrome.runtime.Port, TranslateSession>();

/** Fallback sessions for legacy sendMessage batches (sessionId → session). */
const legacySessions = new Map<string, { session: TranslateSession; tabId: number }>();

const sendToTab = (tabId: number, msg: Outbound): void => {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab may have navigated away — ignore.
  });
};

const handleValidate = async (req: TranslateValidateRequest): Promise<{ ok: boolean; message?: string }> => {
  const settings = await translationSettingsStorage.get();
  const providerId = req.providerId ?? settings.provider;
  const stored = await providerCredentialsStorage.getFor(providerId);
  const credential: ProviderCredential = req.credential ?? (req.apiKey ? { ...stored, apiKey: req.apiKey } : stored);
  const provider = getProvider(providerId, credential);
  return provider.validate(credential);
};

const attachPortSession = (port: chrome.runtime.Port): void => {
  let session: TranslateSession | null = null;

  const sink = (msg: Outbound): void => {
    try {
      port.postMessage(msg);
    } catch {
      // Port gone
    }
  };

  port.onMessage.addListener((msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const m = msg as { type: string; sessionId?: string };

    if (m.type === 'TR_TRANSLATE_BATCH') {
      const req = msg as TranslateBatchRequest;
      if (!session || session.sessionId !== req.sessionId) {
        session?.cancel();
        session = new TranslateSession(req.sessionId, sink);
        portSessions.set(port, session);
      }
      session.enqueue(req.units, req.maxConcurrency, req.wantPartials);
      return;
    }

    if (m.type === 'TR_TRANSLATE_CANCEL') {
      const req = msg as TranslateCancelRequest;
      if (session && session.sessionId === req.sessionId) {
        session.cancel();
        session = null;
        portSessions.delete(port);
      }
      return;
    }
  });

  port.onDisconnect.addListener(() => {
    const s = portSessions.get(port);
    if (s) {
      s.cancel();
      portSessions.delete(port);
    }
    session = null;
  });
};

export const registerTranslatorMessageHandlers = (): void => {
  // Port channel (primary after P3)
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'translate') return;
    attachPortSession(port);
  });

  // Legacy sendMessage + validate key
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const tabId = sender.tab?.id;

    if (msg.type === 'TR_TRANSLATE_BATCH' && tabId !== undefined) {
      const req = msg as TranslateBatchRequest;
      let entry = legacySessions.get(req.sessionId);
      if (!entry) {
        const session = new TranslateSession(req.sessionId, m => sendToTab(tabId, m));
        entry = { session, tabId };
        legacySessions.set(req.sessionId, entry);
      }
      entry.session.enqueue(req.units, req.maxConcurrency, req.wantPartials);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'TR_TRANSLATE_CANCEL') {
      const req = msg as TranslateCancelRequest;
      const entry = legacySessions.get(req.sessionId);
      if (entry) {
        entry.session.cancel();
        legacySessions.delete(req.sessionId);
      }
      // Also cancel matching port sessions
      for (const [port, session] of portSessions) {
        if (session.sessionId === req.sessionId) {
          session.cancel();
          portSessions.delete(port);
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'TR_VALIDATE_KEY') {
      handleValidate(msg as TranslateValidateRequest).then(sendResponse);
      return true;
    }
    return;
  });
};

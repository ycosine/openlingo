import type { TransportInbound } from './types.js';

export type TransportHandlers = {
  onMessage: (msg: TransportInbound) => void;
  /** Fired when the port drops (SW killed / crash). Caller requeues sent units. */
  onDisconnect: () => void;
};

/**
 * Long-lived Port to the background translator session.
 * Replaces fire-and-forget chrome.runtime.sendMessage for batch traffic.
 */
export class TranslateTransport {
  private port: chrome.runtime.Port | null = null;
  private handlers: TransportHandlers | null = null;
  private intentionalClose = false;
  private reconnectTimer = 0;

  connect(handlers: TransportHandlers): void {
    this.handlers = handlers;
    this.intentionalClose = false;
    this.openPort();
  }

  private openPort(): void {
    if (this.port) {
      try {
        this.port.disconnect();
      } catch {
        // already dead
      }
      this.port = null;
    }
    try {
      const port = chrome.runtime.connect({ name: 'translate' });
      this.port = port;
      port.onMessage.addListener((msg: unknown) => {
        if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
        this.handlers?.onMessage(msg as TransportInbound);
      });
      port.onDisconnect.addListener(() => {
        this.port = null;
        if (this.intentionalClose) return;
        this.handlers?.onDisconnect();
        // Soft reconnect so a subsequent flush can send again.
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = 0;
          if (!this.intentionalClose && this.handlers) this.openPort();
        }, 200);
      });
    } catch {
      this.port = null;
    }
  }

  sendBatch(sessionId: string, units: Array<{ id: string; html: string }>): void {
    if (!this.port) this.openPort();
    if (!this.port) return;
    try {
      this.port.postMessage({
        type: 'TR_TRANSLATE_BATCH',
        sessionId,
        units,
      });
    } catch {
      this.port = null;
      this.handlers?.onDisconnect();
    }
  }

  sendCancel(sessionId: string): void {
    if (!this.port) {
      // Best-effort via one-shot message if port is already gone.
      chrome.runtime.sendMessage({ type: 'TR_TRANSLATE_CANCEL', sessionId }).catch(() => {});
      return;
    }
    try {
      this.port.postMessage({ type: 'TR_TRANSLATE_CANCEL', sessionId });
    } catch {
      chrome.runtime.sendMessage({ type: 'TR_TRANSLATE_CANCEL', sessionId }).catch(() => {});
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }
    if (this.port) {
      try {
        this.port.disconnect();
      } catch {
        // ignore
      }
      this.port = null;
    }
    this.handlers = null;
  }
}

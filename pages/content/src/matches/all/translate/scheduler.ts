import {
  FLUSH_BATCH_SIZE,
  FLUSH_INTERVAL_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  SOURCE_ID_ATTR,
  UNIT_DEADLINE_MS,
  VIEWPORT_ROOT_MARGIN,
} from './constants.js';
import { createPlaceholder, removePlaceholder, swapPlaceholderToTranslation } from './renderer.js';
import type { TranslateTransport } from './transport.js';
import type { PendingUnit, TranslateErrorMessage, TranslateResultMessage } from './types.js';

type SchedulerCallbacks = {
  onFirstResult: () => void;
  onFatalError: (code: string, message: string) => void;
};

const FATAL_CODES = new Set(['NO_API_KEY', 'AUTH']);

class TranslateScheduler {
  private units = new Map<string, PendingUnit>();
  private pendingQueue = new Set<string>();
  private sessionId = '';
  private transport: TranslateTransport | null = null;
  private callbacks: SchedulerCallbacks | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private flushTimer = 0;
  private heartbeatTimer = 0;
  private retryTimers = new Map<string, number>();
  private firstResultSeen = false;

  get unitMap(): Map<string, PendingUnit> {
    return this.units;
  }

  get pendingCount(): number {
    let n = 0;
    for (const u of this.units.values()) {
      if (
        u.status === 'discovered' ||
        u.status === 'queued' ||
        u.status === 'sent' ||
        u.status === 'failed_retryable'
      ) {
        n++;
      }
    }
    return n;
  }

  get failedCount(): number {
    let n = 0;
    for (const u of this.units.values()) {
      if (u.status === 'failed_final') n++;
    }
    return n;
  }

  get doneCount(): number {
    let n = 0;
    for (const u of this.units.values()) {
      if (u.status === 'done') n++;
    }
    return n;
  }

  start(sessionId: string, transport: TranslateTransport, callbacks: SchedulerCallbacks): void {
    this.sessionId = sessionId;
    this.transport = transport;
    this.callbacks = callbacks;
    this.firstResultSeen = false;
    this.startIntersectionObserver();
    this.startHeartbeat();
  }

  addUnits(units: PendingUnit[]): void {
    for (const u of units) {
      this.units.set(u.id, u);
      this.observeUnit(u);
    }
  }

  private startIntersectionObserver(): void {
    if (this.intersectionObserver) return;
    this.intersectionObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const id = el.getAttribute(SOURCE_ID_ATTR);
          if (!id) continue;
          const unit = this.units.get(id);
          if (!unit) continue;
          this.enqueue(unit);
          this.intersectionObserver?.unobserve(el);
        }
      },
      { rootMargin: VIEWPORT_ROOT_MARGIN },
    );
  }

  private observeUnit(unit: PendingUnit): void {
    if (!this.intersectionObserver) return;
    if (unit.status !== 'discovered') return;
    this.intersectionObserver.observe(unit.el);
  }

  /** Move unit into the send queue (viewport hit or retry). */
  enqueue(unit: PendingUnit): void {
    if (unit.status === 'done' || unit.status === 'failed_final' || unit.status === 'sent') return;
    if (!unit.el.isConnected) return;

    if (!unit.placeholder) {
      unit.placeholder = createPlaceholder(unit.el);
    }
    unit.status = 'queued';
    this.pendingQueue.add(unit.id);
    this.scheduleFlush();
  }

  /** Fixed-cadence flush: every 150ms or when 8 units accumulate. */
  private scheduleFlush(): void {
    if (this.pendingQueue.size >= FLUSH_BATCH_SIZE) {
      this.flush();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0;
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private flush(): void {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = 0;
    }
    if (this.pendingQueue.size === 0 || !this.sessionId || !this.transport) return;

    const batch: Array<{ id: string; html: string }> = [];
    const ids = [...this.pendingQueue];
    this.pendingQueue.clear();

    const now = Date.now();
    for (const id of ids) {
      const unit = this.units.get(id);
      if (!unit) continue;
      if (unit.status !== 'queued' && unit.status !== 'failed_retryable') continue;
      if (!unit.el.isConnected) {
        this.failFinal(unit);
        continue;
      }
      unit.status = 'sent';
      unit.deadline = now + UNIT_DEADLINE_MS;
      batch.push({ id: unit.id, html: unit.html });
    }

    if (batch.length === 0) return;
    this.transport.sendBatch(this.sessionId, batch);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = window.setInterval(() => this.checkDeadlines(), 2000);
  }

  private checkDeadlines(): void {
    const now = Date.now();
    for (const unit of this.units.values()) {
      if (unit.status !== 'sent') continue;
      if (unit.deadline > 0 && now > unit.deadline) {
        this.onUnitTimeout(unit);
      }
    }
  }

  private onUnitTimeout(unit: PendingUnit): void {
    if (unit.retries < MAX_RETRIES) {
      unit.retries += 1;
      unit.status = 'failed_retryable';
      const delay = RETRY_DELAYS_MS[Math.min(unit.retries - 1, RETRY_DELAYS_MS.length - 1)];
      this.scheduleRetry(unit, delay);
    } else {
      this.failFinal(unit);
    }
  }

  private scheduleRetry(unit: PendingUnit, delayMs: number): void {
    const existing = this.retryTimers.get(unit.id);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      this.retryTimers.delete(unit.id);
      // Known-in-viewport retries go straight back to queue (no IO dependency).
      this.enqueue(unit);
    }, delayMs);
    this.retryTimers.set(unit.id, t);
  }

  private failFinal(unit: PendingUnit): void {
    unit.status = 'failed_final';
    removePlaceholder(unit);
  }

  handleResult(msg: TranslateResultMessage): void {
    if (msg.sessionId !== this.sessionId) return;
    for (const r of msg.results) {
      const unit = this.units.get(r.id);
      if (!unit) continue;
      if (unit.status === 'done') continue;
      swapPlaceholderToTranslation(unit, r.html);
      unit.deadline = 0;
    }
    if (!this.firstResultSeen) {
      this.firstResultSeen = true;
      this.callbacks?.onFirstResult();
    }
  }

  handleError(msg: TranslateErrorMessage): void {
    if (msg.sessionId !== this.sessionId) return;

    if (FATAL_CODES.has(msg.code)) {
      for (const unit of this.units.values()) {
        if (unit.status !== 'done') {
          removePlaceholder(unit);
          if (unit.status === 'sent' || unit.status === 'queued') {
            unit.status = 'failed_final';
          }
        }
      }
      this.pendingQueue.clear();
      this.callbacks?.onFatalError(msg.code, msg.message);
      return;
    }

    // Retryable: RATE_LIMIT / HTTP_ERROR / UNKNOWN — only in-flight units.
    for (const unit of this.units.values()) {
      if (unit.status !== 'sent') continue;
      if (unit.retries < MAX_RETRIES) {
        unit.retries += 1;
        unit.status = 'failed_retryable';
        const delay = RETRY_DELAYS_MS[Math.min(unit.retries - 1, RETRY_DELAYS_MS.length - 1)];
        this.scheduleRetry(unit, delay);
      } else {
        this.failFinal(unit);
      }
    }
  }

  /** Port dropped: roll every `sent` unit back to queued and resend. */
  handleDisconnect(): void {
    for (const unit of this.units.values()) {
      if (unit.status === 'sent') {
        unit.status = 'queued';
        unit.deadline = 0;
        this.pendingQueue.add(unit.id);
      }
    }
    this.scheduleFlush();
  }

  /** Background rate-limit backoff: extend deadlines so content-side timeout doesn't thrash. */
  handleBackoff(extendMs: number): void {
    const now = Date.now();
    for (const unit of this.units.values()) {
      if (unit.status === 'sent') {
        unit.deadline = Math.max(unit.deadline, now) + extendMs;
      }
    }
  }

  clear(): void {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = 0;
    }
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = 0;
    }
    for (const t of this.retryTimers.values()) window.clearTimeout(t);
    this.retryTimers.clear();
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    this.units.clear();
    this.pendingQueue.clear();
    this.sessionId = '';
    this.transport = null;
    this.callbacks = null;
    this.firstResultSeen = false;
  }
}

export { TranslateScheduler };
export type { SchedulerCallbacks };

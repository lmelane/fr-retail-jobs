import { log } from '../observability/logger.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { assertCaptureHealthy, replayingResponses } from '../capture/context.js';

type Budget = { signal: AbortSignal; startedAt: number; timeoutMs: number; softTimeoutMs?: number };
const budgets = new AsyncLocalStorage<Budget>();
export const sourceSignal = () => budgets.getStore()?.signal;
/** A soft deadline stops live pagination. Archived requests and result equality
 * bound a replay; an expired wall clock must not erase its recorded pages. */
export function sourceDeadlineReached(): boolean {
  const budget = budgets.getStore();
  return !replayingResponses() && budget?.softTimeoutMs !== undefined && Date.now() >= budget.startedAt + budget.softTimeoutMs;
}
export function sourceExecutionBudget() {
  const budget = budgets.getStore();
  return budget ? { startedAt: new Date(budget.startedAt).toISOString(), timeoutMs: budget.timeoutMs,
    ...(budget.softTimeoutMs === undefined ? {} : { softTimeoutMs: budget.softTimeoutMs }) } : undefined;
}
export const assertSourceRunning = () => { log.assertHealthy(); assertCaptureHealthy(); sourceSignal()?.throwIfAborted(); };
export const sourceDelay = (ms: number) => delay(ms, undefined, { signal: sourceSignal() });

/** Cancel cooperatively and wait for settlement before releasing the worker. */
export async function withSourceBudget<T>(work: () => Promise<T>, ms: number, label: string,
  options: { softTimeoutMs?: number } = {}): Promise<T> {
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647) throw new Error(`Invalid source timeout: ${ms}`);
  const soft = options.softTimeoutMs;
  if (soft !== undefined && (!Number.isSafeInteger(soft) || soft < 1 || soft > ms)) throw new Error('Invalid source soft timeout');
  const startedAt = Date.now();
  const parent = budgets.getStore();
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error(`__TIMEOUT__ ${label}`)), ms);
  try {
    signal.throwIfAborted();
    return await budgets.run({ signal, startedAt, timeoutMs: ms, softTimeoutMs: soft }, async () => {
      try {
        const result = await work();
        assertSourceRunning();
        return result;
      } catch (error) {
        const reason = signal.aborted ? signal.reason : error;
        // Promise.all can reject while sibling requests are still pending.
        // Invalidate their budget too, so they cannot start new I/O or commit writes.
        controller.abort(reason);
        throw reason;
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

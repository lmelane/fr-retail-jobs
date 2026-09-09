import { log } from '../observability/logger.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const budgets = new AsyncLocalStorage<AbortSignal>();
export const sourceSignal = () => budgets.getStore();
export const assertSourceRunning = () => { log.assertHealthy(); sourceSignal()?.throwIfAborted(); };
export const sourceDelay = (ms: number) => delay(ms, undefined, { signal: sourceSignal() });

/** Cancel cooperatively and wait for settlement before releasing the worker. */
export async function withSourceBudget<T>(work: () => Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid source timeout: ${ms}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`__TIMEOUT__ ${label}`)), ms);
  try {
    return await budgets.run(controller.signal, async () => {
      try {
        const result = await work();
        assertSourceRunning();
        return result;
      } catch (error) {
        const reason = controller.signal.aborted ? controller.signal.reason : error;
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

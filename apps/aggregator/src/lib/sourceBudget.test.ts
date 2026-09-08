import { describe, expect, it } from 'vitest';
import { assertSourceRunning, sourceSignal, withSourceBudget } from './sourceBudget.js';

describe('source execution budget', () => {
  it('cancels sibling work after an ordinary failure, not only after timeouts', async () => {
    let sibling!: Promise<boolean>;
    await expect(withSourceBudget(async () => {
      sibling = new Promise(resolve => setTimeout(resolve, 15)).then(() => {
        try { assertSourceRunning(); return true; } catch { return false; }
      });
      await Promise.all([Promise.reject(new Error('listing failed')), sibling]);
    }, 1000, 'failure')).rejects.toThrow('listing failed');
    expect(await sibling).toBe(false);
  });
  it('does not release a worker until its cancelled work settles', async () => {
    let settled = false;
    let wrote = false;
    await expect(withSourceBudget(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
      settled = true;
      assertSourceRunning();
      wrote = true;
    }, 5, 'slow-source')).rejects.toThrow('__TIMEOUT__ slow-source');
    expect(settled).toBe(true);
    expect(wrote).toBe(false);
    expect(sourceSignal()).toBeUndefined();
  });

  it('isolates simultaneous sources and clears completed timers', async () => {
    const slow = withSourceBudget(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      assertSourceRunning();
    }, 5, 'slow').catch(error => error.message);
    const healthy = withSourceBudget(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      assertSourceRunning();
      return 'healthy';
    }, 1000, 'healthy');
    expect(await Promise.all([slow, healthy])).toEqual(['__TIMEOUT__ slow', 'healthy']);
  });
});

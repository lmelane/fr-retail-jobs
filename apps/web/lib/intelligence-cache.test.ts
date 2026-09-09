import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ latest: vi.fn(), occupation: vi.fn(), values: new Map<string, unknown>() }));
vi.mock('@catwalks/db', () => ({ prisma: { dataCorrection: { findFirst: state.latest }, occupationState: { findUniqueOrThrow: state.occupation } } }));
vi.mock('./jobs', () => ({ DatabaseUnavailableError: class extends Error {} }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => Promise<unknown>, keys: string[]) => async () => {
  const key = JSON.stringify(keys);
  if (!state.values.has(key)) state.values.set(key, await fn());
  return state.values.get(key);
} }));
import { cached } from './intelligence/cache';

beforeEach(() => { state.values.clear(); state.latest.mockReset(); state.occupation.mockResolvedValue({releaseId:"occupation-v1",updatedAt:new Date(0)}); });

it('a new committed correction invalidates the aggregate without a restart', async () => {
  const query = vi.fn().mockResolvedValueOnce(44).mockResolvedValueOnce(22);
  const read = cached('counts', query);
  state.latest.mockResolvedValue({ id: 'before' });
  expect(await read()).toBe(44);
  expect(await read()).toBe(44);
  state.latest.mockResolvedValue({ id: 'after' });
  expect(await read()).toBe(22);
  expect(query).toHaveBeenCalledTimes(2);
});

it('never serves an old cached truth if the correction revision cannot be read', async () => {
  const read = cached('counts', async () => 44);
  state.latest.mockResolvedValue({ id: 'before' });
  await read();
  state.latest.mockRejectedValue(new Error('database unavailable'));
  await expect(read()).rejects.toThrow();
});

it('occupation replay progress invalidates cached counts without waiting an hour',async()=>{
  state.latest.mockResolvedValue(null);
  const query=vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(20),read=cached('occupation-counts',query);
  expect(await read()).toBe(10);
  state.occupation.mockResolvedValue({releaseId:'occupation-v1',updatedAt:new Date(1000)});
  expect(await read()).toBe(20);
});

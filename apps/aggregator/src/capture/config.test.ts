import { describe, expect, it } from 'vitest';
import { captureConfig } from './config.js';

describe('stable collector configuration', () => {
  it('isolates nested filters from caller mutation and rejects reader mutation', () => {
    const input = { filters: { brands: ['Maison'] }, unknown: null };
    const snapshot = captureConfig(input);
    input.filters.brands.push('Other');
    expect(snapshot).toEqual({ filters: { brands: ['Maison'] }, unknown: null });
    expect(() => (snapshot.filters as { brands: string[] }).brands.push('Injected')).toThrow(TypeError);
  });
  it.each(['deadlineMs', 'startPage', 'progress'])('refuses the transient %s control', field => {
    expect(() => captureConfig({ [field]: 1 })).toThrow('Execution control');
  });
  it.each([NaN, Infinity, undefined, new Date(), () => 'callback'])('refuses a value JSON cannot preserve exactly: %s', value => {
    expect(() => captureConfig({ value })).toThrow('finite JSON');
  });
  it('rejects cycles and oversized configurations before collector execution', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => captureConfig(cyclic)).toThrow('structure budget');
    expect(() => captureConfig({ payload: 'x'.repeat(1_048_577) })).toThrow('1 MiB');
  });
});

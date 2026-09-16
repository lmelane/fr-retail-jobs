import { describe, it, expect } from 'vitest';
import { parseCaptureArguments } from './cliArguments.js';
describe('native evidence command scope', () => {
  it.each([
    ['--collect-source=maison'], ['--validate-source=batch'],
    ['--collect-source=maison', '--apply', '--verified-jobs=9999'],
    ['--collect-source=maison', '--validate-source=batch', '--apply'],
    ['--collect-source=maison', '--collect-source=other', '--apply'],
    ['--collect-source=maison', '--apply', '--deadline-ms=NaN'],
    ['--collect-source=maison', '--apply', '--deadline-ms=0'],
    ['--validate-source=batch', '--apply', '--deadline-ms=1000'],
    ['--replay=batch', '--config=private.json', '--out=private.json', '--apply'],
    ['--capture=id'], ['--replay=batch', '--out=private.json'],
  ])('rejects ambiguous, unbounded or unsupported invocation %j', (...args) => {
    expect(() => parseCaptureArguments(args)).toThrow();
  });
  it('accepts private evidence reads and offline replay without source mutations', () => {
    expect(parseCaptureArguments(['--capture=id', '--out=private.bin'])).toEqual({ capture: 'id', out: 'private.bin' });
    expect(parseCaptureArguments(['--replay=batch', '--config=private.json', '--out=private.json'])).toMatchObject({ replay: 'batch' });
    expect(() => parseCaptureArguments(['--collect-source=maison', '--apply'])).toThrow();
    expect(() => parseCaptureArguments(['--validate-source=batch', '--apply'])).toThrow();
  });
});

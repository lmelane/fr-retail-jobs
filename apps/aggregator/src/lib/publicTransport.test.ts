import { describe, expect, it } from 'vitest';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { publicLookup } from './publicTransport.js';

function resolve(answers: LookupAddress[], all = true): Promise<string | LookupAddress[]> {
  const dns: LookupFunction = (_host, _options, callback) => callback(null, answers);
  return new Promise((accept, reject) => publicLookup(dns)('careers.example', { all }, (err, result) => {
    if (err) reject(err); else accept(result);
  }));
}

describe('DNS at socket connection', () => {
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', 'fe90::1', '::ffff:7f00:1'])('refuses %s from a public-looking hostname', async address => {
    await expect(resolve([{ address, family: address.includes(':') ? 6 : 4 }])).rejects.toThrow('DNS:careers.example');
  });
  it('refuses a mixed public/private answer rather than permitting fallback to the private IP', async () => {
    await expect(resolve([{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }])).rejects.toThrow();
  });
  it('hands the validated public addresses directly to the socket in either lookup mode', async () => {
    const answers = [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
    expect(await resolve(answers)).toEqual(answers);
    expect(await resolve(answers, false)).toBe('1.1.1.1');
  });
});

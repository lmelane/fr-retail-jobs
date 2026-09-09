import { describe, expect, it } from 'vitest';
import { rememberSessionCookies, sessionHeaders, withHttpSession } from './httpSession.js';

const set = (url: string, cookie: string) => rememberSessionCookies(url, new Headers({ 'set-cookie': cookie }));
const get = async (url: string, headers: NonNullable<RequestInit['headers']> = {}) => (await sessionHeaders(url, headers)).get('cookie');

describe('source HTTP sessions', () => {
  it('keeps a publisher session during pagination and never shares it with another run', async () => {
    await withHttpSession(async () => {
      await set('https://jobs.example.com/search/', 'JSESSIONID=server-one; Path=/; HttpOnly; Secure');
      expect(await get('https://jobs.example.com/search/?startrow=50')).toBe('JSESSIONID=server-one');
    });
    await withHttpSession(async () => expect(await get('https://jobs.example.com/search/')).toBeNull());
  });
  it('isolates simultaneous source fetches even on the same ATS hostname', async () => {
    await Promise.all(['tenant-a', 'tenant-b'].map(value => withHttpSession(async () => {
      await set('https://jobs.example.com/', `session=${value}; Path=/`);
      await Promise.resolve();
      expect(await get('https://jobs.example.com/')).toBe(`session=${value}`);
    })));
  });
  it('respects cookie host, path, expiry and secure restrictions', async () => withHttpSession(async () => {
    await set('https://jobs.example.com/search/', 'session=one; Path=/search; Secure');
    expect(await get('https://other.example.com/search/')).toBeNull();
    expect(await get('https://jobs.example.com/job/1')).toBeNull();
    expect(await get('http://jobs.example.com/search/')).toBeNull();
    await set('https://jobs.example.com/search/', 'session=; Path=/search; Max-Age=0; Secure');
    expect(await get('https://jobs.example.com/search/')).toBeNull();
  }));
  it('updates rotated session cookies without overriding explicit caller credentials', async () => withHttpSession(async () => {
    await set('https://jobs.example.com/', 'session=one; Path=/');
    await set('https://jobs.example.com/', 'session=two; Path=/');
    expect(await get('https://jobs.example.com/')).toBe('session=two');
    expect(await get('https://jobs.example.com/', { cookie: 'session=explicit; waf=token' })).toBe('session=explicit; waf=token');
  }));
  it('does not change stateless callers', async () => {
    await set('https://jobs.example.com/', 'session=ignored; Path=/');
    expect(await get('https://jobs.example.com/', { cookie: 'caller=one' })).toBe('caller=one');
  });
});

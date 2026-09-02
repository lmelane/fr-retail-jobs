import { describe, it, expect } from 'vitest';
import { isPublicHttpUrl, assertPublicUrl } from './ssrf.js';

/**
 * The SSRF guard must let normal ATS/careers URLs through and refuse anything
 * that points at an internal target or uses a non-HTTP scheme.
 */

describe('isPublicHttpUrl — allows real public endpoints', () => {
  it('allows ordinary https careers/ATS hosts', () => {
    expect(isPublicHttpUrl('https://jobs.courir.com/sitemap.xml')).toBe(true);
    expect(isPublicHttpUrl('https://boards.greenhouse.io/acme')).toBe(true);
    expect(isPublicHttpUrl('http://example.com/jobs')).toBe(true);
    expect(isPublicHttpUrl('https://acme.recruitee.com/api/offers')).toBe(true);
  });
});

describe('isPublicHttpUrl — refuses internal and non-HTTP targets', () => {
  it('refuses the cloud metadata endpoint', () => {
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isPublicHttpUrl('http://metadata.google.internal/computeMetadata/v1/')).toBe(false);
  });

  it('refuses localhost and loopback', () => {
    expect(isPublicHttpUrl('http://localhost:5432')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://[::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://db.localhost/')).toBe(false);
  });

  it('refuses private RFC1918 ranges', () => {
    expect(isPublicHttpUrl('http://10.0.0.5/')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1/')).toBe(false);
    expect(isPublicHttpUrl('http://172.16.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://172.20.10.1/')).toBe(false);
  });

  it('refuses .internal / .local hosts (Railway private domain etc.)', () => {
    expect(isPublicHttpUrl('http://postgres.railway.internal:5432')).toBe(false);
    expect(isPublicHttpUrl('http://printer.local/')).toBe(false);
  });

  it('refuses non-HTTP schemes', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('ftp://example.com/')).toBe(false);
    expect(isPublicHttpUrl('gopher://example.com/')).toBe(false);
    expect(isPublicHttpUrl('data:text/html,<script>')).toBe(false);
  });

  it('refuses malformed input', () => {
    expect(isPublicHttpUrl('not a url')).toBe(false);
    expect(isPublicHttpUrl('')).toBe(false);
    expect(isPublicHttpUrl('//no-scheme.com')).toBe(false);
  });

  it('assertPublicUrl throws on a blocked URL and passes a good one', () => {
    expect(() => assertPublicUrl('http://169.254.169.254/')).toThrow();
    expect(() => assertPublicUrl('https://jobs.courir.com/')).not.toThrow();
  });
});

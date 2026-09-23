import { describe, expect, it } from 'vitest';
import { readRobotsResponse } from './robotsResponse.js';
import { robotsVerdictFor } from './robotsVerdict.js';

const read = (body: string | Buffer, status = 200, type = 'text/html') => readRobotsResponse(status, { 'content-type': type }, Buffer.from(body));
describe('non-standard robots responses', () => {
  it('parses ordinary HTML without manufacturing a prohibition', () => {
    const result = read('<html><title>Jobs</title><body><h1>Our vacancies</h1><a href="/login">Sign in</a></body></html>');
    expect(result).toMatchObject({ kind: 'RULES', nonStandard: true });
    expect(robotsVerdictFor(result.text, '/jobs')).toBe('ALLOWED');
  });
  it('retains valid HTML-wrapped rules and ignores executable content', () => {
    const result = read('<html><body><pre>User-agent: CatwalksBot<br>Disallow: /jobs</pre><script>User-agent: *\nAllow: /</script></body></html>');
    expect(robotsVerdictFor(result.text, '/jobs/1')).toBe('DISALLOWED');
    expect(robotsVerdictFor(result.text, '/other')).toBe('ALLOWED');
  });
  it('keeps text rules even with a misleading MIME type', () => {
    expect(robotsVerdictFor(read('User-agent: *\nDisallow: /jobs').text, '/jobs')).toBe('DISALLOWED');
    expect(read('User-agent: *\nAllow: /', 200, 'text/plain').nonStandard).toBe(false);
  });
  it.each([404, 410])('recognizes missing robots (%s)', status => {
    expect(read('Not found', status)).toMatchObject({ kind: 'NO_ROBOTS', text: null });
  });
  it.each([401, 403, 406])('preserves the unavailable observation for HTTP %s without inventing rules', status => {
    expect(read('Error', status)).toMatchObject({ kind: 'UNREACHABLE', text: null });
  });
  it.each([429, 500, 503])('blocks temporary failure HTTP %s', status => {
    expect(() => read('Error', status)).toThrow('unreachable');
  });
  it.each(['<html><title>Just a moment...</title></html>', '<html><title>Sign in</title><body>Account</body></html>',
    '<html><body><input type="password"></body></html>', '<html>Sign in</html>'])('blocks access walls', body => {
    expect(() => read(body)).toThrow(/challenge|wall/);
  });
  it('detects the actual response headers, including an empty AWS challenge', () => {
    expect(() => readRobotsResponse(202, { 'x-amzn-waf-action': 'challenge' }, Buffer.alloc(0))).toThrow('challenge');
  });
  it('does not recover from decoding, size or comparison failures with permission', () => {
    expect(() => read(Buffer.from([255]))).toThrow();
    expect(() => read('x'.repeat(512001))).toThrow('limit');
    expect(() => read('{"error":"denied"}', 200, 'application/json')).toThrow('type');
    const result = read('User-agent: CatwalksBot\nDisallow: /*' + 'a'.repeat(8000) + 'z$', 200, 'text/plain');
    expect(() => robotsVerdictFor(result.text, '/' + 'a'.repeat(16000))).toThrow('budget');
  });
});

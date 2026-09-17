import { describe, expect, it } from 'vitest';
import { robotsVerdictFor } from './robotsVerdict.js';

describe('robots.txt observation for CatwalksBot on the requested path', () => {
  it('reads permissive rules and separate exceptions for other named crawlers', () => {
    expect(robotsVerdictFor('User-agent: *\nAllow: /\nCrawl-delay: 1\n', '/v0/postings/arcteryx.com')).toBe('ALLOWED');
    expect(robotsVerdictFor('User-agent: *\nAllow: /\nUser-agent: Amazonbot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\n', '/arcteryx.com')).toBe('ALLOWED');
  });
  it('applies the longest matching rule, Allow winning a tie, and distinguishes an absent file from a body with no applicable group', () => {
    const robots = 'User-agent: *\nDisallow: /wday/\nAllow: /wday/cxs/\nDisallow: /private\n';
    expect(robotsVerdictFor(robots, '/wday/cxs/tenant/site/jobs')).toBe('ALLOWED');
    expect(robotsVerdictFor(robots, '/wday/authgwy/x')).toBe('DISALLOWED');
    expect(robotsVerdictFor(robots, '/private/anything')).toBe('DISALLOWED');
    expect(robotsVerdictFor('User-agent: *\nDisallow: /*.json$\n', '/jobs.json')).toBe('DISALLOWED');
    expect(robotsVerdictFor('User-agent: Googlebot\nDisallow: /\n', '/jobs')).toBe('ALLOWED');
    expect(robotsVerdictFor(null, '/jobs')).toBe('NO_ROBOTS');
    expect(robotsVerdictFor('User-agent: *\nDisallow: /\n', '/jobs')).toBe('DISALLOWED');
    expect(robotsVerdictFor('User-agent: *\nDisallow:\n', '/jobs')).toBe('ALLOWED');
  });
});

describe('CatwalksBot rule selection and native paths', () => {
  it.each([
    ['named refusal overrides wildcard allowance', 'User-agent: *\nAllow: /\nUser-agent: CatwalksBot\nDisallow: /jobs', '/jobs/1', 'DISALLOWED'],
    ['named allowance excludes wildcard refusal', 'User-agent: *\nDisallow: /\nUser-agent: CatwalksBot\nAllow: /jobs', '/jobs/1', 'ALLOWED'],
    ['all named groups combine case-insensitively', 'USER-AGENT: CatwalksBot\nDisallow: /jobs\nUser-agent: cAtWaLkSbOt\nAllow: /jobs/public', '/jobs/public/1', 'ALLOWED'],
    ['later named refusal is included', 'User-agent: CatwalksBot\nAllow: /public\nUser-agent: CatwalksBot\nDisallow: /jobs', '/jobs/1', 'DISALLOWED'],
    ['all wildcard groups combine', 'User-agent: *\nAllow: /public\nUser-agent: *\nDisallow: /jobs', '/jobs/1', 'DISALLOWED'],
    ['an unrelated named agent gives no exception', 'User-agent: LinkedInBot\nAllow: /\nUser-agent: *\nDisallow: /', '/jobs', 'DISALLOWED'],
    ['a longer unrelated product token does not match ours', 'User-agent: CatwalksBot-Images\nAllow: /\nUser-agent: *\nDisallow: /', '/jobs', 'DISALLOWED'],
    ['unknown records between agents do not split a group', 'User-agent: CatwalksBot\nSitemap: https://example.com/sitemap.xml\nUser-agent: OtherBot\nDisallow: /jobs', '/jobs', 'DISALLOWED'],
    ['an empty named final group overrides wildcard', 'User-agent: *\nDisallow: /\nUser-agent: CatwalksBot', '/jobs', 'ALLOWED'],
    ['CR newlines and BOM are accepted', '\uFEFFUser-agent: CatwalksBot\rDisallow: /jobs\r', '/jobs', 'DISALLOWED'],
    ['comments do not become rules', '# User-agent: CatwalksBot\n# Disallow: /\nUser-agent: *\nDisallow: /jobs # reason', '/jobs/1', 'DISALLOWED'],
    ['rules before a group are ignored', 'Disallow: /\nUser-agent: CatwalksBot\nAllow: /jobs', '/elsewhere', 'ALLOWED'],
    ['an empty disallow still separates agent groups', 'User-agent: CatwalksBot\nDisallow:\nUser-agent: OtherBot\nDisallow: /', '/jobs', 'ALLOWED'],
    ['paths remain case sensitive', 'User-agent: *\nDisallow: /Jobs', '/jobs', 'ALLOWED'],
    ['unreserved percent octets are decoded', 'User-agent: *\nDisallow: /%6Aobs', '/jobs/1', 'DISALLOWED'],
    ['a reserved encoded slash remains distinct', 'User-agent: *\nDisallow: /jobs/private', '/jobs%2Fprivate', 'ALLOWED'],
    ['encoded reserved octets ignore hex case', 'User-agent: *\nDisallow: /jobs%2fprivate', '/jobs%2Fprivate', 'DISALLOWED'],
    ['native UTF-8 matches encoded UTF-8', 'User-agent: *\nDisallow: /café/ツ', '/caf%C3%A9/%E3%83%84', 'DISALLOWED'],
    ['encoded UTF-8 matches native UTF-8', 'User-agent: *\nDisallow: /caf%c3%a9', '/café/jobs', 'DISALLOWED'],
    ['encoded asterisk is literal', 'User-agent: *\nDisallow: /job%2Aname$', '/job*name', 'DISALLOWED'],
    ['encoded dollar is literal', 'User-agent: *\nDisallow: /job%24', '/job$', 'DISALLOWED'],
    ['internal dollar is literal', 'User-agent: *\nDisallow: /job$name', '/job$name', 'DISALLOWED'],
    ['query participates in the match', 'User-agent: *\nDisallow: /jobs?private=1', '/jobs?private=1&offset=0', 'DISALLOWED'],
    ['end anchor includes query', 'User-agent: *\nDisallow: /jobs$', '/jobs?offset=0', 'ALLOWED'],
    ['wildcards match zero characters', 'User-agent: *\nDisallow: /a*b*c$', '/abc', 'DISALLOWED'],
    ['wildcards retry a later suffix', 'User-agent: *\nDisallow: /a*b*c$', '/abxbxc', 'DISALLOWED'],
    ['trailing stars do not outweigh an equivalent allowance', 'User-agent: *\nDisallow: /jobs***\nAllow: /jobs', '/jobs/1', 'ALLOWED'],
    ['allow wins an equal-length conflict', 'User-agent: *\nDisallow: /*.ph\nAllow: /page', '/page.php5', 'ALLOWED'],
    ['a more specific wildcard path wins', 'User-agent: *\nAllow: /page\nDisallow: /*.htm', '/page.htm', 'DISALLOWED'],
    ['regex syntax in paths is literal', 'User-agent: *\nDisallow: /job[1].(x)', '/job1ax', 'ALLOWED'],
    ['robots resource is implicitly allowed', 'User-agent: CatwalksBot\nDisallow: /', '/robots.txt', 'ALLOWED'],
  ])('%s', (_name, body, path, expected) => {
    expect(robotsVerdictFor(body, path)).toBe(expected);
  });

  it.each(['https://example.com/jobs', '/jobs#fragment', '/jobs\n', '/jobs with spaces', '/' + 'x'.repeat(16_384)])('rejects an invalid or excessive request target', path => {
    expect(() => robotsVerdictFor('User-agent: *\nAllow: /', path)).toThrow('Invalid robots request path');
  });

  it('reads at least 500 KiB and rejects an incomplete oversized evaluation', () => {
    const end = '\nUser-agent: CatwalksBot\nDisallow: /jobs';
    const body = '#' + 'x'.repeat(512_000 - end.length - 1) + end;
    expect(robotsVerdictFor(body, '/jobs')).toBe('DISALLOWED');
    expect(() => robotsVerdictFor(body + '\n', '/jobs')).toThrow('parsing limit');
  });

  it('bounds hostile wildcard matching instead of allowing after a partial scan', () => {
    const body = 'User-agent: CatwalksBot\nDisallow: /*' + 'a'.repeat(8_000) + 'z$';
    expect(() => robotsVerdictFor(body, '/' + 'a'.repeat(16_000))).toThrow('budget');
  });
});

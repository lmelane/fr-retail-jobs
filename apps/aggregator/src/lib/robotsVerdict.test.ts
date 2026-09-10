import { describe, expect, it } from 'vitest';
import { robotsVerdictFor } from './robotsVerdict.js';

describe('robots.txt verdict for the generic agent on the path the adapter requests', () => {
  it('reads the real Lever files: api.lever.co allows everything, jobs.lever.co allows * and blocks named crawlers only', () => {
    expect(robotsVerdictFor('User-agent: *\nAllow: /\nCrawl-delay: 1\n', '/v0/postings/arcteryx.com')).toBe('ALLOWED');
    expect(robotsVerdictFor('User-agent: *\nAllow: /\nUser-agent: Amazonbot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\n', '/arcteryx.com')).toBe('ALLOWED');
  });
  it('applies the longest matching rule, Allow winning a tie, and treats a missing file or a missing * group as allowing', () => {
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

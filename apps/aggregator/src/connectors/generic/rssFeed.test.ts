import { describe, it, expect } from 'vitest';
import { parseFeed } from './rssFeed.js';

/**
 * The generic RSS/Atom parser — the code-free ingestion path for the long tail.
 * Locks both feed shapes and the "no title or link -> skip" guard (a candidate
 * must be able to open every offer we keep).
 */

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Conseiller de vente H/F]]></title>
    <link>https://careers.example.com/jobs/123</link>
    <description>&lt;p&gt;Vendez des choses&lt;/p&gt;</description>
    <location>Paris</location>
    <pubDate>Tue, 02 Sep 2026 10:00:00 GMT</pubDate>
    <guid>job-123</guid>
  </item>
  <item>
    <title>No link here</title>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Store Manager</title>
    <link href="https://careers.example.com/jobs/456" rel="alternate"/>
    <summary>Lead a boutique</summary>
    <published>2026-09-01T09:00:00Z</published>
    <id>tag:example,456</id>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('parses an RSS 2.0 item into a normalized job', () => {
    const jobs = parseFeed(RSS);
    expect(jobs).toHaveLength(1); // the link-less item is skipped
    expect(jobs[0]).toMatchObject({
      title: 'Conseiller de vente H/F',
      url: 'https://careers.example.com/jobs/123',
      location: 'Paris',
      externalId: 'job-123',
    });
    expect(jobs[0].description).toContain('Vendez des choses');
    expect(jobs[0].postedAt?.getUTCFullYear()).toBe(2026);
  });

  it('parses an Atom entry, taking the href from the link attribute', () => {
    const jobs = parseFeed(ATOM);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: 'Store Manager',
      url: 'https://careers.example.com/jobs/456',
      externalId: 'tag:example,456',
    });
  });

  it('returns no jobs for a feed with no items', () => {
    expect(parseFeed('<rss><channel></channel></rss>')).toHaveLength(0);
  });
});

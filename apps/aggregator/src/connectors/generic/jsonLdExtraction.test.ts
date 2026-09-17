import { describe, expect, it } from 'vitest';
import { extractJobPostings } from './jsonLdSitemap.js';
const node = { '@type': 'JobPosting', title: 'Own job', description: 'Source text &amp; literal entity', datePosted: '2026-09-04T14:07:48.268Z', validThrough: '2026-10-31T22:59:00.000Z' };
const json = JSON.stringify(node);
describe('JobPosting scripts follow HTML attribute parsing', () => {
  it.each(['type=application/ld+json', 'type = "application/ld+json"', "TYPE = 'APPLICATION/LD+JSON'", 'type="application/ld+json; charset=utf-8"', 'data-note=example type=application/ld+json'])('reads %s without altering JSON strings', attributes => {
    expect(extractJobPostings(`<script ${attributes}>${json}</script>`)).toEqual([node]);
  });
  it('ignores comments, data attributes and inert template content', () => {
    const decoy = `<script type=application/ld+json>${json}</script>`;
    expect(extractJobPostings(`<!--${decoy}--><template>${decoy}</template><noscript>${decoy}</noscript><script data-type="application/ld+json">${json}</script>`)).toEqual([]);
  });
  it('does not parse a script-shaped attribute as an element', () => {
    const escaped = json.replaceAll('"', '&quot;');
    expect(extractJobPostings(`<div data-snippet="<script type='application/ld+json'>${escaped}</script>"></div>`)).toEqual([]);
  });
  it('preserves graph/array traversal and reads a valid block after malformed JSON', () => {
    expect(extractJobPostings(`<script type=application/ld+json>{broken</script><script type=application/ld+json>${JSON.stringify([{ '@graph': [node, { '@type': 'WebPage' }] }])}</script>`)).toEqual([node]);
  });
  it('retains the qualified control-character recovery without executing script code', () => {
    const malformed = '{"@type":"JobPosting","title":"Own job","description":"first\nsecond"}';
    expect(extractJobPostings(`<script type=application/ld+json>${malformed}</script>`)).toEqual([{ '@type': 'JobPosting', title: 'Own job', description: 'first second' }]);
    expect(extractJobPostings('<script type=application/ld+json>globalThis.secret = 1</script>')).toEqual([]);
  });
});

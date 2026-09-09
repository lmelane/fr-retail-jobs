import { describe, expect, it } from 'vitest';
import { isRejectionFailure, splitRejectedRows } from './rejectedRows.js';

describe('rejected rows: explained witnesses vs collection failures', () => {
  it('classifies the reasons the adapters emit', () => {
    for (const r of ['LISTED_PAGE_WITHOUT_JOBPOSTING', 'ROW_WITHOUT_EXTERNAL_PATH', 'RSS_ITEM_LINK_OFF_BOARD_AND_ABSENT_FROM_LISTING']) expect(isRejectionFailure(r)).toBe(false);
    for (const r of ['LISTED_PAGE_FETCH_FAILED', 'DETAIL_FETCH_FAILED', 'DETAIL_UNPARSED', 'MALFORMED_SOURCE_ROW']) expect(isRejectionFailure(r)).toBe(true);
  });
  it('splits Alberto-like output: 74 expired pages are not 74 errors', () => {
    const rows = [...Array.from({ length: 74 }, (_, i) => ({ reason: 'LISTED_PAGE_WITHOUT_JOBPOSTING', raw: { url: `https://x/${i}` } })), { reason: 'LISTED_PAGE_FETCH_FAILED', raw: { url: 'https://x/f' } }];
    const s = splitRejectedRows(rows);
    expect(s.failures).toHaveLength(1); expect(s.explained).toHaveLength(74); expect(s.reasons).toEqual({ LISTED_PAGE_WITHOUT_JOBPOSTING: 74, LISTED_PAGE_FETCH_FAILED: 1 });
    expect(splitRejectedRows(undefined)).toEqual({ failures: [], explained: [], reasons: {} });
  });
});

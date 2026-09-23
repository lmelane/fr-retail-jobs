import { load } from 'cheerio';
import { detectChallenge } from './responseIntegrity.js';

/** Interpret a complete HTTP response, independently of the authorization policy.
 * Non-standard HTML is parsed for rules; failures are never an empty ruleset. */
export function readRobotsResponse(status: number, headers: Record<string, unknown>, body: Buffer) {
  const contentType = String(headers['content-type'] ?? '');
  if ([404, 410].includes(status)) return { kind: 'NO_ROBOTS' as const, text: null, nonStandard: false };
  // Preserve the existing policy for an unavailable robots endpoint. A 4xx on
  // robots is neither an empty ruleset nor proof that the public jobs require
  // authentication. Authorization still comes from the reviewed job surface.
  if (status >= 400 && status < 500 && status !== 429)
    return { kind: 'UNREACHABLE' as const, text: null, nonStandard: false };
  if (status < 200 || status >= 300) throw new Error(`Robots temporarily unreachable: HTTP ${status}`);
  if (body.length > 512_000) throw new Error('Robots document exceeds parsing limit');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  const response = new Response(null, { status, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)])) });
  if (detectChallenge(response, text)) throw new Error('Robots response is an access challenge');
  if (contentType && !/^(?:text\/[a-z.+-]+|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(contentType))
    throw new Error('Robots response has an unsupported document type');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) throw new Error('Robots response contains binary data');
  const html = /<\s*(?:!doctype|html|head|body|pre|p|div|br)\b/i.test(text) || /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
  if (!html) return { kind: 'RULES' as const, text, nonStandard: !/^text\/plain(?:\s*;|\s*$)/i.test(contentType) };
  const $ = load(text);
  // A login wall is not a successful robots observation. Do not infer this from
  // a navigation link mentioning an account on an otherwise public job listing.
  if ($('input[type="password"]').length || /^(?:sign in|log ?in|connexion|access denied|unauthorized|forbidden)\b/i.test($('title').text().trim()) ||
    /^(?:sign in|log ?in|connexion|access denied|unauthorized|forbidden)\s*[.!]?$/i.test($('body').text().trim()))
    throw new Error('Robots response is an authentication or access wall');
  $('script,style,template,noscript').remove();
  $('br').replaceWith('\n');
  $('p,div,pre,li').each((_, node) => { $(node).prepend('\n').append('\n'); });
  return { kind: 'RULES' as const, text: $.root().text(), nonStandard: true };
}

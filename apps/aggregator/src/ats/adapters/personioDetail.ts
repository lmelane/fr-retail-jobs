import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { htmlToPlainText } from '../../lib/html.js';

/** Read JSON arguments without evaluating scripts, including delimiters inside strings. */
function flightChunks(html: string): string[] {
  const chunks: string[] = [];
  const $ = cheerio.load(html);
  $('script').each((_, script) => {
    const source = $(script).html() ?? '';
    for (const match of source.matchAll(/self\.__next_f\.push\(/g)) {
      const start = match.index! + match[0].length;
      let depth = 0, quoted = false, escaped = false;
      for (let end = start; end < source.length; end++) {
        const char = source[end];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '[' || char === '{') depth++;
        else if (char === ']' || char === '}') {
          depth--;
          if (depth === 0) {
            try {
              const value = JSON.parse(source.slice(start, end + 1));
              if (value[0] === 1 && typeof value[1] === 'string') chunks.push(value[1]);
            } catch { /* Not a JSON data argument. */ }
            break;
          }
        }
      }
    }
  });
  return chunks;
}

/** Flight T rows use UTF-8 byte lengths, not JS string lengths or line endings.
 * See ReactFlightClient processBinaryChunk; binary records are skipped, never executed.
 */
function flightRecords(chunks: string[]) {
  const buffer = Buffer.from(chunks.join(''), 'utf8');
  const models: unknown[] = [];
  const texts = new Map<string, string>();
  let offset = 0;
  let error: string | undefined;
  while (offset < buffer.length) {
    const colon = buffer.indexOf(58, offset);
    if (colon < 0 || !/^[0-9a-f]*$/i.test(buffer.toString('ascii', offset, colon))) {
      error = 'INVALID_FLIGHT_ROW_ID'; break;
    }
    const id = buffer.toString('ascii', offset, colon).toLowerCase();
    offset = colon + 1;
    const tag = String.fromCharCode(buffer[offset]);
    if ('TAOoUSsLlGgMmV'.includes(tag)) {
      const comma = buffer.indexOf(44, offset + 1);
      const hex = buffer.toString('ascii', offset + 1, comma < 0 ? offset + 1 : comma);
      if (comma < 0 || !/^[0-9a-f]+$/i.test(hex)) { error = 'INVALID_FLIGHT_ROW_LENGTH'; break; }
      const length = Number.parseInt(hex, 16);
      const end = comma + 1 + length;
      if (!Number.isSafeInteger(end) || end > buffer.length) { error = 'TRUNCATED_FLIGHT_ROW'; break; }
      if (tag === 'T') texts.set(id, buffer.toString('utf8', comma + 1, end));
      offset = end;
    } else {
      const newline = buffer.indexOf(10, offset);
      if (newline < 0) { error = 'TRUNCATED_FLIGHT_ROW'; break; }
      const body = buffer.toString('utf8', offset, newline);
      if (/^[\[{"]/.test(body)) {
        try {
          const value = JSON.parse(body);
          if (typeof value === 'string') texts.set(id, value);
          else models.push(value);
        } catch { error = 'INVALID_FLIGHT_MODEL'; }
      }
      offset = newline + 1;
    }
  }
  return { models, texts, error };
}

export function personioDetail(html: string, externalId: string) {
  const records = flightRecords(flightChunks(html));
  const matches = new Map<string, { job: any; settings: any }>();
  function visit(value: any, depth = 0) {
    if (depth > 40 || value == null) return;
    if (typeof value === 'string' && value.startsWith('{')) {
      try { visit(JSON.parse(value), depth + 1); } catch { /* Plain text. */ }
      return;
    }
    if (typeof value !== 'object') return;
    if (value.job && String(value.job.id) === externalId && typeof value.job.name === 'string') {
      const row = { job: value.job, settings: value.careerSiteSettings ?? null };
      matches.set(JSON.stringify(row), row);
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  records.models.forEach(model => visit(model));
  const baseEvidence = { method: 'PERSONIO_NEXT_FLIGHT', htmlSha256: createHash('sha256').update(html).digest('hex'),
    matchingModels: matches.size, ...(records.error ? { streamReadError: records.error } : {}) };
  if (matches.size !== 1) return { job: null, evidence: { ...baseEvidence,
    reason: matches.size ? 'CONFLICTING_JOB_MODELS' : 'NO_MATCHING_JOB_MODEL' } };
  const { job, settings } = [...matches.values()][0];
  const unresolved = new Set<string>();
  const resolvedText: Record<string, string> = {};
  const resolveText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    if (value.startsWith('$$')) return value.slice(1);
    if (/^\$[0-9a-f]+$/i.test(value)) {
      const text = records.texts.get(value.slice(1).toLowerCase());
      if (text === undefined) { unresolved.add(value); return ''; }
      resolvedText[value] = text;
      return text;
    }
    return value;
  };
  const sections = Array.isArray(job.fields) ? job.fields.map((field: any) => {
    const label = resolveText(field.label ?? field.name);
    const text = htmlToPlainText(resolveText(field.value));
    return text ? [label, text].filter(Boolean).join('\n') : '';
  }).filter(Boolean) : [];
  // Never replace a valid XML description with a partially decoded detail.
  const description = unresolved.size === 0 ? sections.join('\n\n') || undefined : undefined;
  const date = typeof job.published_at === 'string' ? new Date(job.published_at) : undefined;
  const addresses = Array.isArray(job.office_addresses) ? job.office_addresses : [];
  const countries = new Set(addresses.map((a: any) => a.country).filter((v: any) => typeof v === 'string' && v));
  const country = addresses.length && addresses.every((a: any) => typeof a.country === 'string' && a.country) && countries.size === 1
    ? [...countries][0] as string : undefined;
  const city = addresses.length === 1 && typeof addresses[0].city === 'string' ? addresses[0].city : undefined;
  return { job: { description, postedAt: date && !Number.isNaN(date.getTime()) ? date : undefined, country, city,
    employer: typeof settings?.company_name === 'string' && settings.company_name.trim() ? settings.company_name.trim() : undefined },
    evidence: { ...baseEvidence, position: job, careerSiteSettings: settings, resolvedText,
      ...(unresolved.size ? { descriptionReadError: 'UNRESOLVED_FLIGHT_TEXT', unresolvedTextReferences: [...unresolved] } : {}) } };
}

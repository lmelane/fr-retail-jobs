import { createReadStream } from 'node:fs';
/** NDJSON is delimited by ASCII LF. readline also treats Unicode U+2028 as
 * a line separator, but that character is valid inside a JSON string. */
export async function* readNdjson(path: string): AsyncGenerator<unknown> {
  let pending = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    pending += chunk;
    let offset = 0, end: number;
    while ((end = pending.indexOf('\n', offset)) !== -1) {
      const line = pending.slice(offset, end);
      if (line.trim()) yield JSON.parse(line);
      offset = end + 1;
    }
    pending = pending.slice(offset);
  }
  if (pending.trim()) yield JSON.parse(pending);
}

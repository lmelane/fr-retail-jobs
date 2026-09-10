/** Minimal RFC-4180 row parser: fields may be quoted and contain commas. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else current += char;
  }
  fields.push(current);
  return fields;
}

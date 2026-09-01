import { fetchJson } from '../lib/http.js';

type SerperResult = { title?: string; link?: string; snippet?: string };
type SerperResponse = { organic?: SerperResult[] };

export function isSearchConfigured(): boolean {
  return Boolean(process.env.SERPER_API_KEY);
}

export async function searchWeb(query: string): Promise<SerperResult[]> {
  const key = process.env.SERPER_API_KEY;
  // Returning [] here would make every company look like "no careers page found"
  // instead of "discovery was never actually attempted". Fail loudly instead.
  if (!key) throw new Error('SERPER_API_KEY is not set; ATS discovery cannot run.');
  const data = await fetchJson<SerperResponse>('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'fr', hl: 'fr', num: 10 }),
  });
  return data.organic ?? [];
}

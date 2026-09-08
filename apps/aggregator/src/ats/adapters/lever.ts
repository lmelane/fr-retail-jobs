import { fetchJson } from '../../lib/http.js';
import type { AdapterResult } from '../../types.js';

export type LeverJob = { id: string; text: string; hostedUrl: string; createdAt?: number; descriptionPlain?: string; categories?: { location?: string; commitment?: string; department?: string } };

/** Exact, tenant-reviewed department mapping; an unknown department stays unresolved. */
export function leverEmployer(job: LeverJob, mapping: unknown): string | undefined {
  const department = job.categories?.department;
  if (!department || !mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Object.hasOwn(mapping, department)) return undefined;
  const value = (mapping as Record<string, unknown>)[department];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function fetchLeverJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const site = String(config.site ?? '');
  if (!site) throw new Error('Lever site missing');
  const pageSize = 100;
  const maxPages = Number(config.maxPages ?? 1000);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new Error('Invalid Lever maxPages');
  const region = String(config.region ?? 'global');
  if (!['global', 'eu'].includes(region)) throw new Error('Invalid Lever region');
  const origin = region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co';
  const jobs: LeverJob[] = [];
  const seen = new Set<string>();
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    if (Number(config.deadlineMs) > 0 && Date.now() >= Number(config.deadlineMs)) break;
    let rows: LeverJob[];
    try {
      rows = await fetchJson<LeverJob[]>(`${origin}/v0/postings/${encodeURIComponent(site)}?mode=json&skip=${page * pageSize}&limit=${pageSize}`);
      if (!Array.isArray(rows) || rows.some(row => !row.id || !row.text || !row.hostedUrl)) {
        throw new Error('Invalid Lever postings response');
      }
    } catch (error) {
      if (jobs.length === 0) throw error;
      break; // Preserve collected postings, but never attest absence after a failed page.
    }
    let repeated = false;
    for (const row of rows) {
      if (seen.has(row.id)) { repeated = true; continue; }
      seen.add(row.id);
      jobs.push(row);
    }
    if (repeated) break;
    if (rows.length < pageSize) { complete = true; break; }
  }
  const normalized = jobs.map((job) => ({
    externalId: job.id,
    title: job.text,
    company: leverEmployer(job, config.employerByDepartment),
    location: job.categories?.location,
    contract: job.categories?.commitment,
    description: job.descriptionPlain,
    url: job.hostedUrl,
    postedAt: job.createdAt ? new Date(job.createdAt) : undefined,
    raw: job,
  }));
  return { jobs: normalized, complete, truncated: !complete };
}

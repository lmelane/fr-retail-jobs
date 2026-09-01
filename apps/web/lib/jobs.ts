import { prisma } from '@catwalks/db';

/**
 * Job queries for the list and the map.
 *
 * Falls back to a small demo set when DATABASE_URL is absent or unreachable, so
 * the UI can be developed and reviewed before the Railway database is wired up.
 * The fallback is loud in the return value (`isDemo`) — a page must never pass
 * sample data off as real listings.
 */

/**
 * Filters mirror the aggregator's own model, so the UI exposes the whole
 * pipeline rather than a subset of it:
 *  - sector / maison / group  -> the 713-house reference list
 *  - contract                 -> the normalized contract vocabulary
 *  - city                     -> the collapsed location (Paris 8 -> PARIS)
 *  - source                   -> which connector saw the offer
 *  - multiSource              -> jobs confirmed by several sources
 *  - recency                  -> lifecycle freshness
 */
export type JobFilters = {
  q?: string;
  sector?: string;
  contract?: string;
  city?: string;
  group?: string;
  maison?: string;
  source?: string;
  multiSource?: boolean;
  /** Days since posting; undefined means no limit. */
  maxAgeDays?: number;
};

export type JobRow = {
  id: string;
  title: string;
  company: string;
  group: string | null;
  city: string | null;
  location: string | null;
  contract: string | null;
  sector: string | null;
  url: string;
  postedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  sourceCount: number;
  /** Registry keys of every source that reported this job. */
  sources: string[];
  /** Full posting text: ATS APIs return it with the listing, no extra fetch. */
  description: string | null;
  /** Employer-side apply URL of the highest-ranked source. */
  applyUrl: string;
};

export type JobsResult = {
  jobs: JobRow[];
  total: number;
  isDemo: boolean;
  facets: {
    sectors: { value: string; count: number }[];
    contracts: { value: string; count: number }[];
    cities: { value: string; count: number }[];
    groups: { value: string; count: number }[];
    maisons: { value: string; count: number }[];
    sources: { value: string; count: number }[];
  };
};

const DEMO_JOBS: JobRow[] = [
  {
    id: 'demo-1',
    title: 'Conseiller de Vente',
    company: 'Christian Dior Couture',
    group: 'LVMH',
    city: 'Paris',
    location: 'Paris, Île-de-France',
    contract: 'CDI',
    sector: 'LUXURY',
    url: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
    postedAt: new Date(Date.now() - 2 * 86_400_000),
    latitude: 48.859,
    longitude: 2.347,
    sourceCount: 3,
    sources: ['dior', 'lvmh', 'fashionjobs'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
  },
  {
    id: 'demo-2',
    title: 'Vendeuse / Vendeur - F/H',
    company: 'Groupe Courir',
    group: null,
    city: 'Saint-Germain-en-Laye',
    location: 'ST GERMAIN EN LAYE, 78100',
    contract: 'CDI',
    sector: 'RETAIL',
    url: 'https://jobs.courir.com/',
    postedAt: new Date(Date.now() - 86_400_000),
    latitude: 48.9239,
    longitude: 2.1112,
    sourceCount: 1,
    sources: ['courir'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://jobs.courir.com/',
  },
  {
    id: 'demo-3',
    title: 'Contrôleur(se) de Gestion',
    company: 'Repossi',
    group: 'LVMH',
    city: 'Paris',
    location: 'Paris, Ile-de-France',
    contract: 'CDI',
    sector: 'JEWELRY_WATCHES',
    url: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres/REPO00097',
    postedAt: new Date(Date.now() - 5 * 86_400_000),
    latitude: 48.859,
    longitude: 2.347,
    sourceCount: 2,
    sources: ['lvmh', 'fashionjobs'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres/REPO00097',
  },
  {
    id: 'demo-4',
    title: 'Responsable de Boutique',
    company: 'Cartier',
    group: 'Richemont',
    city: 'Cannes',
    location: 'Cannes, PACA',
    contract: 'CDI',
    sector: 'JEWELRY_WATCHES',
    url: 'https://careers.richemont.com/',
    postedAt: new Date(Date.now() - 9 * 86_400_000),
    latitude: 43.5555,
    longitude: 7.0046,
    sourceCount: 1,
    sources: ['richemont'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://careers.richemont.com/',
  },
  {
    id: 'demo-5',
    title: 'Chef de Produit Parfums',
    company: 'Guerlain',
    group: 'LVMH',
    city: 'Paris',
    location: 'Paris 8, Île-de-France',
    contract: 'CDI',
    sector: 'BEAUTY',
    url: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
    postedAt: new Date(Date.now() - 3 * 86_400_000),
    latitude: 48.872,
    longitude: 2.3,
    sourceCount: 2,
    sources: ['lvmh', 'wttj'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
  },
  {
    id: 'demo-6',
    title: 'Alternance - Assistant(e) de Direction',
    company: 'Richemont',
    group: 'Richemont',
    city: 'Lyon',
    location: 'Lyon, Auvergne-Rhône-Alpes',
    contract: 'ALTERNANCE',
    sector: 'JEWELRY_WATCHES',
    url: 'https://careers.richemont.com/',
    postedAt: new Date(Date.now() - 12 * 86_400_000),
    latitude: 45.758,
    longitude: 4.835,
    sourceCount: 1,
    sources: ['richemont'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://careers.richemont.com/',
  },
];

function countBy(rows: JobRow[], pick: (row: JobRow) => string | null) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = pick(row);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/** A job carries several sources, so it counts once per source it was seen in. */
function countBySource(rows: JobRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const source of row.sources) counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function applyFilters(rows: JobRow[], filters: JobFilters): JobRow[] {
  const needle = filters.q?.trim().toLowerCase();
  const cutoff = filters.maxAgeDays
    ? Date.now() - filters.maxAgeDays * 86_400_000
    : null;

  return rows.filter((row) => {
    if (filters.sector && row.sector !== filters.sector) return false;
    if (filters.contract && row.contract !== filters.contract) return false;
    if (filters.city && row.city !== filters.city) return false;
    if (filters.group && row.group !== filters.group) return false;
    if (filters.maison && row.company !== filters.maison) return false;
    if (filters.source && !row.sources.includes(filters.source)) return false;
    if (filters.multiSource && row.sourceCount < 2) return false;
    if (cutoff && (!row.postedAt || new Date(row.postedAt).getTime() < cutoff)) return false;
    if (needle && !`${row.title} ${row.company}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export async function getJobs(filters: JobFilters = {}): Promise<JobsResult> {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');

    const rows = await prisma.job.findMany({
      where: {
        isActive: true,
        isFrance: true,
        ...(filters.city ? { city: filters.city } : {}),
        ...(filters.contract ? { contract: filters.contract } : {}),
        ...(filters.q
          ? {
              OR: [
                { title: { contains: filters.q, mode: 'insensitive' } },
                { company: { name: { contains: filters.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        company: true,
        sources: { select: { sourceKey: true }, where: { isActive: true } },
      },
      orderBy: [{ postedAt: 'desc' }, { firstSeenAt: 'desc' }],
      take: 500,
    });

    const jobs: JobRow[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company.name,
      group: null,
      city: row.city,
      location: row.location,
      contract: row.contract,
      sector: row.company.sector,
      url: row.url,
      postedAt: row.postedAt,
      latitude: row.latitude,
      longitude: row.longitude,
      sourceCount: row.sources.length,
      sources: row.sources.map((source) => source.sourceKey),
      description: row.description,
      applyUrl: row.url,
    }));

    const filtered = applyFilters(jobs, filters);
    return {
      jobs: filtered,
      total: filtered.length,
      isDemo: false,
      facets: {
        sectors: countBy(jobs, (job) => job.sector),
        contracts: countBy(jobs, (job) => job.contract),
        cities: countBy(jobs, (job) => job.city),
        groups: countBy(jobs, (job) => job.group),
        maisons: countBy(jobs, (job) => job.company),
        sources: countBySource(jobs),
      },
    };
  } catch (error) {
    // Log before falling back: a silent demo fallback hides real failures, and
    // the page then looks "fine" while showing six fictional rows.
    console.error(
      '[jobs] database unavailable, serving demo data:',
      error instanceof Error ? error.message : String(error),
    );
    const filtered = applyFilters(DEMO_JOBS, filters);
    return {
      jobs: filtered,
      total: filtered.length,
      isDemo: true,
      facets: {
        sectors: countBy(DEMO_JOBS, (job) => job.sector),
        contracts: countBy(DEMO_JOBS, (job) => job.contract),
        cities: countBy(DEMO_JOBS, (job) => job.city),
        groups: countBy(DEMO_JOBS, (job) => job.group),
        maisons: countBy(DEMO_JOBS, (job) => job.company),
        sources: countBySource(DEMO_JOBS),
      },
    };
  }
}

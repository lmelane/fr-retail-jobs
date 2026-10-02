import type { NormalizedJob } from '../types.js';

type Publication = Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const COMPANY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, POSTING = /^[1-9]\d{5,19}$/;

/** `https://api.smartrecruiters.com/v1/companies/<société>/postings/<id>` : l'adresse native que porte la publication. */
function apiReference(value: unknown): { company: string; posting: string } | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    const match = /^\/v1\/companies\/([^/]+)\/postings\/([^/]+)$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'api.smartrecruiters.com' || url.username || url.password || url.port ||
      url.search || url.hash || !match || !COMPANY.test(match[1]) || !POSTING.test(match[2])) return;
    return { company: match[1].toLowerCase(), posting: match[2] };
  } catch { return; }
}

/**
 * Le lien de candidature public d'une publication SmartRecruiters : `https://jobs.smartrecruiters.com/<société>/<id>`
 * suivi ou non du libellé (`-conseiller-e-de-mode`). Les paramètres de suivi (`oga`, `sid`, `utm_*`…) ne changent pas
 * la publication ; un autre chemin, un autre hôte ou un fragment ne prouvent rien.
 */
export function smartRecruitersApplyIdentity(value: unknown): { company: string; posting: string } | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    const match = /^\/([^/]+)\/([1-9]\d{5,19})(?:-[^/\\\s]*)?\/?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'jobs.smartrecruiters.com' || url.username || url.password || url.port ||
      url.hash || !match || !COMPANY.test(match[1]) || /%(?:2f|5c|2e)/i.test(url.pathname)) return;
    return { company: match[1].toLowerCase(), posting: match[2] };
  } catch { return; }
}

/**
 * R-143 §4 (D-513) : une même publication SmartRecruiters, lue chez l'éditeur ou citée par un job board.
 *
 * - Chez l'éditeur, la publication porte son adresse d'API (`ref`) : société et identifiant, liés à l'identifiant écrit.
 * - Chez Welcome to the Jungle, la fiche publiée déclare son lien de candidature (`detail.apply_url`) : postuler sur la
 *   fiche, c'est postuler à CETTE publication. La fiche doit être une page du job board, pas un lien quelconque.
 *
 * L'identifiant de publication SmartRecruiters est numérique et propre à la société : la preuve exige les deux.
 */
export function smartRecruitersPublicationIdentity(publication: Publication) {
  const raw = publication.raw;
  if (!object(raw)) return;
  const native = apiReference(raw.ref);
  if (native) {
    return String(raw.id ?? '') === native.posting && publication.externalId === native.posting
      ? { tenant: `smartrecruiters:${native.company}`, requisition: native.posting } : undefined;
  }
  try {
    const page = new URL(publication.url);
    if (page.protocol !== 'https:' || page.hostname !== 'www.welcometothejungle.com' || !object(raw.detail)) return;
  } catch { return; }
  const cited = smartRecruitersApplyIdentity(raw.detail.apply_url);
  // Une citation ne prouve qu'en face de la publication de l'éditeur : deux citations ne se prouvent pas l'une l'autre.
  return cited ? { tenant: `smartrecruiters:${cited.company}`, requisition: cited.posting, delegated: true as const } : undefined;
}

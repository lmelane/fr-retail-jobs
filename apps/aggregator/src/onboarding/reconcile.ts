/** Discovery hints only. Names, employer domains and group labels never prove coverage. */
import { parse } from 'tldts';

export type CatalogueView = {
  readonly sourcesByDomain: ReadonlyMap<string, string>;
  readonly companiesWithOffers: ReadonlyMap<string, number>;
  readonly sourcesByCompany: ReadonlyMap<string, readonly string[]>;
  readonly brandCoveredByGroup: ReadonlyMap<string, string>;
};
export type Dossier = {
  readonly acteur: string;
  readonly type: 'MAISON' | 'ENSEIGNE' | 'GROUPE' | 'PORTAIL_REGIONAL' | 'SOURCE_SUPPLEMENTAIRE';
  readonly urlOfficielle: string;
  readonly groupe?: string | null;
  readonly pays?: string | null;
  readonly secteur?: string | null;
  readonly portalScope?: 'SINGLE_BRAND' | 'MULTI_BRAND' | null;
};
export type Overlap = {
  readonly kind: 'SIMILAR_ACTOR' | 'POSSIBLE_GROUP' | 'SHARED_EMPLOYER_DOMAIN';
  readonly sourceKeys: readonly string[];
  readonly detail: string;
};

/** Bounded discovery inputs carry assertions for examination, not verified facts. */
export function parseDossiers(input: unknown): Dossier[] {
  const values = Array.isArray(input) ? input : input && typeof input === 'object' && 'dossiers' in input ? input.dossiers : [input];
  if (!Array.isArray(values) || !values.length || values.length > 100) throw new Error('Discovery requires 1 to 100 dossiers');
  const fields = ['acteur', 'type', 'urlOfficielle', 'groupe', 'pays', 'secteur', 'portalScope'];
  for (const d of values) {
    if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some(k => !fields.includes(k)) ||
      typeof d.acteur !== 'string' || !d.acteur.trim() ||
      !['MAISON', 'ENSEIGNE', 'GROUPE', 'PORTAIL_REGIONAL', 'SOURCE_SUPPLEMENTAIRE'].includes(d.type) ||
      typeof d.urlOfficielle !== 'string' ||
      ['groupe', 'pays', 'secteur'].some(k => d[k] != null && typeof d[k] !== 'string') ||
      (d.portalScope != null && !['SINGLE_BRAND', 'MULTI_BRAND'].includes(d.portalScope))) throw new Error('Invalid discovery dossier');
    const url = new URL(d.urlOfficielle);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Discovery URL must be public HTTP without credentials');
  }
  return values;
}

/** Intentionally loose matching for research; never used as an employer identity key. */
export function normalizeActor(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|limited|sa|sas|sasu|gmbh|bv|nv|spa|srl|plc|co|corp|corporation|group|groupe)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const VENDOR_DOMAINS = new Set([
  'myworkdayjobs.com', 'greenhouse.io', 'lever.co', 'smartrecruiters.com', 'teamtailor.com',
  'recruitee.com', 'personio.de', 'personio.com', 'workable.com', 'welcometothejungle.com',
  'oraclecloud.com', 'icims.com', 'avature.net', 'successfactors.com', 'eightfold.ai',
  'jobaffinity.fr', 'flatchr.io', 'werecruit.io', 'candidater.fr', 'phenompeople.com',
  'ashbyhq.com', 'jobvite.com', 'taleo.net', 'brassring.com', 'silkroad.com',
]);


export function registrableDomain(url: string): string | null {
  try { return parse(new URL(url).hostname, { allowPrivateDomains: true }).domain; }
  catch { return null; }
}

export function findOverlaps(d: Dossier, cat: CatalogueView): Overlap[] {
  const out: Overlap[] = [];
  const actor = normalizeActor(d.acteur);
  const domain = registrableDomain(d.urlOfficielle);
  const source = domain && !VENDOR_DOMAINS.has(domain) ? cat.sourcesByDomain.get(domain) : null;
  if (source) out.push({ kind: 'SHARED_EMPLOYER_DOMAIN', sourceKeys: [source],
    detail: `Domaine ${domain} partagé avec ${source} ; le site, la région et le périmètre restent à comparer.` });
  const group = cat.brandCoveredByGroup.get(actor);
  if (group) out.push({ kind: 'POSSIBLE_GROUP', sourceKeys: [group],
    detail: `Libellé rapproché du groupe ${group} ; aucune couverture de la marque ou de ses pays n’est déduite.` });
  const offers = cat.companiesWithOffers.get(actor);
  const existing = cat.sourcesByCompany.get(actor) ?? [];
  if (offers && existing.length) out.push({ kind: 'SIMILAR_ACTOR', sourceKeys: existing,
    detail: `Libellé similaire : ${offers} offres portant le flag actif via ${existing.join(', ')} ; identité et recouvrement à examiner.` });
  return out;
}

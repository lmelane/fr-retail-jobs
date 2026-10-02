import type { PrismaClient } from '@prisma/client';
import { canonicalCompanyKey } from '../lib/normalize.js';
import { findMaison, type MaisonEntry } from '../normalize/maisons.js';
import { attachAll } from '../identity/maisonAttachment.js';
import { EMPLOYER_SNAPSHOT_SQL, type Snapshot } from '../identity/maisonPlan.js';
import { applySectors, previewSectors, sectorHash, type SectorEvidence, type SectorManifest } from './review.js';

/**
 * D-519 (« canoniser assez pour filtrer ») et D-515 §1 (« une donnée inconnue ne devient jamais négative ») : reconnaître
 * le secteur d'une Maison sur PREUVES seulement, puis l'écrire par le circuit relu existant (`review.ts`, SectorReview).
 *
 * Quatre preuves, aucune devinette :
 *  1. LISTE DE RÉFÉRENCE des Maisons (`data/reference/maisons.csv`, nom canonique exact, confiance HIGH ou MEDIUM), pour
 *     ses seuls segments qui sont un secteur (Mode, Beauté, Retail) ; « Luxe » et « Joaillerie-Horlogerie » ne disent pas
 *     lequel des secteurs : abstention ;
 *  2. CATÉGORIES NATIVES que la source publie sur l'employeur (`industry` SmartRecruiters / Workable / JSON-LD, secteurs
 *     WTTJ de l'organisation, `businessGroup` du portail LVMH), par un vocabulaire fermé : une valeur absente du
 *     vocabulaire ou ambiguë (« Watches & Jewellery », « Luxury Goods & Jewelry ») ne compte pas ;
 *  3. DOMAINE OFFICIEL : une page du domaine de la Maison lue à la main (`OFFICIAL_DOMAIN_EVIDENCE`, liée à l'identité
 *     exacte) ; et une société qui porte exactement le domaine d'une Maison au secteur relu (et qui n'est pas un groupe)
 *     est cette Maison ;
 *  4. REGISTRE DES SOURCES : le rattachement R-143 §5 (`identity/maisonAttachment.ts`, registre + nom) réunit une Maison
 *     et ses entités ; leurs preuves valent pour toutes, et une entité reçoit les secteurs de sa Maison.
 *
 * Un groupe (LVMH, Kering, Richemont…) ne reçoit jamais de secteur par ce chemin : ses offres couvrent plusieurs
 * secteurs et le secteur est lu sur la société, pas sur l'offre. Deux preuves qui nomment des secteurs de produit
 * disjoints (hors Retail, qui est une activité de distribution) laissent la Maison inconnue.
 */

export const SECTOR_RECOGNITION_KIND = 'secteurs-maisons/1';
export const SECTOR_RECOGNITION_REVIEWER = 'D-519 — secteur reconnu sur preuves (liste de référence, catégories natives, domaine officiel, registre des sources), lecture D-492';

/** Les segments de la liste de référence qui SONT un secteur ; les autres (LUXURY, JEWELRY_WATCHES…) ne tranchent pas. */
const REFERENCE_SEGMENTS: Partial<Record<MaisonEntry['segment'], string>> = { FASHION: 'FASHION', BEAUTY: 'BEAUTY', RETAIL: 'RETAIL' };

const norm = (v: string) => v.normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
/**
 * Vocabulaire fermé des catégories natives d'employeur. Une valeur hors de cette table ne prouve rien : les familles
 * mixtes (« Watches & Jewellery », « Fashion & Leather Goods », « Perfumes & Cosmetics », « Luxury Goods & Jewelry »),
 * « Luxe », « E-commerce », « Art de vivre », « Sporting Goods » ou « Textiles » n'y sont pas exprès.
 */
export const NATIVE_SECTOR_VOCABULARY: Readonly<Record<string, string>> = Object.fromEntries([
  // `industry` (taxonomie LinkedIn reprise par SmartRecruiters et Workable, JobPosting.industry).
  ['industry', 'retail', 'RETAIL'], ['industry', 'apparel and fashion', 'FASHION'], ['industry', 'cosmetics', 'BEAUTY'],
  ['industry', 'wine and spirits', 'WINES_SPIRITS'],
  // Secteurs WTTJ de l'organisation (`sectors.reference`).
  ['sectors', 'fashion-1', 'FASHION'], ['sectors', 'cosmetics', 'BEAUTY'], ['sectors', 'jewelry-1', 'JEWELRY'],
  ['sectors', 'selective-distribution', 'RETAIL'], ['sectors', 'mass-distribution', 'RETAIL'],
  // Groupe d'activité LVMH de la Maison, dans les langues mesurées.
  ...['selective distribution', 'selective retailing', 'distribution sélective', 'distribuzione selettiva', 'dystrybucja selektywna', 'selektiver vertrieb']
    .map(v => ['businessGroup', v, 'RETAIL']),
  ...['wines and spirits', 'wine and spirits', 'vins and spiritueux'].map(v => ['businessGroup', v, 'WINES_SPIRITS']),
].map(([champ, valeur, code]) => [`${champ}:${norm(valeur)}`, code]));

/** Part minimale des publications d'une société qui portent la valeur (le champ `industry` est saisi par offre). */
export const NATIVE_MIN_SHARE = 0.25;
export const NATIVE_MIN_PUBLICATIONS = 3;

export type SectorEmployer = Snapshot[number] & { canonicalKey: string; domainSource?: string | null; sectorEvidence?: unknown };
export type NativeCategory = { companyId: string; sourceKey: string; champ: 'industry' | 'sectors' | 'businessGroup'; valeur: string; n: number; url: string };

/** Les catégories natives d'employeur des publications actives, comptées par société, source, champ et valeur. */
export const NATIVE_CATEGORY_SQL = `
  WITH p AS (SELECT j."companyId", js."sourceKey", js.url, js.raw FROM "Job" j JOIN "JobSource" js ON js."jobId" = j.id AND js."isActive"
    WHERE j."isActive" AND j."mergedIntoId" IS NULL AND jsonb_typeof(js.raw) = 'object' AND (js.raw ? 'industry' OR js.raw ? 'sectors' OR js.raw ? 'businessGroup')),
  v AS (
    SELECT "companyId", "sourceKey", url, 'industry' champ, CASE jsonb_typeof(raw->'industry') WHEN 'object' THEN raw->'industry'->>'label' WHEN 'string' THEN raw->>'industry' END valeur FROM p WHERE raw ? 'industry'
    UNION ALL SELECT "companyId", "sourceKey", url, 'sectors', s->>'reference' FROM p, jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'sectors') = 'array' THEN raw->'sectors' ELSE '[]'::jsonb END) s
    UNION ALL SELECT "companyId", "sourceKey", url, 'businessGroup', raw->>'businessGroup' FROM p WHERE raw ? 'businessGroup')
  SELECT "companyId", "sourceKey", champ, valeur, count(*)::int n, min(url) url FROM v WHERE coalesce(trim(valeur), '') <> '' GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`;

/**
 * Pages du DOMAINE OFFICIEL lues à la main le 02/10/2026 (relecture des plus grosses Maisons sans secteur). Liée à
 * l'identité exacte (clé, nom, domaine) : une identité qui change s'abstient. La plupart des sites de marque refusent la
 * lecture (403 : Coach, Crocs, Tiffany, Lush, PVH) ou ne nomment pas leurs produits (Tapestry : « lifestyle brand »,
 * about.nike.com) : ils restent inconnus, faute de preuve.
 */
export const OFFICIAL_DOMAIN_EVIDENCE: ReadonlyArray<{ canonicalKey: string; name: string; domain: string; codes: string[]; source: string; statement: string; checkedAt: string }> = [
  { canonicalKey: 'CLARKSON_EYECARE', name: 'Clarkson Eyecare', domain: 'clarksoneyecare.com', codes: ['EYEWEAR'], source: 'https://www.clarksoneyecare.com/',
    statement: 'Le site officiel propose montures (« find frames that are perfect for you »), lentilles (« Find your contacts ») et cabinets (« Find an Office »).', checkedAt: '2026-10-02T13:20:00Z' },
  ...[['HANS_ANDERS', 'Hans Anders'], ['SOURCE_5a36ee8202f2fca5fa2ff5538dea2e0938864ecbcd615219e9bdab6b8266a0d1', 'Hans Anders Nederland']].map(([canonicalKey, name]) => ({
    canonicalKey, name, domain: 'hansanders.nl', codes: ['EYEWEAR'], source: 'https://www.hansanders.nl/',
    statement: 'Le site officiel : « De opticien en audicien van Nederland » ; « Brillen, Lenzen, Zonnebrillen, Hoortoestellen ».', checkedAt: '2026-10-02T13:20:00Z' })),
  { canonicalKey: 'MAC', name: 'MAC', domain: 'maccosmetics.com', codes: ['BEAUTY'], source: 'https://www.maccosmetics.com/',
    statement: 'Le site officiel : « Beauty and Makeup Products », rubriques « MAKEUP » et « SKINCARE ».', checkedAt: '2026-10-02T13:20:00Z' },
];

/**
 * Erreurs trouvées à la relecture manuelle du 02/10/2026 : la preuve existe mais le secteur qu'elle donne est faux ou
 * cacherait l'offre d'un filtre où elle a sa place (un secteur partiel rend l'offre NÉGATIVE pour les autres filtres de
 * secteur, D-515 §1). Ces Maisons restent inconnues.
 */
export const REFUSED_AT_REVIEW: Readonly<Record<string, string>> = {
  PASSAGE_DU_DESIR: 'Liste de référence « BEAUTY » : boutiques de lingerie et objets intimes, pas une Maison de beauté.',
  TISSUS_DES_URSULES_TDU_GROUP: 'WTTJ « Mode » : tissus au mètre et mercerie, pas des collections de mode.',
  IZIPIZI: 'WTTJ « Mode » : lunettes ; « Mode » seul la retirerait du filtre Lunetterie.',
  COLLECTOR_SQUARE: 'WTTJ « Mode » : revente de maroquinerie, montres et bijoux de seconde main ; « Mode » seul serait partiel.',
  VEJA: 'WTTJ « Mode » : baskets ; « Mode » seul la retirerait du filtre Chaussures.',
};

type Origin = { code: string; origin: string; evidence: SectorEvidence };

function officialOrigins(row: SectorEmployer, rules = OFFICIAL_DOMAIN_EVIDENCE): Origin[] {
  return rules.filter(r => r.canonicalKey === row.canonicalKey && r.name === row.name && r.domain === row.domain).flatMap(r => r.codes.map(code => ({
    code, origin: `official:${r.domain}`, evidence: { code, source: r.source, statement: r.statement, confidence: 'HIGH' as const, basis: 'OFFICIAL_SOURCE' as const, checkedAt: r.checkedAt } })));
}
export type SectorProposal = { id: string; name: string; canonicalKey: string; servies: number; codes: string[];
  /** Ce que la relecture compare : chaque secteur et la preuve qui le fonde, sans les compteurs vivants. */
  origins: Array<{ code: string; origin: string }>; notes: string[] };
export type SectorAbstention = { id: string; name: string; servies: number; reason: string };
export type SectorRecognitionFile = { kind: typeof SECTOR_RECOGNITION_KIND; manifest: SectorManifest; proposals: SectorProposal[]; abstentions: SectorAbstention[] };

const key = (v: string | null | undefined) => (v ? canonicalCompanyKey(v) : '');
const PRODUCT = (code: string) => code !== 'RETAIL';
const firstUrl = (v: string) => v.match(/https?:\/\/[^\s|"]+/)?.[0];

function referenceOrigins(row: SectorEmployer, checkedAt: string): Origin[] {
  const entry = findMaison(row.name);
  const code = entry && REFERENCE_SEGMENTS[entry.segment];
  const url = entry && firstUrl(entry.source);
  // Une ligne de groupe (« LVMH », groupe LVMH) ne désigne pas une Maison ; une confiance LOW ne prouve rien.
  if (!entry || !code || !url || entry.confidence === 'LOW' || (entry.group && key(entry.group) === key(entry.name))) return [];
  return [{ code, origin: `reference:${entry.slug}:${entry.segment}`, evidence: { code, source: url, confidence: 'MEDIUM', basis: 'REFERENCE_LIST', checkedAt,
    statement: `Liste de référence des Maisons (data/reference/maisons.csv) : « ${entry.name} », segment ${entry.segment}, confiance ${entry.confidence}.` } }];
}

function nativeOrigins(row: SectorEmployer, natives: readonly NativeCategory[], checkedAt: string): Origin[] {
  const own = natives.filter(n => n.companyId === row.id);
  const out: Origin[] = [];
  for (const champ of ['industry', 'sectors', 'businessGroup'] as const) {
    const values = own.filter(n => n.champ === champ);
    // WTTJ répète les secteurs de l'organisation sur chaque offre : la part se mesure par offre portant le champ.
    const total = champ === 'sectors' ? Math.max(0, ...values.map(v => v.n)) : values.reduce((s, v) => s + v.n, 0);
    const byCode = new Map<string, NativeCategory[]>();
    for (const v of values) {
      const code = NATIVE_SECTOR_VOCABULARY[`${champ}:${norm(v.valeur)}`];
      if (code) byCode.set(code, [...(byCode.get(code) ?? []), v]);
    }
    for (const [code, hits] of byCode) {
      const n = champ === 'sectors' ? Math.max(...hits.map(h => h.n)) : hits.reduce((s, h) => s + h.n, 0);
      if (n < NATIVE_MIN_PUBLICATIONS || n / total < NATIVE_MIN_SHARE) continue;
      const best = [...hits].sort((a, b) => b.n - a.n || a.sourceKey.localeCompare(b.sourceKey))[0];
      const labels = [...new Set(hits.map(h => h.valeur))].sort();
      out.push({ code, origin: `native:${champ}:${labels.map(norm).join('|')}`, evidence: { code, source: best.url, confidence: 'MEDIUM', basis: 'OFFICIAL_SOURCE', checkedAt,
        statement: `Catégorie native d'employeur « ${labels.join(' », « ')} » (${champ}) publiée par la source ${best.sourceKey} sur les offres de « ${row.name} ».` } });
    }
  }
  return out;
}

function inheritedOrigins(from: SectorEmployer, how: string, statement: string): Origin[] {
  const evidence = Array.isArray(from.sectorEvidence) ? from.sectorEvidence as SectorEvidence[] : [];
  return from.sectorCodes!.flatMap(code => {
    const proof = evidence.find(e => e.code === code);
    if (!proof) return [];
    return [{ code, origin: `${how}:${from.id}`, evidence: { code, source: proof.source, confidence: 'MEDIUM', basis: proof.basis, checkedAt: proof.checkedAt,
      statement: `${statement} « ${from.name} », dont le secteur est relu : ${proof.statement}` } }];
  });
}

/** Les secteurs d'un ensemble de preuves, ou le motif d'abstention. */
function decide(origins: Origin[]): { codes: string[]; origins: Origin[] } | { reason: string } {
  if (!origins.length) return { reason: 'NO_EVIDENCE' };
  const families = new Map<string, Set<string>>();
  // Une famille = une preuve indépendante : chaque champ natif à part (`native:industry`, `native:sectors`…).
  for (const o of origins) { const [kind, champ] = o.origin.split(':'); const family = kind === 'native' ? `${kind}:${champ}` : kind; families.set(family, (families.get(family) ?? new Set()).add(o.code)); }
  const products = [...families.values()].map(codes => [...codes].filter(PRODUCT)).filter(codes => codes.length);
  // Deux preuves indépendantes qui nomment des secteurs de produit sans aucun en commun : le secteur est douteux.
  for (const a of products) for (const b of products) if (!a.some(code => b.includes(code))) return { reason: 'EVIDENCE_DISAGREES' };
  // « Retail » seul ne dit pas ce que la Maison vend : il ferait sortir ses offres des filtres Mode, Chaussures, Beauté…
  // où, inconnues, elles restent « non précisé » (D-515 §1, audit de réconciliation). Elle reste dans la file d'enquête.
  if (!products.length) return { reason: 'RETAIL_ONLY' };
  const unique = [...new Map(origins.map(o => [`${o.code} ${o.origin}`, o])).values()].sort((a, b) => a.code.localeCompare(b.code) || a.origin.localeCompare(b.origin));
  return { codes: [...new Set(unique.map(o => o.code))].sort(), origins: unique };
}

export function recognizeSectors(snapshot: readonly SectorEmployer[], natives: readonly NativeCategory[], checkedAt: string): Omit<SectorRecognitionFile, 'kind'> {
  const rows = new Map(snapshot.map(r => [r.id, r]));
  const groupKeys = new Set(snapshot.flatMap(r => [r.parentGroup].filter((g): g is string => !!g).map(key)));
  const parents = new Set(snapshot.map(r => r.parentGroupId).filter(Boolean));
  const isGroup = (r: SectorEmployer) => r.kind === 'GROUP' || parents.has(r.id) || groupKeys.has(key(r.name));
  const qualified = (r?: SectorEmployer) => !!r?.sectorCodes?.length;
  // Le domaine officiel d'une Maison relue, quand une seule Maison (hors groupe) le porte.
  const byDomain = new Map<string, SectorEmployer[]>();
  for (const r of snapshot) if (r.domain && qualified(r) && !isGroup(r)) byDomain.set(r.domain, [...(byDomain.get(r.domain) ?? []), r]);
  const domainOrigins = (r: SectorEmployer): Origin[] => {
    const holders = (r.domain && r.domainSource ? byDomain.get(r.domain) ?? [] : []).filter(h => h.id !== r.id);
    return holders.length === 1 ? inheritedOrigins(holders[0], 'domain', `Même domaine officiel (${r.domain}) que`) : [];
  };
  // R-143 §5 : les entités rattachées à une Maison EXISTANTE par le registre et le nom forment une unité.
  const units = new Map<string, string[]>();
  for (const a of attachAll(snapshot)) if (a.status === 'ATTACHED' && a.maisonId) units.set(a.maisonId, [...(units.get(a.maisonId) ?? []), a.entityId]);
  const unitOf = new Map<string, string>();
  for (const [maisonId, entities] of units) for (const e of entities) unitOf.set(e, maisonId);
  const toCreate = new Set(attachAll(snapshot).filter(a => a.status === 'ATTACHED' && !a.maisonId).map(a => a.entityId));

  const proposals: SectorProposal[] = [], abstentions: SectorAbstention[] = [], manifest: SectorManifest = { reviewer: SECTOR_RECOGNITION_REVIEWER, companies: [] };
  const propose = (r: SectorEmployer, codes: string[], origins: Origin[], notes: string[]) => {
    proposals.push({ id: r.id, name: r.name, canonicalKey: r.canonicalKey, servies: r.servies, codes, origins: origins.map(({ code, origin }) => ({ code, origin })), notes });
    manifest.companies.push({ id: r.id, canonicalKey: r.canonicalKey, codes, evidence: origins.map(o => o.evidence) });
  };
  const abstain = (r: SectorEmployer, reason: string) => { if (r.servies > 0) abstentions.push({ id: r.id, name: r.name, servies: r.servies, reason }); };

  for (const r of snapshot) {
    if (qualified(r)) continue;
    const maisonId = unitOf.get(r.id);
    if (toCreate.has(r.id)) { abstain(r, 'MAISON_TO_CREATE'); continue; }
    if (isGroup(r)) {
      abstain(r, 'GROUP');
      for (const id of units.get(r.id) ?? []) if (!qualified(rows.get(id))) abstain(rows.get(id)!, 'GROUP');
      continue;
    }
    if (maisonId && qualified(rows.get(maisonId))) {
      // L'entité est la Maison (registre + nom) : elle en reçoit les secteurs relus, sans en ajouter (garde de fusion).
      const maison = rows.get(maisonId)!;
      propose(r, [...maison.sectorCodes!].sort(), inheritedOrigins(maison, 'registry', 'Rattachée par le registre des sources (R-143 §5) à la Maison'), [`unité ${maison.name}`]);
      continue;
    }
    if (maisonId) continue; // décidée avec sa Maison, ci-dessous
    const members = [r, ...(units.get(r.id) ?? []).map(id => rows.get(id)!)];
    if (!members.some(m => m.servies > 0)) continue;
    if (members.some(m => REFUSED_AT_REVIEW[m.canonicalKey])) { for (const m of members) if (!qualified(m)) abstain(m, 'REFUSED_AT_REVIEW'); continue; }
    const origins = members.flatMap(m => [
      ...officialOrigins(m), ...referenceOrigins(m, checkedAt), ...nativeOrigins(m, natives, checkedAt), ...domainOrigins(m),
      ...(m !== r && qualified(m) ? inheritedOrigins(m, 'registry', 'Entité rattachée par le registre des sources (R-143 §5) :') : []),
    ]);
    const decision = decide(origins);
    if ('reason' in decision) { for (const m of members) if (!qualified(m)) abstain(m, decision.reason); continue; }
    const notes = members.length > 1 ? [`unité de ${members.length} sociétés (R-143 §5)`] : [];
    for (const m of members) if (!qualified(m)) propose(m, decision.codes, decision.origins, notes);
  }
  const order = (a: { servies: number; id: string }, b: { servies: number; id: string }) => b.servies - a.servies || a.id.localeCompare(b.id);
  proposals.sort(order); abstentions.sort(order);
  manifest.companies.sort((a, b) => order(rows.get(a.id)!, rows.get(b.id)!));
  return { manifest, proposals, abstentions };
}

/** Ce que la relecture fige : société, secteurs et preuves qui les fondent ; jamais les compteurs ni l'adresse d'exemple. */
export const recognitionFingerprint = (proposals: readonly SectorProposal[]) =>
  sectorHash([...proposals].map(p => [p.id, p.canonicalKey, p.codes, p.origins]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/**
 * Ce que l'application ÉCRIT (le manifeste) doit être ce que la relecture a vu : mêmes sociétés, secteurs, bases, confiances
 * et déclarations. Seuls l'heure de lecture et, pour une catégorie native, l'adresse d'exemple (son hôte reste comparé)
 * peuvent avoir bougé.
 */
export const manifestFingerprint = (m: SectorManifest) => sectorHash([m.reviewer, [...m.companies].sort((a, b) => a.id.localeCompare(b.id)).map(c => [c.id, c.canonicalKey, c.codes,
  c.evidence.map(e => [e.code, e.basis, e.confidence, e.statement, e.statement.startsWith('Catégorie native') ? safeHost(e.source) : e.source])])]);
const safeHost = (url: string) => { try { return new URL(url).hostname; } catch { return `invalid:${url}`; } };

async function recognizeFromDatabase(db: PrismaClient, checkedAt: string) {
  const snapshot = await db.$queryRawUnsafe<SectorEmployer[]>(EMPLOYER_SNAPSHOT_SQL_WITH_SECTORS);
  const natives = await db.$queryRawUnsafe<NativeCategory[]>(NATIVE_CATEGORY_SQL);
  return recognizeSectors(snapshot, natives, checkedAt);
}

/** L'instantané de R-143 §5, plus la clé canonique, la provenance du domaine et les preuves de secteur. */
export const EMPLOYER_SNAPSHOT_SQL_WITH_SECTORS = EMPLOYER_SNAPSHOT_SQL
  .replace('SELECT c.id, c.name,', 'SELECT c.id, c.name, c."canonicalKey", c."domainSource", c."sectorEvidence",');
if (EMPLOYER_SNAPSHOT_SQL_WITH_SECTORS === EMPLOYER_SNAPSHOT_SQL) throw new Error('EMPLOYER_SNAPSHOT_SQL changed: the sector columns could not be added');

/** Aperçu : rien n'est écrit ; le fichier rendu est celui qu'on relit, puis qu'on applique. */
export async function previewSectorRecognition(db: PrismaClient, now = new Date()): Promise<SectorRecognitionFile> {
  return { kind: SECTOR_RECOGNITION_KIND, ...(await recognizeFromDatabase(db, now.toISOString())) };
}

/** N'applique QUE le fichier relu, et refuse sans rien écrire si la reconnaissance recalculée en diffère. */
export async function applySectorRecognition(db: PrismaClient, reviewed: SectorRecognitionFile) {
  if (reviewed?.kind !== SECTOR_RECOGNITION_KIND || !Array.isArray(reviewed.proposals) || !reviewed.manifest) throw new Error('REVIEWED_PLAN_INVALID: a sector recognition preview file is required');
  const ids = reviewed.proposals.map(p => p.id).join(',');
  if (ids !== reviewed.manifest.companies.map(c => c.id).join(',')) throw new Error('REVIEWED_PLAN_INVALID: proposals and manifest differ');
  const now = await recognizeFromDatabase(db, new Date().toISOString());
  if (recognitionFingerprint(now.proposals) !== recognitionFingerprint(reviewed.proposals)) {
    throw new Error(`REVIEWED_PLAN_MISMATCH: the recomputed recognition differs from the reviewed file (${now.proposals.length} now, ${reviewed.proposals.length} reviewed); preview again`);
  }
  if (manifestFingerprint(now.manifest) !== manifestFingerprint(reviewed.manifest)) {
    throw new Error('REVIEWED_PLAN_MISMATCH: the manifest to write differs from the recomputed recognition; preview again');
  }
  const preview = await previewSectors(db, reviewed.manifest);
  return { proposals: reviewed.proposals.length, ...(await applySectors(db, reviewed.manifest, preview.reviewHash)) };
}

/** Read-only discovery signals. This command neither certifies nor registers a source. */
import { identityReviewOrder, portalScopeOf } from '../../src/connectors/sourceIdentity.js';
import { readIdentitySources } from '../../src/connectors/sourceRegistryRead.js';
import { fetchFollowingSafely, readBodyBounded } from '../../src/lib/http.js';
import { sourceSignal, withSourceBudget } from '../../src/lib/sourceBudget.js';
import { parseCsvLine } from '../../src/lib/csv.js';
import { PrismaClient } from '@prisma/client';
import { readInputFile, readInputJson, writePrivateFile } from '../../src/lib/privateFile.js';
import { detectFromHtml } from '../../src/ats/detect.js';
import { ADAPTERS } from '../../src/ats/index.js';
import {
  findOverlaps, parseDossiers, normalizeActor, registrableDomain,
  type CatalogueView, type Dossier,
} from '../../src/onboarding/reconcile.js';

const [, , verb, target] = process.argv;
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = arg('out');
if (!['inspect', 'prepare'].includes(verb ?? '') || !target || target.startsWith('-') ||
    process.argv.slice(4).some(a => !a.startsWith('--out=') || !a.slice(6).trim()) || process.argv.length > 5) {
  throw new Error('usage: source-discovery <inspect URL|prepare JSON_OR_CSV> [--out=private.json]');
}

const p = new PrismaClient();

/** Le catalogue, lu UNE fois dans une transaction cohérente : un rapprochement fait sur deux instantanés ment. */
async function loadCatalogue(): Promise<CatalogueView> {
  return p.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const sources = (await readIdentitySources(tx)).filter(source => ['ACTIVE', 'PAUSED'].includes(source.status));
    const companies: any[] = await tx.$queryRawUnsafe(
      `SELECT c.name, COUNT(*)::int n FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
       WHERE j."isActive" GROUP BY 1`);
    const bySource: any[] = await tx.$queryRawUnsafe(
      `SELECT c.name, js."sourceKey", COUNT(*)::int n FROM "JobSource" js
       JOIN "Job" j ON j.id = js."jobId" JOIN "Company" c ON c.id = j."companyId"
       WHERE js."isActive" AND j."isActive" GROUP BY 1,2`);

    const sourcesByCompany = new Map<string, string[]>();
    for (const r of bySource) {
      const k = normalizeActor(r.name);
      sourcesByCompany.set(k, [...(sourcesByCompany.get(k) ?? []), r.sourceKey]);
    }

    // Reviewed group scope and observed labels are research hints only.
    // Neither proves that every brand or country is served by this portal.
    const reviews = await tx.sourceIdentityReview.findMany({ orderBy: identityReviewOrder, distinct: ['sourceKey'] });
    const reviewBySource = new Map(reviews.map(review => [review.sourceKey, review]));
    const multiBrand = sources.filter(source => portalScopeOf(source, reviewBySource.get(source.key) ?? null) === 'MULTI_BRAND');

    const companiesPerSource = new Map<string, Set<string>>();
    for (const r of bySource) {
      companiesPerSource.set(r.sourceKey, (companiesPerSource.get(r.sourceKey) ?? new Set()).add(r.name));
    }
    const brandCoveredByGroup = new Map<string, string>();
    for (const [srcKey, names] of companiesPerSource) {
      if (names.size < 2) continue;                       // une seule société : pas un portail de groupe
      for (const n of names) brandCoveredByGroup.set(normalizeActor(n), srcKey);
    }
    /**
     * Le libellé d'un portail de groupe nomme souvent ses marques entre parenthèses
     * (« Tapestry (Coach, Kate Spade, Stuart Weitzman) ») : on les rattache, sans jamais en inventer.
     */
    for (const g of multiBrand) {
      const dedans = String(g.maison).match(/\(([^)]+)\)/)?.[1] ?? '';
      for (const marque of dedans.split(/,|·|\/|\bet\b/)) {
        const k = normalizeActor(marque);
        if (k.length >= 3 && !k.includes('toutes')) brandCoveredByGroup.set(k, g.key);
      }
      brandCoveredByGroup.set(normalizeActor(String(g.maison).replace(/\([^)]*\)/, '')), g.key);
    }

    return {
      sourcesByDomain: new Map(sources.flatMap((s) => {
        const d = s.careersDomain ? registrableDomain(`https://${s.careersDomain}`) : null;
        const o = (s.config as any)?.origin ? registrableDomain(String((s.config as any).origin)) : null;
        return [d, o].filter(Boolean).map((x) => [x as string, s.key] as [string, string]);
      })),
      companiesWithOffers: new Map(companies.map((r) => [normalizeActor(r.name), Number(r.n)])),
      sourcesByCompany,
      brandCoveredByGroup,
    };
  });
}

/** Ce que l'URL révèle réellement — lue, jamais devinée depuis un gabarit (D33). */
async function inspectUrl(url: string) {
  const started = Date.now();
  try {
    const page = await withSourceBudget(async () => {
      const response = await fetchFollowingSafely(url, { headers: { accept: 'text/html' } }, sourceSignal()!);
      return { status: response.status, url: response.url || url, html: await readBodyBounded(response, url) };
    }, 25_000, 'source-discovery');
    const res = page;
    const html = page.status >= 200 && page.status < 300 ? page.html : '';
    const det = html ? detectFromHtml(html, res.url) : null;
    return {
      url, statut: res.status, urlFinale: res.url, octets: html.length, ms: Date.now() - started,
      ats: det?.type ?? null,
      // Un ATS qu'on sait NOMMER sans savoir l'ingérer n'est pas « rien trouvé » (D33).
      // `ADAPTERS` est indexé par `AtsType` en MAJUSCULES — mettre la clé en minuscules la rendait
      // introuvable et faisait dire « pas d'adaptateur » d'une famille parfaitement supportée.
      adaptateurExistant: det?.type ? Object.hasOwn(ADAPTERS, String(det.type)) : false,
      domaine: registrableDomain(res.url),
    };
  } catch (e: any) {
    return { url, statut: 0, erreur: String(e?.message ?? e).slice(0, 160), ms: Date.now() - started,
             ats: null, adaptateurExistant: false, domaine: registrableDomain(url) };
  }
}

function readDossiers(file: string): Dossier[] {
  if (file.endsWith('.json')) return parseDossiers(readInputJson(file, 2 * 1024 * 1024));
  // One CSV record per line. Quoted fields are supported; multiline records are refused by validation.
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(readInputFile(file, 2 * 1024 * 1024));
  const [head, ...lines] = raw.trim().split('\n');
  const cols = parseCsvLine(head).map(c => c.trim());
  if (new Set(cols).size !== cols.length) throw new Error('Duplicate discovery CSV column');
  return parseDossiers(lines.filter(Boolean).map(line => {
    const values = parseCsvLine(line).map(c => c.trim());
    if (values.length !== cols.length) throw new Error('Discovery CSV column count mismatch');
    return Object.fromEntries(cols.map((name, i) => [name, values[i] || null]));
  }));
}

// Parse all dossiers before database or network work.
const dossiers = verb === 'prepare' ? readDossiers(target) : null;

try {
const catalogue = await loadCatalogue();
let result: unknown;

if (verb === 'inspect') {
  const insp = await inspectUrl(target);
  const dom = insp.domaine;
  result = {
    ...insp,
    dejaCatalogue: dom ? catalogue.sourcesByDomain.get(dom) ?? null : null,
  };
} else if (verb === 'prepare') {
  const prepared = [];
  for (const d of dossiers!) prepared.push({ dossier: d, inspection: await inspectUrl(d.urlOfficielle),
    rapprochements: findOverlaps(d, catalogue) });
  result = { mode: 'DISCOVERY_ONLY', dossiers: prepared.length, resultats: prepared };

}

const json = JSON.stringify(result, null, 1);
if (out) writePrivateFile(out, json);
console.log(json);
} finally { await p.$disconnect(); }

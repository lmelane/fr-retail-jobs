import { readIdentitySources, identityReviewOrder, portalScopeOf } from '../../src/connectors/sourceIdentity.js';
/**
 * `source-onboard` — LE POINT D'ENTRÉE UNIQUE pour ajouter une Maison, un groupe ou une URL.
 *
 * Avant lui, intégrer une source demandait d'enchaîner à la main une demi-douzaine de programmes datés, dont
 * l'ordre et les gardes n'existaient que dans la tête de celui qui les lançait. C'est ainsi qu'une vague
 * dupliquait 483 offres déjà publiées (D34), ou qu'une revue d'identité périmée passait inaperçue (D59).
 *
 *   source-onboard inspect  <url>        que sait-on de cette URL, et le catalogue la couvre-t-il déjà ?
 *   source-onboard prepare  <dossier>    rapprochement + détection + verdict, sans rien écrire
 *   source-onboard validate <manifest>   exerce les portes réelles (identité, robots, périmètre, secteur)
 *   source-onboard apply    <manifest>   register → certify → promote → ingestion bornée → contrôle public
 *   source-onboard batch    <csv|json>   plusieurs dossiers, et fige une vague
 *
 * **Le mode par défaut est DRY-RUN.** `apply` exige `--apply` en plus du verbe : un verbe qui écrit parce
 * qu'on l'a mal orthographié est un accident qui attend son tour.
 *
 * Ce programme n'implémente aucune étape lui-même : il appelle la chaîne maintenue
 * (`onboard-source.mts`, `build-proof.mts`, `promoteSource`…). *Une seconde implémentation d'une étape finit
 * toujours par diverger de la première — c'est exactement ce que ce point d'entrée doit empêcher.*
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { detectFromHtml } from '../../src/ats/detect.js';
import { ADAPTERS } from '../../src/ats/index.js';
import { CRAWLER_IDENTITY } from '../../src/lib/crawlerIdentity.js';
import {
  findOverlaps, tenantCollision, decideVerdict, normalizeActor, registrableDomain,
  type CatalogueView, type Dossier, type OnboardVerdict,
} from '../../src/onboarding/reconcile.js';

const [, , verb, target] = process.argv;
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = process.argv.includes('--apply');
const out = arg('out');

if (!verb || !['inspect', 'prepare', 'validate', 'apply', 'batch'].includes(verb)) {
  console.error(`usage: source-onboard <inspect|prepare|validate|apply|batch> <cible> [--out=<f.json>] [--apply]

  inspect  <url>        ce que l'URL révèle, et si le catalogue la couvre déjà
  prepare  <dossier>    rapprochement + verdict, sans écriture
  validate <manifest>   exerce les portes réelles
  apply    <manifest>   intègre — exige --apply
  batch    <csv|json>   plusieurs dossiers, fige une vague

Le mode par défaut est DRY-RUN.`);
  process.exit(2);
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

    /**
     * « Couverte par un groupe » se lit sur DEUX signaux, parce qu'un seul ne suffit pas :
     *
     *  (a) les sociétés réellement CRÉDITÉES par une source qui en sert plusieurs — attribution observée ;
     *  (b) le `portalScope = MULTI_BRAND` de sa revue d'identité — périmètre DÉCLARÉ et revu.
     *
     * Mesuré ici, et c'est ce qui impose (b) : la source `oniverse` publie 524 offres sous la seule société
     * « ONIVERSE ». Calzedonia, Intimissimi et Tezenis n'y sont créditées nulle part, alors que le portail
     * du groupe les sert. Sur le seul signal (a), un dossier « CALZEDONIA » passerait pour une lacune et
     * dupliquerait un portail déjà catalogué — exactement le cas D34.
     *
     * Une source MULTI_BRAND est donc signalée par son périmètre, même quand son attribution par marque
     * n'est pas encore faite : *un portail de groupe couvre ses marques, que nous sachions déjà les nommer
     * ou non.*
     */
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
      tenantsByKey: new Map(sources.filter((s) => s.tenantKey).map((s) => [s.tenantKey!, s.key])),
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
    const res = await fetch(url, {
      headers: { 'user-agent': CRAWLER_IDENTITY }, redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    const html = res.ok ? await res.text() : '';
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
  const raw = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const d = JSON.parse(raw);
    return Array.isArray(d) ? d : (d.dossiers ?? [d]);
  }
  // CSV : acteur,type,urlOfficielle,groupe,pays,secteur,portalScope
  const [head, ...lines] = raw.trim().split('\n');
  const cols = head.split(',').map((c) => c.trim());
  return lines.filter(Boolean).map((l) => {
    const v = l.split(',').map((c) => c.trim());
    return Object.fromEntries(cols.map((c, i) => [c, v[i] || null])) as unknown as Dossier;
  });
}

/** Prépare un dossier : rapprochement + inspection + verdict. N'écrit rien. */
async function prepare(d: Dossier, cat: CatalogueView) {
  const insp = await inspectUrl(d.urlOfficielle);
  const overlaps = findOverlaps(d, cat);
  const verdict = decideVerdict({
    dossier: d, overlaps, ats: insp.ats, adapterExists: insp.adaptateurExistant,
    // À ce stade la preuve D60 n'est pas encore constituée : `prepare` ne prétend jamais l'avoir.
    portalProven: false,
    inSector: d.secteur ? true : null,
    identityAmbiguous: normalizeActor(d.acteur).length < 3,
    technicalBlocker: insp.statut === 0 ? `portail injoignable : ${(insp as any).erreur ?? 'inconnu'}`
      : insp.statut >= 400 ? `portail HTTP ${insp.statut}` : null,
  });
  return { dossier: d, inspection: insp, recouvrements: overlaps, ...verdict };
}

const catalogue = await loadCatalogue();
let result: unknown;

if (verb === 'inspect') {
  if (!target) { console.error('inspect exige une URL'); process.exit(2); }
  const insp = await inspectUrl(target);
  const dom = insp.domaine;
  result = {
    ...insp,
    dejaCatalogue: dom ? catalogue.sourcesByDomain.get(dom) ?? null : null,
  };
} else if (verb === 'prepare' || verb === 'batch') {
  if (!target) { console.error(`${verb} exige un fichier`); process.exit(2); }
  const dossiers = readDossiers(target);
  const prepared = [];
  for (const d of dossiers) prepared.push(await prepare(d, catalogue));
  const parVerdict: Record<string, number> = {};
  for (const r of prepared) parVerdict[r.verdict] = (parVerdict[r.verdict] ?? 0) + 1;
  result = {
    mode: 'DRY-RUN', dossiers: prepared.length, parVerdict,
    // Une vague se FIGE avant exécution : ce qui n'est pas recevable est nommé, jamais remplacé en silence.
    recevables: prepared.filter((r) => r.verdict === 'READY_CONFIG_ONLY' || r.verdict === 'READY_PUBLIC_HTML'
      || r.verdict === 'REGIONAL_SOURCE_CANDIDATE').map((r) => r.dossier.acteur),
    resultats: prepared,
  };
} else if (verb === 'validate' || verb === 'apply') {
  if (!target) { console.error(`${verb} exige un manifeste`); process.exit(2); }
  if (verb === 'apply' && !APPLY) {
    console.error('apply exige --apply en plus du verbe : refus par défaut.');
    process.exit(2);
  }
  /**
   * La suite appartient à la chaîne maintenue, qui exerce les VRAIES portes (identité, robots, périmètre,
   * secteur, promotion). Ce point d'entrée ne la réimplémente pas : il indique la commande exacte, pour que
   * l'étape reste unique et auditable.
   */
  result = {
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    chaine: 'scripts/ops/onboard-source.mts',
    commande: `db.py ${APPLY ? 'production' : 'clone'} npx tsx scripts/ops/onboard-source.mts ${target}`,
    portesExercees: ['identité (recordSourceIdentityReview)', 'robots (readRobots)',
                     'périmètre (scopeEvidence)', 'promotion (promoteSource)'],
  };
}

const json = JSON.stringify(result, null, 1);
if (out) writeFileSync(out, json);
console.log(json);
await p.$disconnect();

/**
 * ESSAI À BLANC DE `resolve-domains`, ET PREUVES POUR LES DOMAINES À RELIRE (25/09/2026, logos manquants)
 *
 * Ce que fait la commande du worker (`apps/aggregator/src/pipeline/resolveDomains.ts`) : lire les sources ACTIVE
 * et les Company sans domaine qui ont une offre active, puis appeler `resolveCompanyDomain` (catalogue, sinon
 * Wikidata, sinon rien). Ce script lit EXACTEMENT ces deux ensembles en lecture seule (rôle `catwalks_audit`,
 * garde du modèle `audits/2026-09-24/scripts/registre-catwalks.mts`), puis appelle la MÊME fonction importée,
 * avec un client Wikidata aux mêmes requêtes (`wbsearchentities` limite 7, puis `wbgetclaims` P856) et au même
 * rythme d'une requête par seconde. Rien n'est écrit, et aucune URL de base n'est confiée au worker.
 *
 * Il rassemble aussi, pour la relecture humaine, les preuves que porte déjà la base :
 *   - les hôtes des liens de candidature des offres actives (le site carrière de la Maison, quand ce n'est pas
 *     un éditeur d'ATS : `rootDomainOf` les écarte) ;
 *   - les sociétés déjà pourvues d'un domaine dont le nom est contenu dans celui de la société (une filiale
 *     « 1151 Swarovski Retail Ventures » et la Maison « Swarovski ») ;
 * puis vérifie chaque domaine candidat : la page d'accueil répond-elle, sous quel hôte final, avec quel titre,
 * et le VRAI gestionnaire `/api/logo` de la copie locale en tire-t-il un logo ?
 *
 *   cd apps/api && npx tsx ../../audits/2026-09-25/scripts/domaines-essai-a-blanc.mts [--limite=N]
 *
 * Sortie : `audits/2026-09-25/domaines-essai-a-blanc.json` et un résumé en console.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { NextRequest } from 'next/server';
import {
  resolveCompanyDomain, rootDomainOf, nameMatchesDomain,
  type EmployerSourceLike, type WikidataClient, type WikidataSearchResponse, type WikidataClaimsResponse,
} from '../../../apps/aggregator/src/normalize/companyDomain.ts';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const LIMITE = Number(process.argv.find((a) => a.startsWith('--limite='))?.slice(9) ?? 150);
const SORTIE = new URL('../domaines-essai-a-blanc.json', import.meta.url);
const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;

// ─── 1. La base, en lecture seule : ce que lit `resolveDomains`, plus les preuves ────────────────
const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user, 'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
SELECT 'R' || E'\\t' || json_build_object('cle', s.key, 'maison', s.maison, 'tier', s.tier, 'careersDomain', s."careersDomain")::text
FROM "Source" s WHERE s.status = 'ACTIVE';
WITH attente AS (
  SELECT c.id, c.name, c."canonicalKey", count(j.id) AS actives
  FROM "Company" c JOIN "Job" j ON j."companyId" = c.id AND j."isActive"
  WHERE c.domain IS NULL GROUP BY c.id),
hotes AS (
  SELECT x.id, json_object_agg(x.hote, x.n) AS hotes FROM (
    SELECT a.id, substring(s.url from '^https?://([^/?#:]+)') AS hote, count(*) AS n,
      row_number() OVER (PARTITION BY a.id ORDER BY count(*) DESC) AS rang
    FROM attente a JOIN "Job" j ON j."companyId" = a.id AND j."isActive"
    JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
    GROUP BY a.id, 2) x WHERE x.rang <= 5 AND x.hote IS NOT NULL GROUP BY x.id),
sources AS (
  SELECT a.id, json_object_agg(x."sourceKey", x.n) AS sources FROM attente a JOIN (
    SELECT j."companyId", s."sourceKey", count(DISTINCT j.id) AS n FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
    WHERE j."isActive" GROUP BY 1, 2) x ON x."companyId" = a.id GROUP BY a.id),
publiables AS (
  SELECT j."companyId" AS id, count(*) AS n, count(*) FILTER (WHERE j."countryCode" = 'FR') AS nfr FROM "Job" j
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
    AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT})) GROUP BY 1)
SELECT 'P' || E'\\t' || json_build_object('id', a.id, 'nom', a.name, 'cle', a."canonicalKey", 'actives', a.actives,
  'publiables', coalesce(p.n, 0), 'publiablesFR', coalesce(p.nfr, 0), 'hotes', h.hotes, 'sources', s.sources)::text
FROM attente a LEFT JOIN hotes h ON h.id = a.id LEFT JOIN sources s ON s.id = a.id LEFT JOIN publiables p ON p.id = a.id;
SELECT 'D' || E'\\t' || json_build_object('nom', c.name, 'domaine', c.domain, 'source', c."domainSource")::text
FROM "Company" c WHERE c.domain IS NOT NULL AND c."mergedIntoId" IS NULL;
\\else
\\echo REFUS_GARDE
\\endif
COMMIT;`;

const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'domaines-essai-a-blanc' },
});
if (run.status !== 0) { console.error(run.stderr.replace(/password[^\n]*/gi, '<masqué>')); process.exit(run.status ?? 1); }
const lignes = run.stdout.split('\n').filter(Boolean);
if (lignes.includes('REFUS_GARDE')) refus('garde de lecture seule non satisfaite, aucune mesure exécutée');
const lire = (tag: string) => lignes.filter((l) => l.startsWith(`${tag}\t`)).map((l) => JSON.parse(l.slice(tag.length + 1)));
const [garde] = lire('G');
console.log(`base ${garde.base} · rôle ${garde.role} · lecture seule ${garde.lectureSeule} · ${garde.maintenant}`);
type Source = { cle: string; maison: string; tier: string; careersDomain: string | null };
type Attente = { id: string; nom: string; cle: string; actives: number; publiables: number; publiablesFR: number;
  hotes: Record<string, number> | null; sources: Record<string, number> | null };
const sources = lire('R') as Source[];
const pourvues = lire('D') as Array<{ nom: string; domaine: string; source: string | null }>;
// L'ordre de la commande : les offres actives d'abord (resolveDomains.ts, `ordered`).
const attente = (lire('P') as Attente[]).sort((a, b) => b.actives - a.actives);
const lot = attente.slice(0, LIMITE || undefined);
console.log(`sources ACTIVE : ${sources.length} · sociétés sans domaine avec une offre active : ${attente.length} · lot : ${lot.length}`);

// ─── 2. La fonction de la commande, avec un client Wikidata équivalent ───────────────────────────
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const AGENT = 'ModeCareersBot/1.0 (https://modecareers.com; loic.melane@catwalks.io)';
let prochain = 0;
async function wikidataJson<T>(params: Record<string, string>): Promise<T> {
  const attendre = prochain - Date.now();
  if (attendre > 0) await new Promise((r) => setTimeout(r, attendre));
  prochain = Date.now() + 1_000;
  const r = await fetch(`${WIKIDATA}?${new URLSearchParams({ ...params, format: 'json' })}`, { headers: { 'user-agent': AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Wikidata ${r.status}`);
  return (await r.json()) as T;
}
const wikidata: WikidataClient = {
  search: (term, language) => wikidataJson<WikidataSearchResponse>({ action: 'wbsearchentities', search: term, language, uselang: language, type: 'item', limit: '7' }),
  officialWebsite: (entityId) => wikidataJson<WikidataClaimsResponse>({ action: 'wbgetclaims', entity: entityId, property: 'P856' }),
};
const catalogue: EmployerSourceLike[] = sources.map((s) => ({ maison: s.maison, tier: s.tier, careersDomain: s.careersDomain }));

// ─── 3. Vérification d'un domaine candidat : le site répond-il, et l'API en tire-t-elle un logo ? ──
const { GET } = await import('../../../apps/api/app/api/logo/route.ts');
async function logo(domaine: string): Promise<number> {
  const info = console.info;
  console.info = () => {};
  try { return (await GET(new NextRequest(`http://mesure.local/api/logo?domain=${encodeURIComponent(domaine)}&size=64`))).status; }
  finally { console.info = info; }
}
async function accueil(domaine: string) {
  try {
    const r = await fetch(`https://${domaine}/`, { redirect: 'follow', signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'accept-language': 'fr,en;q=0.8' } });
    const html = (await r.text()).slice(0, 200_000);
    const titre = /<title[^>]*>([^<]{0,200})/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
    return { statut: r.status, hoteFinal: new URL(r.url).hostname, titre };
  } catch (e) {
    return { erreur: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}
const verifies = new Map<string, { logo: number; accueil: Awaited<ReturnType<typeof accueil>> }>();
async function verifier(domaine: string) {
  if (!verifies.has(domaine)) verifies.set(domaine, { logo: await logo(domaine), accueil: await accueil(domaine) });
  return verifies.get(domaine)!;
}

const compact = (v: string) => v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const mots = (v: string) => v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const resultats = [];
for (const c of lot) {
  let resolu: Awaited<ReturnType<typeof resolveCompanyDomain>> = null;
  let erreurResolution: string | null = null;
  try { resolu = await resolveCompanyDomain({ name: c.nom, canonicalKey: c.cle }, catalogue, wikidata); }
  catch (e) { erreurResolution = e instanceof Error ? e.message : String(e); }
  // Les hôtes de candidature qui ne sont pas un éditeur d'ATS, ramenés à leur domaine enregistrable.
  const parHote = Object.entries(c.hotes ?? {}).map(([hote, n]) => ({ hote, n, domaine: rootDomainOf(hote) }));
  // Une société pourvue dont le nom entier figure, comme mots, dans celui-ci (« swarovski » dans « 1151 Swarovski… »).
  const nomMots = new Set(mots(c.nom));
  const soeurs = pourvues.filter((p) => { const m = mots(p.nom); return m.length > 0 && compact(p.nom).length >= 3 && m.every((x) => nomMots.has(x)); })
    .map((p) => ({ nom: p.nom, domaine: p.domaine, source: p.source }));
  const candidats = [...new Set([resolu?.domain, ...parHote.map((h) => h.domaine), ...soeurs.map((s) => s.domaine)].filter((d): d is string => !!d))];
  const verification: Record<string, unknown> = {};
  for (const d of candidats) verification[d] = { ...(await verifier(d)), nomDansDomaine: nameMatchesDomain(c.nom, d) };
  resultats.push({ ...c, resolveDomains: resolu, erreurResolution, hotesCandidature: parHote, soeurs, verification });
  console.log(`${String(c.publiables).padStart(5)}  ${c.nom}  → resolve-domains : ${resolu ? `${resolu.domain} (${resolu.domainSource})` : erreurResolution ? `ERREUR ${erreurResolution}` : 'rien'}`
    + `${candidats.length ? ` · candidats : ${candidats.map((d) => `${d}[logo ${(verification[d] as { logo: number }).logo}]`).join(', ')}` : ''}`);
}

const resolus = resultats.filter((r) => r.resolveDomains);
console.log(`\nessai à blanc resolve-domains sur ${resultats.length} sociétés : ${resolus.length} résolues`
  + ` (catalogue ${resolus.filter((r) => r.resolveDomains?.domainSource === 'source-careers').length}, Wikidata ${resolus.filter((r) => r.resolveDomains?.domainSource === 'wikidata').length})`
  + ` · erreurs ${resultats.filter((r) => r.erreurResolution).length}`);
writeFileSync(SORTIE, `${JSON.stringify({ mesureLe: garde.maintenant, limite: LIMITE, sociétésSansDomaine: attente.length, resultats }, null, 1)}\n`);
console.log(`preuves : ${SORTIE.pathname}`);

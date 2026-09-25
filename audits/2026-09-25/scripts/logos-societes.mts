/**
 * LOGOS DES MAISONS : QUI S'AFFICHE SANS LOGO, ET POURQUOI ? (25/09/2026, retour CEO : Lovisa, Courir)
 *
 * La chaîne mesurée, maillon par maillon :
 *   1. la base : `Company.domain` de chaque société portant au moins une offre publiable dans un marché
 *      (mêmes prédicats que `publicJobWhere` et que les 41 marchés de `@catwalks/db/marches`) ;
 *   2. le VRAI gestionnaire de l'API (`apps/api/app/api/logo/route.ts`, importé et exécuté ici, pas
 *      réimplémenté), avec l'enregistrement de chaque réponse de fournisseur (DuckDuckGo, Google) qu'il
 *      reçoit : statut, octets, format, dimensions lues par `imageSize` ;
 *   3. la chaîne RÉELLE : le proxy du site de test (Vercel) → l'API de production (Railway), une fois
 *      tel que le visiteur le reçoit (cache CDN compris) et une fois sans cache CDN (paramètre inerte
 *      `mesure=`, que le proxy ignore mais qui change la clé de cache).
 *
 * L'ACCÈS base est celui de `audits/2026-09-24/scripts/registre-catwalks.mts` : production, rôle
 * `catwalks_audit`, identifiants hors dépôt (`~/.catwalks/audit-access.json`), jamais affichés, transmis
 * à `psql` par son environnement, variables `PG*` héritées retirées ; transaction `READ ONLY` et garde
 * éprouvée AVANT toute mesure, sinon rien ne s'exécute. Aucune écriture, nulle part.
 *
 *   cd apps/api && npx tsx ../../audits/2026-09-25/scripts/logos-societes.mts [--sans-site] [--limite=N] [--sortie=nom.json]
 *
 * Sortie : résumé en console et preuves brutes dans `audits/2026-09-25/logos-societes.json` (ou `--sortie`).
 * Le gestionnaire exécuté est celui de la copie locale : `--sans-site` mesure donc l'effet d'un correctif
 * de l'API avant sa livraison, la chaîne réelle (proxy → production) restant celle qui est déployée.
 * Lancé depuis `apps/api` pour que l'alias `@/` du gestionnaire se résolve (tsconfig de l'API).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NextRequest } from 'next/server';
import { MARCHES } from '@catwalks/db/marches';
import { imageSize } from '../../../apps/api/lib/image-size.ts';
import { nameMatchesDomain } from '../../../apps/aggregator/src/normalize/companyDomain.ts';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const SITE = process.env.CW_SITE_TEST ?? 'https://catwalks-front-end-git-development-catwalks-9c91c4d2.vercel.app';
const SANS_SITE = process.argv.includes('--sans-site');
const LIMITE = Number(process.argv.find((a) => a.startsWith('--limite='))?.slice(9) ?? 0);
const SORTIE = new URL(`../${process.argv.find((a) => a.startsWith('--sortie='))?.slice(9) ?? 'logos-societes.json'}`, import.meta.url);

// ─── 1. La base, en lecture seule ──────────────────────────────────────────────────────────────
const PAYS = [...new Set(Object.values(MARCHES).flatMap((m) => m.pays))].sort();
if (!PAYS.length || PAYS.some((p) => !/^[A-Z]{2}$/.test(p))) refus('liste des pays des marchés illisible');
const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;
const DANS_MARCHE = `j."countryCode" IN (${PAYS.map((p) => `'${p}'`).join(',')})`;

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user, 'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
WITH pub AS (SELECT j.id, j."companyId", j."countryCode" FROM "Job" j WHERE ${PUBLIABLE} AND ${DANS_MARCHE}),
par AS (SELECT "companyId", count(*) AS n, count(*) FILTER (WHERE "countryCode" = 'FR') AS nfr FROM pub GROUP BY 1),
sources AS (
  SELECT p."companyId", json_object_agg(x."sourceKey", x.n) AS parsource FROM (
    SELECT pub."companyId", a."sourceKey", count(DISTINCT pub.id) AS n FROM pub JOIN "JobSource" a ON a."jobId" = pub.id
      AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}) GROUP BY 1, 2) x
  JOIN par p ON p."companyId" = x."companyId" GROUP BY p."companyId")
SELECT 'S' || E'\\t' || json_build_object('id', c.id, 'nom', c.name, 'cle', c."canonicalKey", 'domaine', c.domain,
  'domainSource', c."domainSource", 'groupe', c."parentGroup", 'fusionneeDans', c."mergedIntoId", 'careersUrl', c."careersUrl",
  'offres', par.n, 'offresFR', par.nfr, 'sources', s.parsource)::text
FROM par JOIN "Company" c ON c.id = par."companyId" LEFT JOIN sources s ON s."companyId" = par."companyId";
SELECT 'T' || E'\\t' || json_build_object(
  'offresPubliablesDansUnMarche', (SELECT count(*) FROM "Job" j WHERE ${PUBLIABLE} AND ${DANS_MARCHE}),
  'offresPubliablesFR', (SELECT count(*) FROM "Job" j WHERE ${PUBLIABLE} AND j."countryCode" = 'FR'),
  'offresDirectes', (SELECT count(*) FROM "DirectOffer"))::text;
\\else
\\echo REFUS_GARDE
\\endif
COMMIT;`;

const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');
// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'logos-societes' },
});
if (run.status !== 0) { console.error(run.stderr.replace(/password[^\n]*/gi, '<masqué>')); process.exit(run.status ?? 1); }
const lignes = run.stdout.split('\n').filter(Boolean);
if (lignes.includes('REFUS_GARDE')) refus('garde de lecture seule non satisfaite, aucune mesure exécutée');
const lire = (tag: string) => lignes.filter((l) => l.startsWith(`${tag}\t`)).map((l) => JSON.parse(l.slice(tag.length + 1)));
const [garde] = lire('G');
const [totaux] = lire('T');
type Societe = { id: string; nom: string; cle: string; domaine: string | null; domainSource: string | null; groupe: string | null;
  fusionneeDans: string | null; careersUrl: string | null; offres: number; offresFR: number; sources: Record<string, number> | null };
const societes = (lire('S') as Societe[]).sort((a, b) => b.offres - a.offres || a.nom.localeCompare(b.nom));
console.log(`base ${garde.base} · rôle ${garde.role} · lecture seule ${garde.lectureSeule} · ${garde.maintenant}`);

// ─── 2. Le vrai gestionnaire de l'API, avec l'enregistrement de ce que lui rendent les fournisseurs ───
type Reponse = { url: string; statut?: number; type?: string | null; octets?: number; largeur?: number | null; hauteur?: number | null;
  debut?: string; erreur?: string; ms: number };
const journal = new AsyncLocalStorage<Reponse[]>();
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entree: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
  const depart = Date.now();
  const store = journal.getStore();
  try {
    const reponse = await fetchOriginal(entree, init);
    if (store) {
      const octets = new Uint8Array(await reponse.clone().arrayBuffer());
      const taille = imageSize(octets);
      store.push({ url, statut: reponse.status, type: reponse.headers.get('content-type'), octets: octets.byteLength,
        largeur: taille?.width ?? null, hauteur: taille?.height ?? null,
        debut: Buffer.from(octets.subarray(0, 12)).toString('hex'), ms: Date.now() - depart });
    }
    return reponse;
  } catch (e) {
    store?.push({ url, erreur: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - depart });
    throw e;
  }
}) as typeof fetch;
const { GET } = await import('../../../apps/api/app/api/logo/route.ts');

async function verdictApi(domaine: string, taille: number) {
  const reponses: Reponse[] = [];
  const infoOriginal = console.info;
  console.info = () => {}; // le garde de clé journalise « désarmé » à chaque appel hors production
  try {
    const r = await journal.run(reponses, () => GET(new NextRequest(`http://mesure.local/api/logo?domain=${encodeURIComponent(domaine)}&size=${taille}`)));
    return { statut: r.status, type: r.headers.get('content-type'), fournisseurs: reponses };
  } finally {
    console.info = infoOriginal;
  }
}

// ─── 3. La chaîne réelle : proxy du site de test → API de production ───────────────────────────
async function viaSite(domaine: string, sansCache: boolean) {
  const url = `${SITE}/api/emplois/logo?domain=${encodeURIComponent(domaine)}&size=64${sansCache ? `&mesure=${Date.now()}` : ''}`;
  const depart = Date.now();
  try {
    const r = await fetchOriginal(url, { signal: AbortSignal.timeout(20_000) });
    const octets = new Uint8Array(await r.arrayBuffer());
    return { statut: r.status, cache: r.headers.get('x-vercel-cache'), age: r.headers.get('age'), type: r.headers.get('content-type'),
      octets: octets.byteLength, ms: Date.now() - depart };
  } catch (e) {
    return { erreur: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - depart };
  }
}

/** La cause lue dans les réponses des fournisseurs, pour un 404 de l'API. */
function causeDuRefus(fournisseurs: Reponse[]): string {
  const images = fournisseurs.filter((f) => f.statut && f.statut >= 200 && f.statut < 300 && (f.octets ?? 0) >= 100 && f.octets !== 1478);
  if (fournisseurs.some((f) => f.erreur) && !images.length) return 'fournisseur injoignable ou délai dépassé';
  if (!images.length) return 'aucun fournisseur ne connaît le domaine';
  if (images.every((f) => !f.largeur)) return 'format non mesuré (largeur inconnue)';
  const plusGrand = Math.max(...images.map((f) => f.largeur ?? 0));
  const plusHaut = Math.max(...images.map((f) => f.hauteur ?? 0));
  return `plus grande image ${plusGrand}×${plusHaut} px < 32 px de large`;
}

const aSonder = [...new Set(societes.flatMap((s) => (s.domaine ? [s.domaine] : [])))].slice(0, LIMITE || undefined);
console.log(`sociétés avec offre publiable dans un marché : ${societes.length} · domaines distincts à sonder : ${aSonder.length}`);
type Mesure = { carte: Awaited<ReturnType<typeof verdictApi>>; fiche: Awaited<ReturnType<typeof verdictApi>>;
  site?: Awaited<ReturnType<typeof viaSite>>; siteSansCache?: Awaited<ReturnType<typeof viaSite>> };
const mesures = new Map<string, Mesure>();
const PARALLELE = 4;
let suivant = 0;
await Promise.all(Array.from({ length: PARALLELE }, async () => {
  while (suivant < aSonder.length) {
    const domaine = aSonder[suivant++];
    const carte = await verdictApi(domaine, 64);
    const fiche = await verdictApi(domaine, 96);
    const mesure: Mesure = { carte, fiche };
    if (!SANS_SITE) {
      mesure.site = await viaSite(domaine, false);
      mesure.siteSansCache = await viaSite(domaine, true);
    }
    mesures.set(domaine, mesure);
    if (mesures.size % 100 === 0) console.log(`  … ${mesures.size}/${aSonder.length}`);
  }
}));

// ─── 4. Classement et pondération par les offres ───────────────────────────────────────────────
type Ligne = Societe & { etat: string; cause: string; nomDansDomaine: boolean | null; api: number | null; apiFiche: number | null;
  site: number | null; siteCache: string | null; siteSansCache: number | null };
const classees: Ligne[] = societes.map((s) => {
  if (!s.domaine) return { ...s, etat: 'MONOGRAMME', cause: 'domaine absent', nomDansDomaine: null, api: null, apiFiche: null, site: null, siteCache: null, siteSansCache: null };
  const m = mesures.get(s.domaine);
  if (!m) return { ...s, etat: 'NON_SONDE', cause: 'hors limite', nomDansDomaine: nameMatchesDomain(s.nom, s.domaine), api: null, apiFiche: null, site: null, siteCache: null, siteSansCache: null };
  const logo = m.carte.statut === 200;
  const siteDit = m.site && 'statut' in m.site ? m.site.statut ?? null : null;
  const cause = logo
    ? (siteDit !== null && siteDit !== 200 ? `API 200 mais site ${siteDit} (${m.site && 'cache' in m.site ? m.site.cache : '?'})` : 'logo servi')
    : causeDuRefus(m.carte.fournisseurs);
  return { ...s, etat: logo ? (siteDit === null || siteDit === 200 ? 'LOGO' : 'LOGO_API_SEULEMENT') : 'MONOGRAMME', cause,
    nomDansDomaine: nameMatchesDomain(s.nom, s.domaine), api: m.carte.statut, apiFiche: m.fiche.statut, site: siteDit,
    siteCache: m.site && 'cache' in m.site ? m.site.cache ?? null : null,
    siteSansCache: m.siteSansCache && 'statut' in m.siteSansCache ? m.siteSansCache.statut ?? null : null };
});

const somme = (xs: Ligne[], cle: 'offres' | 'offresFR') => xs.reduce((n, x) => n + x[cle], 0);
const sansLogo = classees.filter((l) => l.etat !== 'LOGO');
const parCause = new Map<string, Ligne[]>();
for (const l of sansLogo) {
  const famille = l.cause.startsWith('plus grande image') ? 'image sous le seuil de 32 px de large' : l.cause;
  parCause.set(famille, [...(parCause.get(famille) ?? []), l]);
}
console.log(`\ntotaux base : ${JSON.stringify(totaux)}`);
console.log(`sociétés : ${classees.length} · offres : ${somme(classees, 'offres')} (dont FR ${somme(classees, 'offresFR')})`);
console.log(`AVEC logo : ${classees.length - sansLogo.length} sociétés · ${somme(classees, 'offres') - somme(sansLogo, 'offres')} offres`);
console.log(`SANS logo : ${sansLogo.length} sociétés · ${somme(sansLogo, 'offres')} offres (dont FR ${somme(sansLogo, 'offresFR')})`);
for (const [cause, xs] of [...parCause].sort((a, b) => somme(b[1], 'offres') - somme(a[1], 'offres'))) {
  console.log(`  ${cause} : ${xs.length} sociétés · ${somme(xs, 'offres')} offres (FR ${somme(xs, 'offresFR')})`);
}
const avecDomaine = classees.filter((l) => l.domaine && mesures.has(l.domaine));
const divergences = avecDomaine.filter((l) => l.site !== null && (l.api === 200) !== (l.site === 200));
console.log(`\ndivergences API locale / chaîne réelle (carte) : ${divergences.length}`);
for (const l of divergences.slice(0, 20)) console.log(`  ${l.nom} (${l.domaine}) API ${l.api} · site ${l.site} [${l.siteCache}] · site sans cache ${l.siteSansCache}`);
console.log(`\nfiche (96 px) : API 404 sur ${avecDomaine.filter((l) => l.apiFiche !== 200).length} domaines dont la carte a un logo : ${avecDomaine.filter((l) => l.apiFiche !== 200 && l.api === 200).length}`);
console.log(`domaines ne portant pas le nom de la société (à relire, logo peut-être d'une autre entreprise) : ${avecDomaine.filter((l) => l.nomDansDomaine === false).length}`);

console.log('\n30 premières sociétés SANS logo, par offres publiables :');
for (const l of sansLogo.slice(0, 30)) {
  console.log(`  ${String(l.offres).padStart(5)} (FR ${String(l.offresFR).padStart(4)})  ${l.nom}  [${l.domaine ?? '—'}${l.domainSource ? ` · ${l.domainSource}` : ''}]  → ${l.cause}`);
}

writeFileSync(SORTIE, `${JSON.stringify({ mesureLe: garde.maintenant, site: SANS_SITE ? null : SITE, totaux, pays: PAYS,
  societes: classees, mesures: Object.fromEntries(mesures) }, null, 1)}\n`);
console.log(`\npreuves brutes : ${SORTIE.pathname}`);

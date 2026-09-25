/**
 * PAYS — LES SIGNAUX DÉCLARÉS D'UNE MÊME PUBLICATION SE CONTREDISENT-ILS ? (D-440 point 1, règle D-435)
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * `multi-pays-mesure.mts` a compté 20 offres publiables dont le pays projeté (`Job.countryCode`)
 * contredit le pays unique de leurs lieux déclarés, dont 12 Ulta classées à Porto Rico. Avant de
 * corriger, la prémisse se mesure sur TOUTES les familles qui exposent plusieurs signaux de pays
 * pour un même lieu (code pays, nom de pays, libellé, État, code postal, coordonnées) :
 *
 *   A. combien d'offres publiables portent des signaux de pays contradictoires, par source, lequel
 *      la projection a retenu, et ce que disent les éléments de corroboration ;
 *   B. ce que décide `declaredPlaceVerdict` (`normalize/declaredPlaceCountry.ts`) pour CHAQUE offre
 *      publiable, sur ses entrées stockées (pays projeté + lieux déclarés) : abstention D-440, adresse
 *      D-442 §1, territoire D-442 §2, D-450 et D-454 (Hong Kong et Taïwan sous `CN`, Porto Rico sous `US`,
 *      nommés dans le libellé, hiérarchique compris, la ville ou la région d'un lieu déclaré ; un lieu mixte
 *      restant hors de la règle) — et les comptes des marchés PR, US, GB, HK, CN avant / après.
 *      Le champ pays de l'offre n'est pas stocké : B le prend égal au code du pays projeté, ce qui MAJORE
 *      les deux règles (le territoire exige le champ de son pays englobant, `CN` ou `US`, l'adresse un champ
 *      qui soit un code) ; C rend la valeur exacte pour Jibe, Phenom, Lever et le JSON-LD générique. B se
 *      termine par le contrôle de l'effet consigné (`EFFET_CONSIGNE`) : D-442 et sa précision du 24/09/2026
 *      (22 changements), puis D-450 pour Porto Rico (21) et D-454 §1 pour les libellés hiérarchiques (7) ; tout
 *      écart y est nommé ;
 *   C. un REJEU EXACT de la projection du code courant (`publicationJobContent`) sur les RAW des
 *      familles Jibe, Phenom, Lever et JSON-LD générique (nœud JobPosting retenu, `catwalksPageUrl`),
 *      reconstruits par leurs propres parseurs d'adaptateur, comparé au pays stocké : tout écart hors
 *      de B est une dérive ou un défaut de reconstruction, nommé. Les autres familles, Workday compris
 *      (les 12 offres de Porto Rico de Tapestry et de VF Corporation), ne sont couvertes que par B : leur RAW
 *      n'est pas capturé.
 *
 * Les signaux ne sont lus qu'aux chemins NOMMÉS ci-dessous pour chaque famille, jamais par une
 * recherche récursive dans le JSON (D-435, « lecture des preuves structurées »). Les adresses de
 * société (`Flatchr company.address`, `WTTJ organization.headquarter`) ne décrivent pas le lieu du
 * poste et sont exclues. Un même lieu = un groupe de signaux ; deux lieux distincts d'une offre
 * multi-lieux ne sont jamais comparés entre eux (c'est la question multi-pays, pas celle-ci).
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Offres publiables = `publicJobSql` (packages/db/availability.ts), recopiée à l'identique comme
 * dans `multi-pays-mesure.mts` ; les signaux sont lus sur la publication CANONIQUE, celle dont la
 * projection a produit `Job.countryCode`.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Identique à `multi-pays-mesure.mts` : production, rôle `catwalks_audit`, identifiants hors dépôt
 * (`~/.catwalks/audit-access.json`), jamais affichés ; `--repetition` lit la base de répétition par
 * le tunnel local. Aucun Prisma, aucune URL passée en argument : `psql` reçoit les identifiants par
 * son environnement, sans aucune variable `PG*` héritée. Transaction `READ ONLY`, garde éprouvée AVANT toute
 * mesure (base attendue, rôle `catwalks_audit` en production, lecture seule effective, rôle non superutilisateur) ;
 * sinon rien ne s'exécute.
 *
 * `--capture <fichier>` garde la sortie brute de cette lecture (lignes G, F, L) HORS du dépôt, puisqu'elle
 * contient des RAW de production ; `--depuis <fichier>` rejoue toute la mesure sur une capture, sans aucun
 * accès à la base. Deux versions du code se comparent ainsi sur le MÊME instantané, sans relire la
 * production (pendant le RUN quotidien, par exemple).
 *
 *   npx tsx audits/2026-09-24/scripts/pays-signaux-contradictoires.mts [--repetition] [--json]
 *     [--capture <fichier hors dépôt>] [--depuis <fichier>]
 *
 * Code de sortie : 0 quand B rend exactement l'effet consigné et que la projection réelle (C) le confirme, 4 sinon
 * (l'écart est décrit avant : effet attendu, ou « C. écarts bloquants »), 3 sur refus.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceFacts, SourceLocation } from '@catwalks/db/source-facts';
import { CODES_MARCHE, marche } from '@catwalks/db/marches';
import { countryFromLocation, normalizeCountry } from '../../../apps/aggregator/src/normalize/country.ts';
import { resolveGeography, US_SUBDIVISION_NAMES, CA_SUBDIVISION_NAMES, US_STATES } from '../../../apps/aggregator/src/normalize/geography.ts';
import { addressFieldsFor, declaredPlaceVerdict, declaredPlacesCountry } from '../../../apps/aggregator/src/normalize/declaredPlaceCountry.ts';
import { readSourceFacts } from '../../../apps/aggregator/src/facts/index.ts';
import { publicationJobContent } from '../../../apps/aggregator/src/publication/content.ts';
import { BOOTSTRAP_TAXONOMY } from '../../../apps/aggregator/src/normalize/taxonomy.ts';
import { cleanPlace } from '../../../apps/aggregator/src/lib/normalize.ts';
import { parseJibePage } from '../../../apps/aggregator/src/ats/adapters/jibe.ts';
import { parsePhenomJob, parseCareerConnectJob } from '../../../apps/aggregator/src/ats/adapters/phenom.ts';
import { parseLeverJob } from '../../../apps/aggregator/src/ats/adapters/lever.ts';
import { normalizeGenericPosting } from '../../../apps/aggregator/src/ats/adapters/genericJsonLd.ts';
import type { NormalizedJob } from '../../../apps/aggregator/src/types.ts';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const repetition = process.argv.includes('--repetition');
const sortieJson = process.argv.includes('--json');
const option = (nom: string) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : undefined; };
const capture = option('--capture'), depuis = option('--depuis');
const DEPOT = fileURLToPath(new URL('../../../', import.meta.url));
if (process.argv.includes('--capture') && !capture || process.argv.includes('--depuis') && !depuis) refus('--capture et --depuis prennent un fichier');
// Comparaison sans casse : le système de fichiers de macOS l'ignore, « /users/…/Catwalks-Job-Aggregator » est le dépôt.
if (capture && resolve(capture).toLowerCase().startsWith(DEPOT.toLowerCase())) refus('la capture contient des RAW de production : elle se range hors du dépôt');
if (capture && depuis) refus('--capture et --depuis sont exclusifs');
const BASE = repetition ? 'catwalks_consolide_rehearsal' : 'railway';

const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;
const ligne = (tag: string, json: string) => `SELECT '${tag}' || E'\\t' || (${json})::text;`;

/**
 * Un lieu = { f: [[chemin, valeur]…] champs pays, l: libellé, r: État/région, p: code postal, la/lo: coordonnées }.
 * `el(tableau, corps)` rend un groupe par élément ; `seul(tableau)` le premier élément d'un tableau d'UN seul lieu.
 */
const tab = (chemin: string) => `(CASE WHEN jsonb_typeof(s.raw${chemin}) = 'array' THEN s.raw${chemin} ELSE '[]'::jsonb END)`;
const el = (chemin: string, corps: string) => `coalesce((SELECT jsonb_agg(${corps} ORDER BY o) FROM jsonb_array_elements(${tab(chemin)}) WITH ORDINALITY e(x, o)), '[]'::jsonb)`;
const seul = (chemin: string) => `(CASE WHEN jsonb_array_length(${tab(chemin)}) = 1 THEN s.raw${chemin}->0 END)`;
const f = (...paires: Array<[string, string]>) => `jsonb_build_array(${paires.map(([nom, expr]) => `jsonb_build_array('${nom}', ${expr})`).join(', ')})`;
const lieu = (champs: string, extra = '') => `jsonb_build_object('f', ${champs}${extra ? `, ${extra}` : ''})`;
const NOMME = (x: string) => `'l', ${x}->'full_location', 'r', ${x}->'state', 'p', ${x}->'postal_code', 'la', ${x}->'latitude', 'lo', ${x}->'longitude'`;

const SIGNAUX = `CASE coalesce(s."sourceFacts"->>'sourceType', j.source::text)
  WHEN 'JIBE' THEN jsonb_build_array(${lieu(f(['country_code', `s.raw->'country_code'`], ['country', `s.raw->'country'`]), NOMME('s.raw'))})
    || ${el(`->'additional_locations'`, lieu(f(['additional_locations/*/country_code', `x->'country_code'`], ['additional_locations/*/country', `x->'country'`]), NOMME('x')))}
  WHEN 'PHENOM' THEN jsonb_build_array(${lieu(f(['country_code', `s.raw->'country_code'`], ['country', `s.raw->'country'`],
      ['postingEvidence/…/addressCountry', `s.raw#>'{postingEvidence,jobPosting,jobLocation,address,addressCountry}'`]),
      `'l', coalesce(s.raw->'cityStateCountry', s.raw->'full_location'), 'r', s.raw->'state', 'p', s.raw->'postal_code', 'la', s.raw->'latitude', 'lo', s.raw->'longitude'`)})
    || ${el(`->'additional_locations'`, lieu(f(['additional_locations/*/country_code', `x->'country_code'`], ['additional_locations/*/country', `x->'country'`]), NOMME('x')))}
  WHEN 'HARRI' THEN ${el(`#>'{listing,locations}'`, lieu(f(['locations/*/country', `x->'country'`], ['locations/*/country_code', `x->'country_code'`]), `'l', x->'formatted_address', 'r', x->'state'`))}
  WHEN 'LVMH_ALGOLIA' THEN jsonb_build_array(${lieu(f(['country', `s.raw->'country'`], ['countryRegion', `s.raw->'countryRegion'`], ['countryRegionFilter', `s.raw->'countryRegionFilter'`]))})
  WHEN 'ORACLE_HCM' THEN jsonb_build_array(${lieu(`${f(['detail/PrimaryLocationCountry', `s.raw#>'{detail,PrimaryLocationCountry}'`], ['list/PrimaryLocationCountry', `s.raw#>'{list,PrimaryLocationCountry}'`],
      ['detail/workLocation/0/Country (lieu unique)', `${seul(`#>'{detail,workLocation}'`)}->'Country'`])}
      || coalesce((SELECT jsonb_agg(jsonb_build_array('detail/primaryLocationCoordinates/*/CountryCode', x->'CountryCode')) FROM jsonb_array_elements(${tab(`#>'{detail,primaryLocationCoordinates}'`)}) x), '[]'::jsonb)`)})
  WHEN 'PERSONIO' THEN jsonb_build_array(${lieu(f(['postingEvidence/…/addressCountry', `s.raw#>'{postingEvidence,jobPosting,jobLocation,address,addressCountry}'`],
      ['personioDetail/…/office_addresses/0/country (lieu unique)', `${seul(`#>'{personioDetail,position,office_addresses}'`)}->'country'`]))})
  WHEN 'RECRUITEE' THEN jsonb_build_array(${lieu(f(['country', `s.raw->'country'`], ['country_code', `s.raw->'country_code'`],
      ['locations/0/country (lieu unique)', `${seul(`->'locations'`)}->'country'`], ['locations/0/country_code (lieu unique)', `${seul(`->'locations'`)}->'country_code'`]))})
    || (CASE WHEN jsonb_array_length(${tab(`->'locations'`)}) > 1 THEN ${el(`->'locations'`, lieu(f(['locations/*/country', `x->'country'`], ['locations/*/country_code', `x->'country_code'`]), `'l', x->'name', 'r', x->'state'`))} ELSE '[]'::jsonb END)
  WHEN 'SUCCESSFACTORS' THEN jsonb_build_array(${lieu(f(['successfactorsDetail/country', `s.raw#>'{successfactorsDetail,country}'`],
      ['successfactorsDetail/properties/country', `s.raw#>'{successfactorsDetail,properties,country}'`], ['postingEvidence/careersiteProperties/country', `s.raw#>'{postingEvidence,careersiteProperties,country}'`]))})
  WHEN 'TALENT_FUNNEL' THEN jsonb_build_array(${lieu(f(['vacancy/location/country', `s.raw#>'{vacancy,location,country}'`], ['detail/positionProfile/location/country', `s.raw#>'{detail,positionProfile,location,country}'`]))})
  WHEN 'TALENTVIEW' THEN jsonb_build_array(${lieu(f(['address/country', `s.raw#>'{address,country}'`], ['address/iso_country', `s.raw#>'{address,iso_country}'`],
      ['detail/address/country', `s.raw#>'{detail,address,country}'`], ['detail/address/iso_country', `s.raw#>'{detail,address,iso_country}'`]))})
  WHEN 'WORKABLE' THEN jsonb_build_array(${lieu(f(['country', `s.raw->'country'`], ['locations/0/country (lieu unique)', `${seul(`->'locations'`)}->'country'`],
      ['locations/0/countryCode (lieu unique)', `${seul(`->'locations'`)}->'countryCode'`]))})
    || (CASE WHEN jsonb_array_length(${tab(`->'locations'`)}) > 1 THEN ${el(`->'locations'`, lieu(f(['locations/*/country', `x->'country'`], ['locations/*/countryCode', `x->'countryCode'`]), `'l', x->'city', 'r', x->'region'`))} ELSE '[]'::jsonb END)
  WHEN 'WTTJ' THEN ${el(`->'offices'`, lieu(f(['offices/*/country', `x->'country'`], ['offices/*/country_code', `x->'country_code'`]), `'l', x->'city'`))}
    || (CASE WHEN jsonb_array_length(${tab(`->'offices'`)}) = 1 THEN jsonb_build_array(${lieu(f(['offices/0/country (lieu unique)', `s.raw->'offices'->0->'country'`], ['detail/office/country_code', `s.raw#>'{detail,office,country_code}'`]))}) ELSE '[]'::jsonb END)
  WHEN 'LEVER' THEN jsonb_build_array(${lieu(f(['country', `s.raw->'country'`]), `'l', coalesce(${seul(`#>'{categories,allLocations}'`)}, CASE WHEN jsonb_array_length(${tab(`#>'{categories,allLocations}'`)}) = 0 THEN s.raw#>'{categories,location}' END)`)})
END`;

/**
 * Les RAW rejoués en C : allégés des textes longs, qui n'entrent pas dans le pays. Pour le JSON-LD générique, le
 * nœud JobPosting retenu garde `jobLocation`, `title` et `catwalksPageUrl` ; les RAW d'un flux RSS (`feedItem`) ou
 * de Caudalie (`detailHtml`) perdent leur texte et restent comptés NON_RECONSTRUIT.
 */
const RAW_REJEU = `CASE WHEN coalesce(s."sourceFacts"->>'sourceType', j.source::text) IN ('JIBE', 'PHENOM', 'LEVER')
  THEN s.raw - 'description' - 'qualifications' - 'responsibilities' - 'descriptionPlain' - 'descriptionBody' - 'descriptionBodyPlain'
    - 'lists' - 'additional' - 'additionalPlain' - 'opening' - 'openingPlain' - 'postingEvidence' - 'descriptionTeaser'
  WHEN coalesce(s."sourceFacts"->>'sourceType', j.source::text) = 'GENERIC_JSONLD'
  THEN s.raw - 'description' - 'qualifications' - 'responsibilities' - 'skills' - 'jobBenefits' - 'experienceRequirements'
    - 'educationRequirements' - 'incentiveCompensation' - 'detailHtml' - 'feedItem' END`;

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_setting('transaction_read_only') = 'on'${repetition ? '' : " AND current_user = 'catwalks_audit'"}
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
${ligne('G', `json_build_object('base', current_database(), 'role', current_user, 'lectureSeule', current_setting('transaction_read_only'),
  'isolation', current_setting('transaction_isolation'), 'superutilisateur', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), 'maintenant', now())`)}
\\if :garde_ok
${ligne('F', `json_build_object('jobMajMax', (SELECT max("updatedAt") FROM "Job"), 'sourceVueMax', (SELECT max("lastSeenAt") FROM "JobSource"))`)}
SELECT 'L' || E'\\t' || json_build_object('id', j.id, 'cc', j."countryCode", 'ci', j."countryIntegrity", 'a1', j."adminArea1", 'k', s."sourceKey", 'x', s."externalId",
  't', coalesce(s."sourceFacts"->>'sourceType', j.source::text), 'st', s."sourceTier", 'u', s.url,
  'loc', j.location, 'facts', s."sourceFacts"->'locations', 'sig', ${SIGNAUX}, 'raw', ${RAW_REJEU})::text
FROM "Job" j JOIN "JobSource" s ON s."sourceKey" = j."canonicalSourceKey" AND s."externalId" = j."canonicalExternalId"
WHERE ${PUBLIABLE};
\\else
\\echo REFUS_GARDE
\\endif
COMMIT;`;

/** La lecture de la base : identifiants hors dépôt, jamais affichés ; garde éprouvée avant toute mesure. */
function lireBase(): string {
  const fichier = repetition
    ? process.env.CW_REHEARSAL_ACCESS ?? `${homedir()}/.catwalks/rehearsal-access.json`
    : process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
  let acces: Record<string, unknown> = {};
  try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
  if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
  if (!repetition && acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');
  if (repetition && !['127.0.0.1', 'localhost'].includes(String(acces.PGHOST))) refus('tunnel local requis');
  const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    input: script, encoding: 'utf8', maxBuffer: 1 << 30,
    // Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG'))), PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
      PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: repetition ? 'prefer' : 'require',
      PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'pays-signaux-contradictoires' },
  });
  if (run.status !== 0) { console.error(run.stderr.replace(/password[^\n]*/gi, '<masqué>')); process.exit(run.status ?? 1); }
  return run.stdout;
}
const sortie = depuis ? readFileSync(depuis, 'utf8') : lireBase();
const lignes = sortie.split('\n').filter(Boolean);
if (lignes.includes('REFUS_GARDE')) refus('garde de lecture seule non satisfaite, aucune mesure exécutée');
if (capture) writeFileSync(capture, sortie, { mode: 0o600 });
const lire = <T,>(tag: string) => lignes.filter((l) => l.startsWith(`${tag}\t`)).map((l) => JSON.parse(l.slice(tag.length + 1)) as T);

type Lieu = { f: Array<[string, unknown]>; l?: unknown; r?: unknown; p?: unknown; la?: unknown; lo?: unknown };
type Offre = { id: string; cc: string | null; ci: string | null; a1: string | null; k: string; x: string; t: string; st: string; u: string;
  loc: string | null; facts: SourceFacts['locations'] | null; sig: Lieu[] | null; raw: Record<string, unknown> | null };
const [garde] = lire<Record<string, unknown>>('G');
const [fraicheur] = lire<Record<string, unknown>>('F');
const offres = lire<Offre>('L');

const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
/**
 * Le pays d'un LIBELLÉ, par les deux lecteurs de la projection : lecture structurelle (`resolveGeography`), puis
 * repli (`countryFromLocation`). Ce repli lit un nom seul comme un territoire (« Hong Kong », « Macau ») : A le
 * montre comme signal, la règle B ne le retient pas pour contredire un champ (`normalize/declaredPlaceCountry.ts`).
 */
const paysDuLibelle = (l: string | null) => (l ? resolveGeography({ location: l }).countryCode ?? countryFromLocation(l) : undefined);
/** Ce qu'un champ État/région corrobore, par les SEULES tables de subdivisions du code (US, CA). */
const paysDeLaRegion = (r: string | null) => {
  if (!r) return null;
  const nom = r.trim();
  if (US_SUBDIVISION_NAMES.has(nom) || Object.hasOwn(US_STATES, nom.toUpperCase())) return 'US';
  if (CA_SUBDIVISION_NAMES.has(nom)) return 'CA';
  return null;
};
/**
 * Pour l'affichage seulement : les champs de NOM de lieu (libellé, ville, région) d'un lieu déclaré qui nomment ce
 * pays par son nom, segment par segment, aux séparateurs de la règle (« > » des libellés hiérarchiques compris,
 * D-454 §1) — jamais par un code à deux ou trois lettres. La règle elle-même vit dans `normalize/declaredPlaceCountry.ts`.
 */
const champsNommant = (l: SourceLocation, pays: string) => (['label', 'city', 'region'] as const).filter((champ) =>
  (l[champ] ?? '').split(/[,|/·;>]/).some((segment) => !/^[A-Za-z]{2,3}$/.test(segment.trim()) && normalizeCountry(segment) === pays));

const marcheDuPays = new Map<string, string>();
for (const code of CODES_MARCHE) for (const p of marche(code)!.pays) marcheDuPays.set(p, code);
const inc = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const top = (m: Map<string, number>, n = 60) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n));

// ── A. Signaux déclarés contradictoires, famille par famille ───────────────────────────────────
const publiablesParSource = new Map<string, number>(), multiSignauxParSource = new Map<string, number>();
const contraParSource = new Map<string, number>(), contraParType = new Map<string, number>();
const retenu = new Map<string, number>(), corroboration = new Map<string, number>(), formes = new Map<string, number>();
const casA: unknown[] = [];
let publiables = 0, avecGroupe = 0;
for (const o of offres) {
  publiables++;
  inc(publiablesParSource, `${o.t}|${o.k}`);
  let multi = false, contra = false;
  for (const g of o.sig ?? []) {
    const champs = (g.f ?? []).map(([chemin, v]) => ({ chemin, brut: texte(v), iso: normalizeCountry(texte(v)) })).filter((c) => c.brut);
    const libelle = texte(g.l), isoLibelle = paysDuLibelle(libelle);
    const signaux = [...champs.map((c) => c.iso), ...(isoLibelle ? [isoLibelle] : [])];
    if (signaux.length < 2) continue;
    multi = true;
    const distincts = new Set(signaux.filter((p): p is string => !!p));
    if (distincts.size < 2) continue;
    contra = true;
    const entreChamps = new Set(champs.map((c) => c.iso).filter(Boolean)).size > 1;
    inc(formes, `${o.t}|${entreChamps ? 'CHAMP_CONTRE_CHAMP' : 'CHAMP_CONTRE_LIBELLE'}`);
    const region = paysDeLaRegion(texte(g.r));
    inc(retenu, `${o.t}|projeté=${o.cc ?? 'aucun'}|${champs.filter((c) => c.iso === o.cc).map((c) => c.chemin).join('+') || (isoLibelle === o.cc ? 'libellé' : 'aucun signal')}`);
    inc(corroboration, `${o.k}|signaux=${[...champs.map((c) => `${c.chemin}:${c.iso ?? '?'}`), ...(isoLibelle ? [`libellé:${isoLibelle}`] : [])].join(',')}|région=${region ?? '-'}`);
    if (casA.length < 40) casA.push({ id: o.id, source: o.k, projete: o.cc, integrite: o.ci, champs: champs.map((c) => [c.chemin, c.brut]),
      libelle, region: texte(g.r), regionCorrobore: region, postal: texte(g.p), lat: texte(g.la), lon: texte(g.lo) });
  }
  if (o.sig?.length) avecGroupe++;
  if (multi) inc(multiSignauxParSource, `${o.t}|${o.k}`);
  if (contra) { inc(contraParSource, `${o.t}|${o.k}`); inc(contraParType, o.t); }
}
const tableA = Object.fromEntries([...multiSignauxParSource].sort((a, b) => b[1] - a[1]).map(([k, n]) =>
  [k, { publiables: publiablesParSource.get(k) ?? 0, avecPlusieursSignaux: n, contradictoires: contraParSource.get(k) ?? 0 }]));

// ── B. Les verdicts de `declaredPlaceVerdict` sur les entrées stockées (pays projeté + lieux déclarés) ──
const marcheDe = (pays: string | null | undefined) => (pays ? marcheDuPays.get(pays) ?? `(hors marché : ${pays})` : '(aucun pays)');
type Changement = { id: string; source: string; basis: string; avant: string | null; apres: string | null } & Record<string, unknown>;
const changements: Changement[] = [];
const parBase = new Map<string, number>(), parSourceB = new Map<string, number>(), transitions = new Map<string, number>();
/** La règle D-440 seule (lot A2, sans D-442) : pour dire ce que D-442 en reprend. */
const abstenuesD440 = new Set<string>();
for (const o of offres) {
  if (!o.facts) continue;
  const cc = o.cc ?? undefined;
  const declare = declaredPlacesCountry(o.facts);
  if (cc && declare && declare !== cc) abstenuesD440.add(o.id);
  // Le champ pays n'est pas stocké : le prendre égal au code du pays projeté MAJORE les deux règles de D-442.
  const v = declaredPlaceVerdict({ retained: cc, countryField: cc, locations: o.facts });
  if (v.basis === 'RETAINED') continue;
  inc(parBase, v.basis); inc(parSourceB, `${v.basis}|${o.k}`);
  inc(transitions, `${v.basis}|${o.cc ?? 'aucun'} → ${v.countryCode ?? 'aucun'}|${marcheDe(o.cc)} → ${marcheDe(v.countryCode)}`);
  const lieux = o.facts.value ?? [];
  const paysAdresse = v.basis === 'ADDRESS' ? v.countryCode : v.basis === 'ABSTAINED' ? v.declared : null;
  changements.push({ id: o.id, source: o.k, externalId: o.x, basis: v.basis, avant: o.cc, integriteAvant: o.ci, apres: v.countryCode ?? null,
    marcheAvant: marcheDe(o.cc), marcheApres: marcheDe(v.countryCode),
    champsAdresse: paysAdresse ? lieux.map((l) => addressFieldsFor(l, paysAdresse)) : undefined,
    champsTerritoire: v.basis === 'TERRITORY' ? lieux.map((l) => champsNommant(l, v.countryCode)) : undefined,
    lieux: lieux.map((l) => ({ label: l.label, city: l.city, region: l.region, postal: l.postalCode, pays: l.country, lat: l.latitude, lon: l.longitude })) });
}
const changementParId = new Map(changements.map((c) => [c.id, c]));
const reprisesParD442 = [...abstenuesD440].filter((id) => changementParId.get(id)?.basis !== 'ABSTAINED').length;

/** Les identifiants changés, par règle, source et transition de pays. */
const idsParRegle = new Map<string, string[]>();
for (const c of changements) {
  const cle = `${c.basis}|${c.source}|${c.avant ?? 'aucun'} → ${c.apres ?? 'aucun'}`;
  idsParRegle.set(cle, [...(idsParRegle.get(cle) ?? []), c.id]);
}
/**
 * L'effet attendu, à données constantes, comparé au rejeu : celui que consignent les décisions (DECISIONS.md, 24/09/2026).
 *  · D-442 et sa précision du même jour : 12 Ulta aux États-Unis, Slough au Royaume-Uni, 6 Arc'teryx et 3 LuxExperience
 *    (lieu sans libellé, ville « Hong Kong SAR, China » sous `CN`) à Hong Kong — 22 changements ;
 *  · D-450, « Porto Rico » : la règle 2 de D-442 sous le champ `US`, 21 offres qui nomment Porto Rico dans chacun de leurs
 *    lieux (Skechers 16, Tapestry 5) ;
 *  · D-454 §1 : le libellé hiérarchique nomme le territoire, 7 offres VF Corporation (« USCA > USA > Puerto Rico > … »).
 * Toute autre transition, et tout compte différent, est un écart nommé : il se fait trancher, jamais effacer en alignant
 * l'effet sur le rejeu ou le code sur l'effet.
 */
const EFFET_D442: Readonly<Record<string, number>> = {
  'ADDRESS|ulta-jibe|PR → US': 12, 'ADDRESS|foot-locker-france|US → GB': 1, 'TERRITORY|arcteryx|CN → HK': 6, 'TERRITORY|luxexperience|CN → HK': 3,
};
const EFFET_D450_PORTO_RICO: Readonly<Record<string, number>> = { 'TERRITORY|skechers-phenom|US → PR': 16, 'TERRITORY|tapestry|US → PR': 5 };
const EFFET_D454_HIERARCHIE: Readonly<Record<string, number>> = { 'TERRITORY|vf-corporation|US → PR': 7 };
const EFFET_CONSIGNE: Readonly<Record<string, number>> = { ...EFFET_D442, ...EFFET_D450_PORTO_RICO, ...EFFET_D454_HIERARCHIE };
const ecartsA = (attendu: Readonly<Record<string, number>>) => [...new Set([...Object.keys(attendu), ...idsParRegle.keys()])]
  .filter((cle) => (attendu[cle] ?? 0) !== (idsParRegle.get(cle)?.length ?? 0))
  .map((cle) => ({ transition: cle, attendu: attendu[cle] ?? 0, mesure: idsParRegle.get(cle)?.length ?? 0 }));
const effetsAttendus = [
  { nom: 'consigné (D-442 et sa précision : 22 ; D-450, Porto Rico : 21 ; D-454 §1, libellés hiérarchiques : 7)', attendu: EFFET_CONSIGNE, ecarts: ecartsA(EFFET_CONSIGNE) },
];

// Comptes de marché des offres publiables : stockés (production), après D-440 seule (lot A2), après D-440 + D-442.
const MARCHES_SUIVIS = ['PR', 'US', 'GB', 'HK', 'CN', '(aucun pays)'];
const comptes = { avant: new Map<string, number>(), apresD440: new Map<string, number>(), apresD442: new Map<string, number>() };
for (const o of offres) {
  const avant = marcheDe(o.cc), ch = changementParId.get(o.id);
  inc(comptes.avant, avant);
  inc(comptes.apresD440, abstenuesD440.has(o.id) ? '(aucun pays)' : avant);
  inc(comptes.apresD442, ch ? marcheDe(ch.apres) : avant);
}
const tableMarches = Object.fromEntries(MARCHES_SUIVIS.map((m) => [m, {
  avant: comptes.avant.get(m) ?? 0, apresD440Seule: comptes.apresD440.get(m) ?? 0, apresD442: comptes.apresD442.get(m) ?? 0 }]));

/**
 * Pour information, hors règle : les offres classées dans un pays englobant de la liste fermée (`CN`, `US`) dont le lieu
 * (`Job.location`, libellé, ville, région, code postal) désigne l'un de ses territoires. Celles qui restent INCHANGÉES
 * montrent ce que la règle, qui exige le nom dans chaque lieu, ne lit pas. Pour Porto Rico sous `US`, le signal le plus
 * sûr est retenu (`signalPortoRico`) :
 *   · NOM    — « Puerto Rico » écrit en toutes lettres ;
 *   · CODE   — « PR » en position d'État (« US-PR-San Juan », « San Juan, PR 00918 », région « PR »), ou un code postal
 *              006–009 dans le champ code postal (jamais un numéro de magasin à cinq chiffres d'un libellé) ;
 *   · LIEU   — une commune ou un centre de l'île nommé seul (Barceloneta, Bayamón, Mayagüez, Montehiedra, Las Catalinas,
 *              « Ponce, US ») ; « Ponce City Market » est à Atlanta et n'en est pas ;
 *   · AMBIGU — « San Juan, US » : homonyme d'une ville du Texas.
 */
const TERRITOIRE_CN = /hong\s*kong|kowloon|taiwan|taipei|macau|macao|香港|臺灣|台灣|澳門/i;
type SignalPortoRico = 'NOM' | 'CODE' | 'LIEU' | 'AMBIGU';
function signalPortoRico(o: Offre): SignalPortoRico | undefined {
  const lieux = o.facts?.value ?? [];
  const texte = [o.loc, ...lieux.flatMap((l) => [l.label, l.city, l.region])].filter(Boolean).join(' | ');
  if (/puerto\s*rico/i.test(texte)) return 'NOM';
  if (/(?:^|[,\s-])PR(?:[\s,-]|\d|$)/.test(texte) || lieux.some((l) => /^00[679]\d\d(?:-\d{4})?$/.test(l.postalCode?.trim() ?? ''))) return 'CODE';
  if (/barceloneta|bayam[oó]n|mayag[uü]ez|montehiedra|las catalinas|(?:^|[,(|]\s*)ponce\s*,\s*(?:us|usa|united states)\b/i.test(texte)) return 'LIEU';
  if (/(?:^|[,(|]\s*)san juan\s*,\s*(?:us|usa|united states)\b/i.test(texte)) return 'AMBIGU';
  return undefined;
}
const englobantNommantTerritoire = new Map<string, number>();
/** Porto Rico sous `US`, par signal : offres, dont celles que la règle déplace. */
const portoRicoSousUS = new Map<SignalPortoRico, { offres: number; deplacees: number }>();
for (const o of offres) {
  const verdict = changementParId.get(o.id)?.basis ?? 'INCHANGÉ';
  let signal: string | undefined;
  if (o.cc === 'CN') {
    const texte = [o.loc, ...(o.facts?.value ?? []).flatMap((l) => [l.label, l.city, l.region])].filter(Boolean).join(' | ');
    signal = TERRITOIRE_CN.test(texte) ? 'NOM' : undefined;
  } else if (o.cc === 'US') {
    const pr = signalPortoRico(o);
    if (pr) {
      const compte = portoRicoSousUS.get(pr) ?? { offres: 0, deplacees: 0 };
      portoRicoSousUS.set(pr, { offres: compte.offres + 1, deplacees: compte.deplacees + (verdict === 'TERRITORY' ? 1 : 0) });
    }
    signal = pr;
  }
  if (signal) inc(englobantNommantTerritoire, `${o.cc}|${signal}|${o.k}|faits=${o.facts?.status ?? 'absents'}|${verdict}|${o.loc ?? '-'}`);
}

// ── C. Rejeu exact de la projection courante sur les RAW Jibe/Phenom/Lever/JSON-LD générique ──────
const FAMILLES_REJOUEES = ['JIBE', 'PHENOM', 'LEVER', 'GENERIC_JSONLD'];
function reconstruire(o: Offre): NormalizedJob | null {
  const raw = o.raw as Record<string, any>;
  if (!raw) return null;
  if (o.t === 'JIBE') return parseJibePage({ jobs: [{ data: raw }] }, new URL(o.u).origin)[0] ?? null;
  if (o.t === 'LEVER') return raw.id && raw.text ? parseLeverJob(raw as never, {}) : null;
  if (o.t === 'PHENOM') return raw.jobSeqNo ? parseCareerConnectJob(raw as never, new URL(o.u).origin) : parsePhenomJob(raw as never, new URL(o.u).origin);
  if (o.t === 'GENERIC_JSONLD') {
    // Seul un nœud JobPosting retenu se reconstruit ; un flux RSS (`feedItem`) ou Caudalie (`listing`) n'a pas cette forme.
    if (typeof raw.title !== 'string' || 'feedItem' in raw || 'listing' in raw) return null;
    const { catwalksPageUrl, ...node } = raw;
    return normalizeGenericPosting(node, typeof catwalksPageUrl === 'string' ? catwalksPageUrl : o.u);
  }
  return null;
}
type EcartRejeu = { id: string; source: string; externalId: string; classe: string; stocke: Array<string | null>; rejoue: Array<string | null>; marche: string };
const rejeu = new Map<string, number>(), ecartsRejeu: EcartRejeu[] = [];
for (const o of offres) {
  if (!FAMILLES_REJOUEES.includes(o.t)) continue;
  const job = reconstruire(o);
  if (!job) { inc(rejeu, `${o.t}|NON_RECONSTRUIT`); continue; }
  const facts = readSourceFacts(o.t, o.raw);
  const candidat = { ...job, location: cleanPlace(job.location), city: cleanPlace(job.city), sourceFacts: facts,
    sourceKey: o.k, sourceTier: o.st as never, company: 'rejeu', atsType: o.t as never };
  const projete = publicationJobContent(candidat, BOOTSTRAP_TAXONOMY);
  const rejoue = [projete.countryCode ?? null, projete.countryIntegrity ?? null, projete.adminArea1 ?? null];
  const identique = rejoue[0] === o.cc && rejoue[1] === o.ci && rejoue[2] === o.a1;
  const ch = changementParId.get(o.id);
  const classe = identique ? (ch ? 'IDENTIQUE_MAIS_ANNONCE_PAR_B' : 'IDENTIQUE_AU_STOCKE')
    : ch && rejoue[0] === ch.apres ? `CHANGE_PAR_${ch.basis}` : 'DIFFERENT_HORS_REGLE';
  inc(rejeu, `${o.t}|${classe}`);
  if (!identique || ch) ecartsRejeu.push({ id: o.id, source: o.k, externalId: o.x, classe, stocke: [o.cc, o.ci, o.a1], rejoue,
    marche: `${marcheDe(o.cc)} → ${marcheDe(rejoue[0])}` });
}

/**
 * Les écarts de C qui BLOQUENT : une offre que B annonce changée mais que la projection réelle laisse identique (la règle
 * n'atteint pas la chaîne d'écriture), ou un PAYS rejoué qui diffère du stocké hors de toute règle. Un écart qui ne porte
 * que sur la preuve ou la subdivision (beiersdorf, Kenya, antérieur au lot) est montré sans bloquer.
 */
const ecartsProjection = ecartsRejeu.filter((e) => e.classe === 'IDENTIQUE_MAIS_ANNONCE_PAR_B'
  || (e.classe === 'DIFFERENT_HORS_REGLE' && e.stocke[0] !== e.rejoue[0]));

const resultat = {
  garde, fraicheur, publiables, avecSignauxLus: avecGroupe,
  A_signauxContradictoires: { parSource: tableA, parType: top(contraParType), formes: top(formes), paysRetenu: top(retenu), corroboration: top(corroboration, 40), exemples: casA },
  B_verdicts: { abstenuesParD440Seule: abstenuesD440.size, reprisesParD442, parBase: top(parBase), parSource: top(parSourceB), transitions: top(transitions),
    marches: tableMarches, englobantNommantUnTerritoire: top(englobantNommantTerritoire), portoRicoSousUS: Object.fromEntries(portoRicoSousUS),
    idsParRegle: Object.fromEntries(idsParRegle), effetsAttendus: effetsAttendus.map((e) => ({ ...e, conforme: e.ecarts.length === 0 })), offres: changements },
  C_rejeuProjection: { comptes: top(rejeu), ecarts: ecartsRejeu, ecartsBloquants: ecartsProjection },
};
/** Un écart ne se lit pas, il bloque : le script le décrit, puis sort en erreur (code 4). */
const codeSortie = effetsAttendus.every((effet) => effet.ecarts.length === 0) && ecartsProjection.length === 0 ? 0 : 4;
// `exitCode`, jamais `exit()` : une sortie JSON lue par un tube serait tronquée à 64 Kio.
process.exitCode = codeSortie;
if (sortieJson) console.log(JSON.stringify(resultat, null, 2));
else imprimer();

function imprimer(): void {
  console.log(`═══ PAYS CONTRADICTOIRES — base ${String(garde.base)} · rôle ${String(garde.role)} · lecture seule ${String(garde.lectureSeule)} · ${String(garde.maintenant)} ═══`);
  console.log(`fraîcheur : Job.updatedAt max ${String(fraicheur.jobMajMax)} · JobSource.lastSeenAt max ${String(fraicheur.sourceVueMax)}`);
  console.log(`offres publiables : ${publiables} · dont familles à signaux multiples lues : ${avecGroupe}`);
  console.log('\n── A. par source (type|source : publiables · avec ≥ 2 signaux pour un même lieu · contradictoires)');
  for (const [k, v] of Object.entries(tableA)) console.log(`  ${k.padEnd(48)} ${String(v.publiables).padStart(6)} ${String(v.avecPlusieursSignaux).padStart(6)} ${String(v.contradictoires).padStart(5)}`);
  for (const [titre, table] of [['A. formes', resultat.A_signauxContradictoires.formes], ['A. pays retenu par la projection', resultat.A_signauxContradictoires.paysRetenu],
    ['A. signaux et corroboration par l’État', resultat.A_signauxContradictoires.corroboration]] as const) {
    console.log(`\n── ${titre}`); for (const [k, v] of Object.entries(table)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
  console.log(`\n── B. verdicts sur les entrées stockées : ${changements.length} offre(s) changent · D-440 seule en retirait ${abstenuesD440.size}, dont ${reprisesParD442} reprise(s) par D-442`);
  for (const [titre, table] of [['par base', resultat.B_verdicts.parBase], ['par source', resultat.B_verdicts.parSource], ['transitions (pays · marché)', resultat.B_verdicts.transitions],
    ['hors règle : offres CN ou US dont le lieu désigne un territoire (pays|signal|source|faits|verdict|Job.location)', resultat.B_verdicts.englobantNommantUnTerritoire]] as const) {
    console.log(`\n── B. ${titre}`); for (const [k, v] of Object.entries(table)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
  console.log('\n── B. Porto Rico sous US, par signal : offres · dont déplacées par la règle · restées aux États-Unis');
  for (const signal of ['NOM', 'CODE', 'LIEU', 'AMBIGU'] as const) {
    const { offres: n, deplacees } = portoRicoSousUS.get(signal) ?? { offres: 0, deplacees: 0 };
    console.log(`  ${signal.padEnd(7)} ${String(n).padStart(4)} ${String(deplacees).padStart(4)} ${String(n - deplacees).padStart(4)}`);
  }
  console.log('\n── B. marchés (offres publiables) : stocké · après D-440 seule · après D-440 + D-442 (Porto Rico compris, D-450 et D-454)');
  for (const [m, v] of Object.entries(tableMarches)) console.log(`  ${m.padEnd(14)} ${String(v.avant).padStart(6)} ${String(v.apresD440Seule).padStart(6)} ${String(v.apresD442).padStart(6)}`);
  console.log('\n── B. identifiants changés, par règle (règle|source|transition)');
  for (const [cle, ids] of [...idsParRegle].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${String(ids.length).padStart(5)}  ${cle}\n         ${[...ids].sort().join(' ')}`);
  for (const effet of effetsAttendus) {
    console.log(`\n── B. effet attendu, ${effet.nom} (${Object.entries(effet.attendu).map(([k, n]) => `${n} ${k}`).join(' · ')}) : ${effet.ecarts.length ? 'ÉCART' : 'CONFORME'}`);
    for (const e of effet.ecarts) console.log(`  ÉCART  ${e.transition} : attendu ${e.attendu}, mesuré ${e.mesure}`);
  }
  console.log('\n── B. offres');
  for (const c of changements) console.log(`  ${JSON.stringify(c)}`);
  console.log('\n── C. rejeu de la projection courante');
  for (const [k, v] of Object.entries(resultat.C_rejeuProjection.comptes)) console.log(`  ${String(v).padStart(6)}  ${k}`);
  // Toutes les offres annoncées par B d'abord, puis au plus 60 écarts hors règle (le détail complet est dans `--json`).
  const annoncees = ecartsRejeu.filter((e) => e.classe !== 'DIFFERENT_HORS_REGLE');
  for (const e of [...annoncees, ...ecartsRejeu.filter((e) => !annoncees.includes(e)).slice(0, 60)]) console.log(`  ${JSON.stringify(e)}`);
  console.log(`\n── C. écarts bloquants (annoncée par B mais inchangée, ou pays différent hors règle) : ${ecartsProjection.length}`);
  for (const e of ecartsProjection) console.log(`  ${JSON.stringify(e)}`);
  if (codeSortie) console.error('ÉCART : voir « B. effet attendu » et « C. écarts bloquants » ci-dessus.');
}

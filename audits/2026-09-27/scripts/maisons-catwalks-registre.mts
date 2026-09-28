/**
 * LES MAISONS DES OFFRES CATWALKS FACE AU REGISTRE — prémisse de D-471, mesurée avant de concevoir le rattachement
 * explicite depuis le back-office, le domaine, le logo et la source Lancel.
 *
 * ── LES QUESTIONS ────────────────────────────────────────────────────────────────────────────
 *
 *  R. Le registre que le sélecteur du back-office parcourra : combien de sociétés, combien canoniques (non fusionnées),
 *     combien avec un domaine, et d'où vient ce domaine (`domainSource`).
 *  C. Chaque Maison publique des offres Catwalks publiables (`DirectOffer.company`) : son nombre d'offres, la société
 *     rattachée par le nom (`companyId`), le domaine de cette société. Un mandat (« Catwalks ») est compté à part.
 *  P. Pour chaque Maison NON rattachée : les sociétés canoniques du registre dont le nom, OU un alias revu, contient
 *     l'un de ses mots significatifs, c'est-à-dire ce que le sélecteur proposerait (la recherche du back-office lit les
 *     alias revus : `apps/api/lib/registre.ts`), normalisés comme elle (`catwalks_normaliser_texte` : casse, accents,
 *     apostrophes), vingt au plus comme elle. Aucun rattachement n'est déduit ici. Première version du 27/09/2026 : les noms seuls, en
 *     minuscules ; les alias puis la normalisation ont été ajoutés après les audits de réconciliation du même jour.
 *  I. La forme des identifiants des sociétés canoniques : `cuid` ou UUID (prémisse de `ID_REGISTRE`, qui accepte les
 *     deux), et toute autre forme, qui serait refusée.
 *  S. Les offres Catwalks publiables qui portent un salaire (prémisse de D-472 §3, le salaire dans l'en-tête).
 *  L. Lancel au registre et dans les sources : domaine, site carrière, famille d'ATS, statut de découverte, offres.
 *  B. L'empreinte Beetween : les sociétés et les sources dont le site carrière est hébergé par Beetween
 *     (`beetween.com`, `beetween.fr`, `nous-recrutons.fr`), avec leurs offres publiables.
 *  V. Les visuels des offres Catwalks : combien en portent un, et sur quels hôtes.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Le même que `audits/2026-09-25/scripts/villes-offres-catwalks.mts` : production, rôle `catwalks_audit`, identifiants
 * hors dépôt (`~/.catwalks/audit-access.json`), jamais affichés ; transaction `READ ONLY` et garde éprouvée AVANT la
 * mesure. Des noms de sociétés et des hôtes publics, aucune personne.
 *
 *   npx tsx audits/2026-09-27/scripts/maisons-catwalks-registre.mts
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
// Offres agrégées publiables : `publicJobSql` (packages/db/availability.ts), recopiée à l'identique.
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;
// Offres directes publiables : `directPubliable` (apps/api/lib/direct-offers.ts).
const DIRECTE = `d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ${MAINTENANT})`;
const BEETWEEN = `~* '(beetween\\.(com|fr)|nous-recrutons\\.fr)'`;
// Les mots d'un nom de Maison qui ne désignent rien à eux seuls.
const VIDES = `ARRAY['la','le','les','de','du','des','d','l','et','maison','clinic','parfums','paris','atelier']`;

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || jsonb_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
SELECT 'R' || E'\\t' || jsonb_build_object('societes', count(*), 'canoniques', count(*) FILTER (WHERE "mergedIntoId" IS NULL),
  'canoniquesAvecDomaine', count(*) FILTER (WHERE "mergedIntoId" IS NULL AND domain IS NOT NULL),
  'parSourceDeDomaine', (SELECT jsonb_object_agg(s.src, s.n) FROM (SELECT coalesce("domainSource", '(aucun)') AS src, count(*) AS n
    FROM "Company" WHERE "mergedIntoId" IS NULL AND domain IS NOT NULL GROUP BY 1) s))::text
FROM "Company";
SELECT 'C' || E'\\t' || jsonb_build_object('maison', d.company, 'offres', count(*), 'rattachee', d."companyId" IS NOT NULL,
  'societe', c.name, 'domaine', c.domain, 'sourceDomaine', c."domainSource")::text
FROM "DirectOffer" d LEFT JOIN "Company" c ON c.id = d."companyId"
WHERE ${DIRECTE} GROUP BY d.company, d."companyId", c.name, c.domain, c."domainSource" ORDER BY count(*) DESC, d.company;
WITH non AS (SELECT DISTINCT d.company FROM "DirectOffer" d WHERE ${DIRECTE} AND d."companyId" IS NULL AND d.company <> 'Catwalks'),
mots AS (SELECT non.company, m FROM non, regexp_split_to_table(catwalks_normaliser_texte(non.company), '[^[:alnum:]]+') m
  WHERE length(m) >= 3 AND NOT (m = ANY(${VIDES})))
SELECT 'P' || E'\\t' || jsonb_build_object('maison', mots.company, 'mot', mots.m, 'candidats', (SELECT jsonb_agg(x) FROM (
  SELECT c.name, c.domain, (SELECT count(*) FROM "Job" j WHERE j."companyId" = c.id AND ${PUBLIABLE}) AS offres
  FROM "Company" c WHERE c."mergedIntoId" IS NULL AND (catwalks_normaliser_texte(c.name) LIKE '%' || mots.m || '%'
    OR EXISTS (SELECT 1 FROM "CompanyAlias" a WHERE a."companyId" = c.id AND a."reviewId" IS NOT NULL
      AND catwalks_normaliser_texte(a."displayName") LIKE '%' || mots.m || '%'))
  ORDER BY length(c.name) LIMIT 20) x))::text
FROM mots ORDER BY mots.company, mots.m;
SELECT 'I' || E'\\t' || jsonb_build_object('canoniques', count(*),
  'cuid', count(*) FILTER (WHERE id ~ '^[a-z0-9]{8,40}$'),
  'uuid', count(*) FILTER (WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  'autre', count(*) FILTER (WHERE id !~ '^(?:[a-z0-9]{8,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'))::text
FROM "Company" WHERE "mergedIntoId" IS NULL;
SELECT 'S' || E'\\t' || jsonb_build_object('offres', count(*),
  'avecSalaire', count(*) FILTER (WHERE d."salaryMin" IS NOT NULL OR d."salaryMax" IS NOT NULL))::text
FROM "DirectOffer" d WHERE ${DIRECTE};
SELECT 'L' || E'\\t' || jsonb_build_object('societe', c.name, 'fusionnee', c."mergedIntoId" IS NOT NULL, 'domaine', c.domain,
  'sourceDomaine', c."domainSource", 'siteCarriere', c."careersUrl", 'ats', c."atsType", 'decouverte', c."discoveryStatus",
  'noteDecouverte', left(c."discoveryNote", 300),
  'offresPubliables', (SELECT count(*) FROM "Job" j WHERE j."companyId" = c.id AND ${PUBLIABLE}),
  'offresTotal', (SELECT count(*) FROM "Job" j WHERE j."companyId" = c.id))::text
FROM "Company" c WHERE lower(c.name) LIKE 'lancel%';
SELECT 'LS' || E'\\t' || jsonb_build_object('cle', s.key, 'maison', s.maison, 'famille', s.kind, 'statut', s.status,
  'domaine', s."careersDomain", 'dernierPassage', s."lastRunStatus", 'offres', s."lastRunJobs")::text
FROM "Source" s WHERE lower(s.maison) LIKE '%lancel%' OR s."careersDomain" ${BEETWEEN} OR s.config::text ${BEETWEEN};
SELECT 'B' || E'\\t' || jsonb_build_object('societe', c.name, 'siteCarriere', c."careersUrl", 'ats', c."atsType",
  'decouverte', c."discoveryStatus",
  'offresPubliables', (SELECT count(*) FROM "Job" j WHERE j."companyId" = c.id AND ${PUBLIABLE}))::text
FROM "Company" c WHERE c."mergedIntoId" IS NULL AND c."careersUrl" ${BEETWEEN} ORDER BY c.name;
SELECT 'V' || E'\\t' || jsonb_build_object('offres', count(*), 'avecVisuel', count(*) FILTER (WHERE d.visuel IS NOT NULL),
  'hotes', (SELECT jsonb_object_agg(h.hote, h.n) FROM (SELECT coalesce(substring(d2.visuel from '^https?://([^/]+)'), '(aucun)') AS hote,
    count(*) AS n FROM "DirectOffer" d2 WHERE ${DIRECTE.replaceAll('d.', 'd2.')} GROUP BY 1) h))::text
FROM "DirectOffer" d WHERE ${DIRECTE};
\\else
SELECT 'REFUS' || E'\\t' || 'garde';
\\endif
ROLLBACK;
`;

// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'maisons-catwalks-registre' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');

console.log(`garde ${JSON.stringify(garde)}`);
const TITRES: Record<string, string> = {
  R: 'registre', C: 'Maison des offres Catwalks', P: 'candidats du sélecteur pour une Maison non rattachée', L: 'Lancel au registre',
  LS: 'source Lancel ou Beetween', B: 'société au site carrière Beetween', V: 'visuels des offres Catwalks',
  I: 'forme des identifiants du registre', S: 'salaire des offres Catwalks',
};
for (const [type, valeur] of lignes) if (TITRES[type]) console.log(`${TITRES[type]}\t${valeur}`);
for (const type of ['R', 'C', 'L', 'V', 'I', 'S']) if (!lignes.some(([t]) => t === type)) refus(`mesure ${type} absente`);

/**
 * EXPORT DES INTITULÉS D'OFFRES POUR LA TAXONOMIE v3 (D-475 lot 2, sous-lot 2A ; plan §3.1-§3.2).
 *
 * La première passe de curation mesure quels métiers nos offres portent vraiment : pour chaque intitulé distinct des
 * offres publiables (intitulé brut en minuscules), son nombre d'offres, d'employeurs et de sources distincts (et leurs
 * identifiants internes, pour compter les employeurs distincts d'un GROUPE d'intitulés sans les additionner ; les noms des
 * employeurs et les services les plus fréquents, qui lèvent l'ambiguïté d'un intitulé), ses pays,
 * et sa classification actuelle : nombre d'offres par statut et par code de métier. Aucune donnée personnelle : des
 * intitulés d'offres publiques.
 *
 * Correction du 28/09/2026 : la première version comptait les statuts par une fenêtre calculée sur UNE ligne (chaque
 * statut valait 1) et ne comptait pas les sources ; les comptes sont désormais agrégés par intitulé, et un contrôle
 * vérifie que la somme des statuts égale le nombre d'offres.
 *
 * Accès et garde : ceux de `audits/2026-09-28/scripts/rattachement-metier-offres.mts` (rôle `catwalks_audit`,
 * identifiants hors dépôt jamais affichés, transaction `READ ONLY`, garde éprouvée AVANT toute lecture).
 * Sortie : `audits/2026-09-28/curation-v3/entrees/intitules-offres-<date>.json.gz` (entrée datée de la passe de
 * curation, sans secret).
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/exporter-intitules-offres.mts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;
const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
\\if :garde_ok
SELECT 'G' || E'\\t' || json_build_object('maintenant', now())::text;
WITH o AS (
  SELECT lower(trim(coalesce(j."rawTitle", j.title))) AS intitule, j."companyId" AS employeur, j."countryCode" AS pays,
         nullif(trim(j.department), '') AS service,
         j."occupationStatus"::text AS statut, j."occupationCode" AS code,
         (SELECT array_agg(DISTINCT a."sourceKey") FROM "JobSource" a WHERE a."jobId" = j.id AND a."isActive"
            AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT})) AS sources
  FROM "Job" j WHERE ${PUBLIABLE}
), st AS (
  SELECT intitule, json_object_agg(statut, n) AS statuts FROM (SELECT intitule, statut, count(*) AS n FROM o GROUP BY 1, 2) x GROUP BY 1
), co AS (
  SELECT intitule, json_object_agg(code, n) AS codes FROM (SELECT intitule, code, count(*) AS n FROM o WHERE code IS NOT NULL GROUP BY 1, 2) x GROUP BY 1
), so AS (
  SELECT intitule, count(DISTINCT s) AS sources, array_agg(DISTINCT s) AS cles FROM o CROSS JOIN LATERAL unnest(o.sources) s GROUP BY 1
), noms AS (
  -- Les employeurs et les services les plus fréquents d'un intitulé : c'est eux qui lèvent l'ambiguïté (« dispenser »
  -- chez Boots est préparateur en pharmacie ; « general manager » chez Foot Locker dirige un magasin).
  SELECT intitule, (array_agg(nom ORDER BY n DESC))[1:5] AS employeurs_noms FROM (
    SELECT o.intitule, c.name AS nom, count(*) AS n FROM o JOIN "Company" c ON c.id = o.employeur GROUP BY 1, 2) x GROUP BY 1
), svc AS (
  SELECT intitule, (array_agg(service ORDER BY n DESC))[1:3] AS services FROM (
    SELECT intitule, service, count(*) AS n FROM o WHERE service IS NOT NULL GROUP BY 1, 2) x GROUP BY 1
), base AS (
  SELECT intitule, count(*) AS offres, count(DISTINCT employeur) AS employeurs,
         array_agg(DISTINCT employeur) FILTER (WHERE employeur IS NOT NULL) AS employeurs_ids,
         array_agg(DISTINCT pays) FILTER (WHERE pays IS NOT NULL) AS pays FROM o GROUP BY 1
)
SELECT 'I' || E'\\t' || json_build_object('intitule', b.intitule, 'offres', b.offres, 'employeurs', b.employeurs,
  'sources', coalesce(so.sources, 0), 'employeursIds', coalesce(b.employeurs_ids, '{}'), 'employeursNoms', coalesce(noms.employeurs_noms, '{}'), 'services', coalesce(svc.services, '{}'), 'sourcesCles', coalesce(so.cles, '{}'), 'pays', coalesce(b.pays, '{}'), 'statuts', st.statuts, 'codes', coalesce(co.codes, '{}'::json))::text
FROM base b LEFT JOIN st USING (intitule) LEFT JOIN co USING (intitule) LEFT JOIN so USING (intitule)
  LEFT JOIN noms USING (intitule) LEFT JOIN svc USING (intitule);
\\else
SELECT 'REFUS' || E'\\t' || 'garde';
\\endif
ROLLBACK;
`;
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, maxBuffer: 512 * 1024 * 1024,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'exporter-intitules-offres' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde) refus('garde absente');
const intitules = lignes.filter(([t]) => t === 'I').map(([, v]) => JSON.parse(v));
const offres = intitules.reduce((n, x) => n + x.offres, 0);
const somme = (o: Record<string, number>) => Object.values(o ?? {}).reduce((n, v) => n + v, 0);
const incoherents = intitules.filter((x) => somme(x.statuts) !== x.offres).length;
if (incoherents) refus(`${incoherents} intitulé(s) dont les statuts ne somment pas au nombre d'offres`);
const date = String(garde.maintenant).slice(0, 10);
const dossier = fileURLToPath(new URL('../../../../audits/2026-09-28/curation-v3/entrees/', import.meta.url));
mkdirSync(dossier, { recursive: true });
const octets = gzipSync(Buffer.from(JSON.stringify({ source: 'catalogue, offres publiables (lecture seule)', exporteLe: garde.maintenant, offres, intitules })));
writeFileSync(`${dossier}intitules-offres-${date}.json.gz`, octets);
console.log(JSON.stringify({ fichier: `audits/2026-09-28/curation-v3/entrees/intitules-offres-${date}.json.gz`, sha256: createHash('sha256').update(octets).digest('hex'),
  intitulesDistincts: intitules.length, offres }, null, 1));

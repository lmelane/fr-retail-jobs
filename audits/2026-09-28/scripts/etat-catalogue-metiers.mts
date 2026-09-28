/**
 * ÉTAT DU CATALOGUE DES MÉTIERS EN PRODUCTION (D-475, conception du lot 2, 28/09/2026).
 *
 * Quelle version de la classification est active, que contient-elle, et la file de l'index de recherche est-elle
 * vide ? Le fichier du dépôt (`packages/db/data/occupations-v1.json`) ne publie rien par lui-même : seule la base
 * dit ce qui est servi.
 *
 * Population, accès et garde : ceux de `preferences-couverture-par-marche.mts` (rôle `catwalks_audit`, identifiants
 * hors dépôt jamais affichés, transaction `READ ONLY`, garde éprouvée AVANT toute mesure).
 *
 *   npx tsx audits/2026-09-28/scripts/etat-catalogue-metiers.mts
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
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
SELECT 'R' || E'\\t' || json_build_object('id', r.id, 'creeLe', r."createdAt", 'octets', pg_column_size(r.manifest),
  'metiers', jsonb_array_length(r.manifest->'occupations'), 'familles', jsonb_array_length(r.manifest->'families'), 'domaines', jsonb_array_length(r.manifest->'groups'),
  'regles', jsonb_array_length(r.manifest->'rules'), 'active', r.id = s."releaseId")::text
FROM "OccupationRelease" r CROSS JOIN "OccupationState" s ORDER BY r."createdAt";
SELECT 'E' || E'\\t' || json_build_object('releaseId', "releaseId", 'majLe', "updatedAt", 'rattrapeLe', "backfilledAt")::text FROM "OccupationState";
SELECT 'F' || E'\\t' || json_build_object('generation', version, 'enAttente', count(*), 'plusAncien', min("queuedAt"))::text
FROM "SearchPending" GROUP BY version ORDER BY version;
SELECT 'D' || E'\\t' || json_build_object('offresCatwalks', count(*), 'sansCode', count(*) FILTER (WHERE "occupationCode" IS NULL))::text FROM "DirectOffer";
SELECT 'A' || E'\\t' || json_build_object('alias', v.alias, 'metiers', v.cles)::text FROM (
  SELECT lower(al) AS alias, json_agg(DISTINCT o->>'key') AS cles
  FROM "OccupationRelease" r JOIN "OccupationState" st ON st."releaseId" = r.id,
       jsonb_array_elements(r.manifest->'occupations') o, jsonb_array_elements_text(coalesce(o->'aliases', '[]'::jsonb)) al
  GROUP BY lower(al) HAVING count(DISTINCT o->>'key') > 1) v;
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
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'etat-catalogue-metiers' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');
console.log(`garde ${JSON.stringify(garde)}`);
for (const [t, v] of lignes) {
  if (t === 'R') console.log(`version\t${v}`);
  if (t === 'E') console.log(`pointeur actif\t${v}`);
  if (t === 'F') console.log(`file de l'index de recherche\t${v}`);
  if (t === 'D') console.log(`offres Catwalks\t${v}`);
  if (t === 'A') console.log(`variante portée par plusieurs métiers (version active)\t${v}`);
}

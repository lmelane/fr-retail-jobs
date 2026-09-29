/**
 * EXPORT DES OFFRES POUR LA PREVIEW DE LA TAXONOMIE v3 (étape 6 de la passe de curation ; plan
 * `docs/architecture/classification-metiers.md` §3.2 : « preview sur le corpus réel »).
 *
 * Pour chaque couple (intitulé brut, service) des offres publiables : le nombre d'offres, leurs pays et leur classement
 * actuel (statut, code), de quoi reclasser chaque couple par la version servie et par la v3 avec le moteur réel.
 * Aucune donnée personnelle : des intitulés et services d'offres publiques.
 *
 * Accès et garde : ceux de `exporter-intitules-offres.mts` (rôle `catwalks_audit`, identifiants hors dépôt jamais
 * affichés, transaction `READ ONLY`, garde éprouvée AVANT toute lecture).
 * Sortie : `audits/2026-09-28/curation-v3/entrees/offres-preview-<date>.json.gz`.
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/exporter-offres-preview.mts
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
SELECT 'I' || E'\\t' || json_build_object('titre', t, 'service', d, 'code', c, 'statut', s, 'offres', n, 'pays', p)::text FROM (
  SELECT coalesce(j."rawTitle", j.title) AS t, j.department AS d, j."occupationCode" AS c, j."occupationStatus"::text AS s, count(*) AS n,
         array_agg(DISTINCT j."countryCode") FILTER (WHERE j."countryCode" IS NOT NULL) AS p
  FROM "Job" j WHERE ${PUBLIABLE} GROUP BY 1, 2, 3, 4) x;
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
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'exporter-offres-preview' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde) refus('garde absente');
const couples = lignes.filter(([t]) => t === 'I').map(([, v]) => JSON.parse(v));
const offres = couples.reduce((n, x) => n + x.offres, 0);
const date = String(garde.maintenant).slice(0, 10);
const dossier = fileURLToPath(new URL('../../../../audits/2026-09-28/curation-v3/entrees/', import.meta.url));
mkdirSync(dossier, { recursive: true });
const octets = gzipSync(Buffer.from(JSON.stringify({ source: 'catalogue, offres publiables (lecture seule)', exporteLe: garde.maintenant, offres, couples })));
writeFileSync(`${dossier}offres-preview-${date}.json.gz`, octets);
console.log(JSON.stringify({ fichier: `audits/2026-09-28/curation-v3/entrees/offres-preview-${date}.json.gz`, sha256: createHash('sha256').update(octets).digest('hex'),
  couples: couples.length, offres }, null, 1));

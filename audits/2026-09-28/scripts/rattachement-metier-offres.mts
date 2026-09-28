/**
 * RATTACHEMENT DES OFFRES À UN MÉTIER DU CATALOGUE (D-475, écarts de R-140, 28/09/2026).
 *
 * Sur les offres publiables : combien portent un métier précis (`occupationCode`), et la répartition de
 * `occupationStatus`. Le chiffre « 47 % » cité le 28/09 venait d'un rapport de lecture, jamais recompté : ce script
 * le remplace. Les intitulés distincts se comptent ici sur `lower(rawTitle ou title)` : définition différente de
 * `scripts/preuve-pivot-metiers-2026-09-28/8-volume.mjs` du backend (41 049).
 *
 * Population, accès et garde : ceux de `preferences-couverture-par-marche.mts` (rôle `catwalks_audit`, identifiants
 * hors dépôt jamais affichés, transaction `READ ONLY`, garde éprouvée AVANT toute mesure).
 *
 *   npx tsx audits/2026-09-28/scripts/rattachement-metier-offres.mts
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
SELECT 'T' || E'\\t' || json_build_object('publiables', count(*),
  'avecMetier', count(j."occupationCode"),
  'intitulesDistincts', count(DISTINCT lower(coalesce(j."rawTitle", j.title))))::text
FROM "Job" j WHERE ${PUBLIABLE};
SELECT 'S' || E'\\t' || json_build_object('statut', j."occupationStatus", 'offres', count(*),
  'avecMetier', count(j."occupationCode"))::text
FROM "Job" j WHERE ${PUBLIABLE} GROUP BY j."occupationStatus" ORDER BY count(*) DESC;
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
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'rattachement-metier' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');
const total = JSON.parse(lignes.find(([t]) => t === 'T')![1]);
const pct = (n: number) => `${((100 * n) / total.publiables).toFixed(1)} %`;
console.log(`garde ${JSON.stringify(garde)}`);
console.log(`publiables ${total.publiables} · avec un métier précis ${total.avecMetier} (${pct(total.avecMetier)}) · intitulés distincts ${total.intitulesDistincts}`);
for (const [, v] of lignes.filter(([t]) => t === 'S')) {
  const s = JSON.parse(v);
  console.log(`statut ${s.statut}\t${s.offres} (${pct(s.offres)})\tavec métier ${s.avecMetier}`);
}

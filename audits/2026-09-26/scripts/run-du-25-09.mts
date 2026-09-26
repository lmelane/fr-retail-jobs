/**
 * LE RUN DE 18 H DU 25/09/2026, PREMIER APRÈS LA LIVRAISON DE `1e1ad4c` — lu en base avant la mise en production de
 * D-444 (D-468 §4 : « après vérification de la collecte de ce soir »).
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * Le reçu de release (`docs/operations/railway/runtime-release.json`, `productionChecks.firstRunAfterRelease`) attend
 * l'observation du premier RUN planifié après la livraison. Ce RUN a-t-il tourné sur la révision livrée, s'est-il
 * terminé, avec quel statut, combien de sources par issue, et quels événements d'avertissement ou d'erreur ?
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Les `PipelineRun` démarrés le 25/09/2026 entre 15:30 et 18:00 UTC (le CRON est `0 16,17 * * *` UTC, un seul passage
 * réel par jour, à 18 h de Paris) et le suivant éventuel ; leurs `SourceRun` (`runId`) et leurs `PipelineEvent`. Aucune
 * personne : des sources, des statuts et des comptes.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Production, rôle `catwalks_audit`, identifiants hors dépôt (`~/.catwalks/audit-access.json`), jamais affichés ;
 * transaction `READ ONLY` et garde éprouvée AVANT la mesure.
 *
 *   npx tsx audits/2026-09-26/scripts/run-du-25-09.mts
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

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
WITH runs AS (
  SELECT r.* FROM "PipelineRun" r
  WHERE r."startedAt" >= '2026-09-25 15:30:00' AND r."startedAt" < '2026-09-26 12:00:00'
)
SELECT 'R' || E'\\t' || json_build_object('id', r.id, 'command', r.command, 'revision', r.revision, 'status', r.status,
  'startedAt', r."startedAt", 'finishedAt', r."finishedAt",
  'sourceRuns', (SELECT json_object_agg(s.status, s.n) FROM (SELECT status, count(*) AS n FROM "SourceRun" WHERE "runId" = r.id GROUP BY 1) s),
  'evenements', (SELECT json_object_agg(e.cle, e.n) FROM (SELECT level || ' ' || event AS cle, count(*) AS n FROM "PipelineEvent"
     WHERE "runId" = r.id AND level IN ('warn', 'error', 'fatal') GROUP BY 1 ORDER BY 2 DESC LIMIT 40) e),
  'metricsCles', (SELECT json_agg(k) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(r.metrics::jsonb) = 'object' THEN r.metrics::jsonb ELSE '{}'::jsonb END) k)
)::text
FROM runs r ORDER BY r."startedAt";
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
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'run-du-25-09' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');
console.log(`garde ${JSON.stringify(garde)}`);
for (const [t, v] of lignes) if (t === 'R') console.log(JSON.stringify(JSON.parse(v), null, 1));

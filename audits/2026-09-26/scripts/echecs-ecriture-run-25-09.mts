/**
 * LES 1 438 `job.write_failed` DU RUN DU 25/09/2026 (`02ce57f9`, révision `1e1ad4c`) — lus en base, lecture seule,
 * avant la mise en production de D-444 : quelle erreur, sur quelles sources, depuis quand.
 *
 * Accès : production, rôle `catwalks_audit`, identifiants hors dépôt, jamais affichés ; transaction READ ONLY et
 * garde éprouvée avant la mesure. Aucune personne : des sources, des messages d'erreur et des comptes.
 *
 *   npx tsx audits/2026-09-26/scripts/echecs-ecriture-run-25-09.mts
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const RUN = '02ce57f9-42d5-4f89-bc47-24e6a05fc817';
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
-- Les clés du payload, pour savoir où se trouve le message d'erreur.
SELECT 'K' || E'\\t' || json_build_object('cles', (SELECT json_agg(DISTINCT k) FROM "PipelineEvent" e, jsonb_object_keys(e.payload::jsonb) k
  WHERE e."runId" = '${RUN}' AND e.event = 'job.write_failed'))::text;
-- Par source, avec un exemple de payload tronqué.
SELECT 'S' || E'\\t' || json_build_object('source', coalesce(e."sourceKey", '?'), 'n', count(*),
  'exemple', left((array_agg(e.payload::text ORDER BY e.at))[1], 700), 'premier', min(e.at), 'dernier', max(e.at))::text
FROM "PipelineEvent" e WHERE e."runId" = '${RUN}' AND e.event = 'job.write_failed' GROUP BY e."sourceKey" ORDER BY count(*) DESC LIMIT 25;
-- Les mêmes échecs les jours précédents : nouveau avec la livraison, ou ancien ?
SELECT 'H' || E'\\t' || json_build_object('jour', to_char(r."startedAt", 'YYYY-MM-DD'), 'revision', left(coalesce(r.revision, '?'), 7), 'run', left(r.id, 8),
  'writeFailed', (SELECT count(*) FROM "PipelineEvent" e WHERE e."runId" = r.id AND e.event = 'job.write_failed'))::text
FROM "PipelineRun" r WHERE r.command = 'ingest-all' AND r."startedAt" >= '2026-09-18' ORDER BY r."startedAt";
\\else
SELECT 'REFUS' || E'\\t' || 'garde';
\\endif
ROLLBACK;
`;

const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=60000', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'echecs-ecriture-run' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');
console.log(`garde ${JSON.stringify(garde)}`);
for (const [t, v] of lignes) if (t !== 'G') console.log(t, v);

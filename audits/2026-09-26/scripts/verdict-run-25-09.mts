/**
 * POURQUOI LE RUN DU 25/09/2026 (`02ce57f9`, `1e1ad4c`) CONCLUT EN ÉCHEC, ET CE QUE LA LIVRAISON Y A CHANGÉ — lecture
 * seule : le payload de `command.failed` et `run.completed`, les issues de source comparées au RUN du 24/09 (`35ba463f`,
 * `2cc91d8`), et les offres publiables par pays pour les reclassements livrés (D-442, D-450 Porto Rico, D-454).
 *
 * Accès : production, rôle `catwalks_audit`, identifiants hors dépôt, jamais affichés ; transaction READ ONLY et garde
 * éprouvée avant la mesure. Aucune personne.
 *
 *   npx tsx audits/2026-09-26/scripts/verdict-run-25-09.mts
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const RUN = '02ce57f9-42d5-4f89-bc47-24e6a05fc817';
const VEILLE = '35ba463f';
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
SELECT 'F' || E'\\t' || json_build_object('event', e.event, 'payload', left(e.payload::text, 2500))::text
FROM "PipelineEvent" e WHERE e."runId" = '${RUN}' AND e.event IN ('command.failed', 'run.completed') ORDER BY e.at;
SELECT 'I' || E'\\t' || json_build_object('run', left(r.id, 8), 'revision', left(r.revision, 7), 'status', r.status,
  'issues', (SELECT json_object_agg(s.status, s.n) FROM (SELECT status, count(*) AS n FROM "SourceRun" WHERE "runId" = r.id GROUP BY 1) s),
  'classees', (SELECT count(*) FROM "PipelineEvent" e WHERE e."runId" = r.id AND e.event = 'source.issue_classified'),
  'retenues', (SELECT count(*) FROM "PipelineEvent" e WHERE e."runId" = r.id AND e.event = 'job.publication_held'))::text
FROM "PipelineRun" r WHERE r.id = '${RUN}' OR r.id LIKE '${VEILLE}%' ORDER BY r."startedAt";
SELECT 'C' || E'\\t' || json_build_object('classement', c.classement, 'bloquant', c.bloquant, 'n', c.n)::text FROM (
  SELECT coalesce(e.payload::jsonb->>'classification', e.payload::jsonb->>'kind', e.payload::jsonb->>'issue', '?') AS classement,
    coalesce(e.payload::jsonb->>'blocking', e.payload::jsonb->>'bloquant', '?') AS bloquant, count(*) AS n
  FROM "PipelineEvent" e WHERE e."runId" = '${RUN}' AND e.event = 'source.issue_classified' GROUP BY 1, 2) c ORDER BY c.n DESC;
SELECT 'X' || E'\\t' || json_build_object('exemple', left(e.payload::text, 600))::text
FROM "PipelineEvent" e WHERE e."runId" = '${RUN}' AND e.event = 'source.issue_classified' ORDER BY e.at LIMIT 2;
SELECT 'P' || E'\\t' || json_build_object('pays', j."countryCode", 'publiables', count(*))::text
FROM "Job" j WHERE ${PUBLIABLE} AND j."countryCode" IN ('PR', 'HK', 'TW', 'CN', 'US', 'MC') GROUP BY j."countryCode" ORDER BY 1;
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
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=90000', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'verdict-run-25-09' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const lignes = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (lignes.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(lignes.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');
console.log(`garde ${JSON.stringify(garde)}`);
for (const [t, v] of lignes) if (t !== 'G') console.log(t, v);

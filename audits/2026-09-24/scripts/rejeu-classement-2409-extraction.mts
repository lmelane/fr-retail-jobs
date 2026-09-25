/**
 * EXTRACTION DU RUN DU 24/09/2026 POUR LE REJEU DE SON CLASSEMENT (runId 35ba463f, image 2cc91d8).
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * Qu'aurait rendu ce RUN sous les règles de D-453 §1 ? Le rejeu (`rejeu-classement-2409.mts`) le
 * recalcule hors base, avec le code réel ; cette extraction lui fournit, en lecture seule, tout ce
 * que le RUN a enregistré et rien d'autre :
 *   · SourceRun de chaque source du RUN, et la référence de la garde de la preuve négative : le dernier
 *     SourceRun, antérieur au RUN, d'un RUN COMPLET (qui a émis `sectors.qualification`, voir
 *     `FULL_RUN_MARKER` dans `health.ts`) où la source a été collectée — jamais un run ciblé ou canari ;
 *   · les IngestStats du RUN (`source_sync_completed`), les retenues par motif (`job.publication_held`),
 *     les classements et exceptions enregistrés (`source.issue_classified`, `source.failed`) et le bilan
 *     (`ingest.completed`) ;
 *   · pour chaque source dont le RUN a enregistré `complete: false`, la preuve d'énumération SCELLÉE de
 *     la collecte ingérée (manifeste de capture, décompressé ici) : `issues`, `blockers`, motifs des lignes
 *     rejetées, identifiants des sorties.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Le même que `volume-par-marche.mts` : production, rôle `catwalks_audit`, identifiants hors dépôt
 * (`~/.catwalks/audit-access.json`), jamais affichés ; `psql` reçoit les identifiants par son
 * environnement (aucune URL de base dans un argument) ; transaction `READ ONLY` et garde éprouvée AVANT
 * toute mesure, sinon rien ne s'exécute ; toujours ROLLBACK.
 *
 * La sortie ne contient aucun secret : des compteurs, des motifs, des identifiants d'offres publics et
 * les messages d'erreur enregistrés (URL publiques des sites carrière).
 *
 *   npx tsx audits/2026-09-24/scripts/rejeu-classement-2409-extraction.mts <sortie.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { gunzipSync } from 'node:zlib';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const sortie = process.argv[2] ?? refus('fichier de sortie requis');
const RUN = '35ba463f-6e8b-4e38-91dd-ced59b51281d';
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

const ligne = (tag: string, json: string, reste: string) => `SELECT '${tag}' || E'\\t' || (${json})::text\n${reste};`;
const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
${ligne('SR', `json_build_object('source', s."sourceKey", 'status', s.status, 'jobs', s.jobs, 'previous', s."previousJobs",
  'fetched', s.fetched, 'accepted', s.accepted, 'declaredTotal', s."declaredTotal", 'truncated', s.truncated, 'errors', s.errors,
  'canAttestAbsence', s."canAttestAbsence", 'complete', s.complete, 'ranAt', s."ranAt")`,
  `FROM "SourceRun" s WHERE s."runId" = '${RUN}'`)}
${ligne('PR', `json_build_object('source', s."sourceKey", 'fetched', p.fetched, 'accepted', p.accepted, 'jobs', p.jobs, 'ranAt', p."ranAt", 'run', p."runId")`,
  `FROM "SourceRun" s JOIN LATERAL (SELECT q.fetched, q.accepted, q.jobs, q."ranAt", q."runId" FROM "SourceRun" q
     WHERE q."sourceKey" = s."sourceKey" AND q."ranAt" < s."ranAt" AND q.fetched > 0 AND q.accepted IS NOT NULL
       AND EXISTS (SELECT 1 FROM "PipelineEvent" m WHERE m."runId" = q."runId" AND m.event = 'sectors.qualification')
     ORDER BY q."ranAt" DESC LIMIT 1) p ON true
   WHERE s."runId" = '${RUN}'`)}
${ligne('SC', `json_build_object('source', e."sourceKey", 'stat', ((e.payload->'stats'->0) - 'occupationStatuses') - 'occupationReleases')`,
  `FROM "PipelineEvent" e WHERE e."runId" = '${RUN}' AND e.event = 'source_sync_completed'`)}
${ligne('PH', `json_build_object('source', e."sourceKey", 'reason', e.payload->>'reason', 'n', count(*))`,
  `FROM "PipelineEvent" e WHERE e."runId" = '${RUN}' AND e.event = 'job.publication_held' GROUP BY e."sourceKey", e.payload->>'reason'`)}
${ligne('EV', `json_build_object('event', e.event, 'source', e."sourceKey", 'at', e.at, 'payload', e.payload)`,
  `FROM "PipelineEvent" e WHERE e."runId" = '${RUN}' AND e.event IN ('source.issue_classified', 'source.failed', 'ingest.completed')`)}
${ligne('ST', `json_build_object('source', s.key, 'kind', s.kind)`, `FROM "Source" s`)}
${ligne('MF', `json_build_object('source', e."sourceKey", 'batch', o."batchId", 'gzip', encode(g.gzip, 'base64'))`,
  `FROM "PipelineEvent" e
   JOIN "CaptureOutcome" o ON o."batchId"::text = e.payload->'stats'->0->>'captureBatchId'
   JOIN "RawBlobBody" g ON g.hash = o."manifestHash"
   WHERE e."runId" = '${RUN}' AND e.event = 'source_sync_completed' AND e.payload->'stats'->0->>'complete' = 'false'`)}
\\else
SELECT 'REFUS' || E'\\t' || '"garde"';
\\endif
ROLLBACK;
`;

// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'rejeu-classement-2409-extraction' },
  encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024,
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim().slice(0, 2000)}`);
const parTag = new Map<string, unknown[]>();
for (const brute of run.stdout.split('\n')) {
  const i = brute.indexOf('\t');
  if (i < 0) continue;
  const tag = brute.slice(0, i);
  parTag.set(tag, [...(parTag.get(tag) ?? []), JSON.parse(brute.slice(i + 1))]);
}
if (parTag.has('REFUS')) refus('garde non satisfaite');
const garde = parTag.get('G')?.[0] as Record<string, unknown> | undefined;
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');

/** The sealed enumeration evidence of each ingested collection whose `complete` was false, decoded. */
type Manifest = { metadata?: { complete?: boolean; truncated?: boolean; declaredTotal?: number;
  enumeration?: { issues?: string[]; blockers?: string[] }; rejectedRows?: { reason: string }[] }; outputs?: { externalId: string | null }[] };
const manifestes = (parTag.get('MF') ?? []).map((row) => {
  const { source, batch, gzip } = row as { source: string; batch: string; gzip: string };
  const manifest = JSON.parse(gunzipSync(Buffer.from(gzip, 'base64')).toString('utf8')) as Manifest;
  const m = manifest.metadata ?? {};
  return { source, batch, complete: m.complete ?? null, truncated: m.truncated ?? null, declaredTotal: m.declaredTotal ?? null,
    issues: m.enumeration?.issues ?? [], blockers: m.enumeration?.blockers ?? [], rejectedReasons: (m.rejectedRows ?? []).map((r) => r.reason),
    externalIds: (manifest.outputs ?? []).map((o) => o.externalId) };
});
const sc = (parTag.get('SC') ?? []) as { source: string; stat: { complete?: boolean } }[];
const attendus = sc.filter((row) => row.stat.complete === false).map((row) => row.source).sort();
const trouves = manifestes.map((m) => m.source).sort();
if (JSON.stringify(attendus) !== JSON.stringify(trouves)) refus(`manifestes manquants : attendus ${attendus.join(',')} ; trouvés ${trouves.join(',')}`);

const extraction = { run: RUN, garde, SR: parTag.get('SR') ?? [], PR: parTag.get('PR') ?? [], SC: sc, PH: parTag.get('PH') ?? [],
  EV: parTag.get('EV') ?? [], ST: parTag.get('ST') ?? [], MF: manifestes };
writeFileSync(sortie, JSON.stringify(extraction));
console.log(JSON.stringify({ garde, lignes: Object.fromEntries(Object.entries(extraction).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])) }));

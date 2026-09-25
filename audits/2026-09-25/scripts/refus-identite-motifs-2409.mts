/**
 * LES MOTIFS DES REFUS D'IDENTITÉ DU RUN DU 24/09/2026 (runId 35ba463f), PAR SOURCE.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * L'alerte ne disait des refus d'identité que « N erreurs de collecte ou d'écriture ». Elle nomme désormais leur
 * cause en clair depuis les codes bornés du rapport scellé (`writeFailures`, `health.ts`). Le RUN du 24/09 n'avait
 * pas ce compteur : quels motifs (`MOTIFS_IDENTITE`, `identity/errors.ts`) portaient ses refus, source par source ?
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Les événements `job.write_failed` du RUN dont l'erreur est `EmployerIdentityReviewRequired` : un par offre
 * refusée. Le motif est le code borné que le message de l'erreur porte (`motif=…`) ; seul ce code sort de la
 * base, jamais le message (il cite des raisons sociales).
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Production, rôle `catwalks_audit`, identifiants hors dépôt (`~/.catwalks/audit-access.json`), jamais
 * affichés ; `psql` reçoit les identifiants par son environnement, SANS aucune variable `PG*` héritée ;
 * transaction `READ ONLY` et garde (base, `current_user`, lecture seule effective, rôle non superutilisateur)
 * éprouvée AVANT toute mesure ; toujours ROLLBACK. La sortie ne contient que des agrégats.
 *
 *   npx tsx audits/2026-09-25/scripts/refus-identite-motifs-2409.mts [--json]
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const RUN = '35ba463f-6e8b-4e38-91dd-ced59b51281d';
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
SELECT 'M' || E'\\t' || json_build_object('source', r.source, 'motif', r.motif, 'refus', count(*))::text
FROM (SELECT e."sourceKey" AS source,
        coalesce(substring(e.payload::text from 'motif=([A-Z_]{4,48})'), 'SANS_MOTIF') AS motif
      FROM "PipelineEvent" e
      WHERE e."runId" = '${RUN}' AND e.event = 'job.write_failed'
        AND e.payload::text LIKE '%EmployerIdentityReviewRequired%') r
GROUP BY r.source, r.motif;
\\else
SELECT 'REFUS' || E'\\t' || '"garde"';
\\endif
ROLLBACK;
`;

// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'refus-identite-motifs' },
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim().slice(0, 2000)}`);
const parTag = new Map<string, unknown[]>();
for (const brute of run.stdout.split('\n')) {
  const i = brute.indexOf('\t');
  if (i < 0) continue;
  parTag.set(brute.slice(0, i), [...(parTag.get(brute.slice(0, i)) ?? []), JSON.parse(brute.slice(i + 1))]);
}
if (parTag.has('REFUS')) refus('garde de lecture seule non satisfaite, aucune mesure exécutée');
const garde = parTag.get('G')?.[0] as Record<string, unknown> | undefined;
if (!garde || garde.lectureSeule !== 'on' || garde.role !== 'catwalks_audit' || garde.base !== BASE) refus('garde absente');

type Ligne = { source: string; motif: string; refus: number };
const lignes = ((parTag.get('M') ?? []) as Ligne[]).sort((a, b) => b.refus - a.refus || a.source.localeCompare(b.source));
const parMotif = new Map<string, number>();
for (const l of lignes) parMotif.set(l.motif, (parMotif.get(l.motif) ?? 0) + l.refus);
const resultat = { garde, run: RUN, sources: new Set(lignes.map(l => l.source)).size, refus: lignes.reduce((n, l) => n + l.refus, 0),
  parMotif: Object.fromEntries([...parMotif].sort(([, a], [, b]) => b - a)), parSource: lignes };
if (process.argv.includes('--json')) { console.log(JSON.stringify(resultat, null, 1)); process.exit(0); }
console.log(`base ${String(garde.base)} · rôle ${String(garde.role)} · lecture seule ${String(garde.lectureSeule)} · ${String(garde.maintenant)}`);
console.log(`${resultat.refus} refus d’identité sur ${resultat.sources} sources · par motif : ${JSON.stringify(resultat.parMotif)}`);
for (const l of lignes) console.log(`  ${l.source.padEnd(32)} ${l.motif.padEnd(34)} ${String(l.refus).padStart(6)}`);

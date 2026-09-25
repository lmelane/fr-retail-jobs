/**
 * LES OFFRES RETENUES AU RUN DU 24/09/2026 QUI RESTENT EN LIGNE (runId 35ba463f).
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * Une retenue n'est « non publiée » que par CE RUN : elle ne retire une publication antérieure que si son
 * motif porte une disposition de cycle de vie (`publicationDisposition.ts`) ET que l'adaptateur a daté le
 * retrait (`publicationHold.ts`). Sans disposition — employeur absent de l'annonce Workday, modèle expiré,
 * publication de test, événement de recrutement —, la représentation déjà publiée reste active
 * (`PRESENT_BUT_HELD`, `refreshPlan.ts`). Combien de ces offres restent en ligne, par motif et par source ?
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Les offres retenues au RUN : un événement `job.publication_held` par offre (source, identifiant, motif).
 * « Déjà publiée un jour » = une ligne `JobSource` existe pour cette source et cet identifiant. « Représentation
 * active » = cette ligne est active : la
 * jointure de `apps/aggregator/scripts/coverage/unverifiable-register.mts`. « Publiée » ajoute ce que le site
 * exige (`publicJobSql`, `packages/db/availability.ts`) : offre active, non fusionnée, représentation non
 * expirée. État lu MAINTENANT, pas à la fin du RUN.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Production, rôle `catwalks_audit`, identifiants hors dépôt (`~/.catwalks/audit-access.json`), jamais
 * affichés ; `psql` reçoit les identifiants par son environnement, SANS aucune variable `PG*` héritée ;
 * transaction `READ ONLY` et garde (base, `current_user`, lecture seule effective, rôle non superutilisateur)
 * éprouvée AVANT toute mesure ; toujours ROLLBACK. La sortie ne contient que des agrégats.
 *
 *   npx tsx audits/2026-09-25/scripts/retenues-encore-en-ligne-2409.mts [--json]
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { publicationDisposition, retentionClass } from '../../../apps/aggregator/src/pipeline/publicationDisposition.ts';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const RUN = '35ba463f-6e8b-4e38-91dd-ced59b51281d';
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

const ligne = (tag: string, json: string, reste: string) => `SELECT '${tag}' || E'\\t' || (${json})::text\n${reste};`;
const existe = `EXISTS (SELECT 1 FROM "JobSource" js WHERE js."sourceKey" = h.source AND js."externalId" = h.external_id)`;
const actif = `EXISTS (SELECT 1 FROM "JobSource" js WHERE js."sourceKey" = h.source AND js."externalId" = h.external_id AND js."isActive")`;
const publie = `EXISTS (SELECT 1 FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" WHERE js."sourceKey" = h.source AND js."externalId" = h.external_id
  AND js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > now()) AND j."isActive" AND j."mergedIntoId" IS NULL)`;
const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
${ligne('R', `json_build_object('source', h.source, 'reason', h.reason, 'retenues', count(*), 'representationExistante', count(*) FILTER (WHERE ${existe}),
  'representationActive', count(*) FILTER (WHERE ${actif}), 'publiee', count(*) FILTER (WHERE ${publie}))`,
  `FROM (SELECT DISTINCT e."sourceKey" AS source, e."jobId" AS external_id, e.payload->>'reason' AS reason
         FROM "PipelineEvent" e WHERE e."runId" = '${RUN}' AND e.event = 'job.publication_held') h
   GROUP BY h.source, h.reason`)}
\\else
SELECT 'REFUS' || E'\\t' || '"garde"';
\\endif
ROLLBACK;
`;

// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'retenues-encore-en-ligne' },
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

type Ligne = { source: string; reason: string; retenues: number; representationExistante: number; representationActive: number; publiee: number };
const lignes = (parTag.get('R') ?? []) as Ligne[];
const parMotif = new Map<string, { retenues: number; representationExistante: number; representationActive: number; publiee: number; sources: Ligne[] }>();
for (const l of lignes) {
  const m = parMotif.get(l.reason) ?? { retenues: 0, representationExistante: 0, representationActive: 0, publiee: 0, sources: [] };
  parMotif.set(l.reason, { retenues: m.retenues + l.retenues, representationExistante: m.representationExistante + l.representationExistante,
    representationActive: m.representationActive + l.representationActive, publiee: m.publiee + l.publiee, sources: [...m.sources, l] });
}
const resultat = { garde, run: RUN, motifs: [...parMotif].sort(([, a], [, b]) => b.retenues - a.retenues).map(([motif, m]) => ({
  motif, classe: retentionClass(motif), disposition: publicationDisposition(motif)?.kind ?? 'AUCUNE', retenues: m.retenues,
  representationExistante: m.representationExistante, representationActive: m.representationActive, publiee: m.publiee,
  sources: m.sources.sort((a, b) => b.retenues - a.retenues || a.source.localeCompare(b.source))
    .map(({ source, retenues, representationExistante, representationActive, publiee }) => ({ source, retenues, representationExistante, representationActive, publiee })) })) };
if (process.argv.includes('--json')) { console.log(JSON.stringify(resultat, null, 1)); process.exit(0); }
console.log(`base ${String(garde.base)} · rôle ${String(garde.role)} · lecture seule ${String(garde.lectureSeule)} · ${String(garde.maintenant)}`);
console.log('motif · classe · disposition · retenues au RUN · déjà publiées un jour (JobSource existante) · représentation encore active · encore publiée (site)');
for (const m of resultat.motifs) {
  console.log(`\n${m.motif} · ${m.classe} · ${m.disposition} · ${m.retenues} · ${m.representationExistante} · ${m.representationActive} · ${m.publiee}`);
  for (const s of m.sources) console.log(`  ${s.source.padEnd(28)} ${String(s.retenues).padStart(5)} ${String(s.representationExistante).padStart(6)} ${String(s.representationActive).padStart(6)} ${String(s.publiee).padStart(6)}`);
}

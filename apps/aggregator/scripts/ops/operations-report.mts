/**
 * LE RAPPORT D'EXPLOITATION — l'état courant de chaque source, en une lecture.
 *
 * Ce que le digest Brevo ne dit pas : il alerte quand une source SE DÉGRADE, ce qui est le bon déclencheur
 * pour un courriel mais laisse sans réponse la question quotidienne — *où en est le catalogue maintenant ?*
 * Une source silencieuse depuis huit jours n'a jamais « échoué » : elle n'a simplement rien produit, et
 * aucune alerte ne se déclenche sur un silence.
 *
 * Le rapport joint donc, par source : son mode opérationnel (ce qu'elle a le DROIT de faire), son dernier
 * run, sa variation de volume, ses 429, ses retenues, ses fermetures — et le stockage, chaud et distant.
 *
 * Lecture seule, une transaction cohérente.
 *
 * usage: db.py readonly npx tsx scripts/ops/operations-report.mts [--out=<f.json>] [--md=<f.md>]
 *        [--since-hours=48]
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { sourceIdentityHash } from '../../src/connectors/sourceIdentity.js';
import { decideMode, type SourceEvidence } from '../../src/registry/operationalMode.js';
import { accessDecision, type RobotsObserved } from '../../src/lib/accessDecision.js';
import { publicJobSql } from '@catwalks/db/availability';
import { objectStoreConfigured } from '../../src/retention/objectStore.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const outJson = arg('out');
const outMd = arg('md');
const sinceHours = Number(arg('since-hours') ?? 48);
if (!Number.isFinite(sinceHours) || sinceHours <= 0) throw new Error('since-hours must be positive');

const p = new PrismaClient();
type Row = Record<string, any>;

/** Voir `source-registry.mts` : la décision d'accès est celle de D62, pas le texte du robots. */
function observedFromVerdict(v: string | null | undefined): RobotsObserved {
  const s = (v ?? '').trim().toUpperCase();
  if (!s) return 'UNREACHABLE';
  if (s.includes('DISALLOW')) return 'DISALLOWED';
  if (/NO ROBOTS|NO_ROBOTS|NOT REACHABLE|UNREACHABLE/.test(s)) return 'NO_ROBOTS';
  return s.startsWith('ALLOWED') ? 'ALLOWED' : 'UNREACHABLE';
}

const report = await p.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  const since = new Date(Date.now() - sinceHours * 3600_000);

  const sources = await tx.source.findMany({
    where: { status: { in: ['ACTIVE', 'PAUSED'] } }, orderBy: { key: 'asc' } });

  const reviews = await tx.$queryRawUnsafe<Row[]>(
    `SELECT DISTINCT ON (r."sourceKey") r."sourceKey", r.verdict, r."sourceHash"
     FROM "SourceIdentityReview" r ORDER BY r."sourceKey", r."createdAt" DESC, r.id DESC`);
  const reviewOf = new Map(reviews.map((r) => [r.sourceKey, r]));

  /** Les DEUX derniers runs : la variation de volume n'existe pas sans un précédent. */
  const runs = await tx.$queryRawUnsafe<Row[]>(
    `SELECT "sourceKey", status, complete, "canAttestAbsence", "ranAt", jobs, "previousJobs", fetched, rang
     FROM (SELECT sr.*, ROW_NUMBER() OVER (PARTITION BY sr."sourceKey" ORDER BY sr."ranAt" DESC) rang
           FROM "SourceRun" sr) t WHERE rang <= 2`);
  const runsOf = new Map<string, Row[]>();
  for (const r of runs) runsOf.set(r.sourceKey, [...(runsOf.get(r.sourceKey) ?? []), r]);

  const at = new Date();
  const published = await tx.$queryRaw<Row[]>(Prisma.sql`
    SELECT js."sourceKey", COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > ${at}) AND ${publicJobSql(Prisma.raw('j'), at)} GROUP BY 1`);
  const pubOf = new Map(published.map((r) => [r.sourceKey, Number(r.n)]));

  const events = await tx.$queryRawUnsafe<Row[]>(
    `SELECT "sourceKey", event, COUNT(*)::int n FROM "PipelineEvent"
     WHERE at >= $1 AND event IN ('job.publication_held','job.write_failed','http.rate_limited')
     GROUP BY 1,2`, since);
  const evOf = (k: string, e: string) => events.find((x) => x.sourceKey === k && x.event === e)?.n ?? 0;

  const closed = await tx.$queryRawUnsafe<Row[]>(
    `SELECT js."sourceKey", COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
     WHERE NOT j."isActive" AND j."closedAt" >= $1 GROUP BY 1`, since);
  const closedOf = new Map(closed.map((r) => [r.sourceKey, Number(r.n)]));

  const hot = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int lignes, pg_size_pretty(pg_total_relation_size('"RawBlobBody"')) taille,
            MIN(b."createdAt") plusAncienne FROM "RawBlobBody" h JOIN "RawBlob" b ON b.hash = h.hash`);
  const archives = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int pointeurs, COUNT(DISTINCT uri)::int archives FROM "RawBlobArchive"`);

  const lignes = sources.map((s) => {
    const rev = reviewOf.get(s.key);
    const [dernier, precedent] = runsOf.get(s.key) ?? [];
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    const ev: SourceEvidence = {
      key: s.key, status: s.status, hasConfig: Object.keys(cfg).length > 0,
      identityVerified: rev?.verdict === 'VERIFIED',
      identityHashMatchesConfig: rev?.sourceHash === sourceIdentityHash(s),
      accessAllowed: accessDecision({ robotsObserved: observedFromVerdict(s.robotsVerdict),
        accessSurface: 'PUBLIC_OFFICIAL_HTML' }).effectiveAccessDecision === 'ALLOWED',
      tenantKey: s.tenantKey ?? null,
      lastRunStatus: dernier?.status ?? null, lastRunComplete: dernier?.complete ?? null,
      lastRunCanAttestAbsence: dernier?.canAttestAbsence ?? null, lastRunAt: dernier?.ranAt ?? null,
    };
    const volumeAvant = precedent ? Number(precedent.jobs) : null;
    const volumeActuel = dernier ? Number(dernier.jobs) : null;
    return {
      source: s.key, maison: s.maison, mode: decideMode(ev).mode,
      dernierRun: dernier?.ranAt ?? null, dernierStatut: dernier?.status ?? null,
      // Un silence n'est pas un échec, et aucune alerte ne se déclenche dessus : il faut donc le MESURER.
      heuresDepuisDernierRun: dernier ? Math.round((Date.now() - new Date(dernier.ranAt).getTime()) / 36e5) : null,
      volumeAvant, volumeActuel,
      variation: volumeAvant != null && volumeActuel != null ? volumeActuel - volumeAvant : null,
      publiees: pubOf.get(s.key) ?? 0,
      limitations429: evOf(s.key, 'http.rate_limited'),
      retenues: evOf(s.key, 'job.publication_held'),
      echecsEcriture: evOf(s.key, 'job.write_failed'),
      fermetures: closedOf.get(s.key) ?? 0,
    };
  });

  return {
    at: new Date().toISOString(), fenetreHeures: sinceHours,
    sources: lignes.length,
    parMode: lignes.reduce<Record<string, number>>((m, l) => { m[l.mode] = (m[l.mode] ?? 0) + 1; return m; }, {}),
    silencieusesPlusDe7Jours: lignes.filter((l) => (l.heuresDepuisDernierRun ?? 1e9) > 168).length,
    sansAucunRun: lignes.filter((l) => l.heuresDepuisDernierRun === null).length,
    totaux: {
      publiees: lignes.reduce((s, l) => s + l.publiees, 0),
      limitations429: lignes.reduce((s, l) => s + l.limitations429, 0),
      retenues: lignes.reduce((s, l) => s + l.retenues, 0),
      echecsEcriture: lignes.reduce((s, l) => s + l.echecsEcriture, 0),
      fermetures: lignes.reduce((s, l) => s + l.fermetures, 0),
    },
    stockage: {
      chaud: { lignes: hot[0].lignes, taille: hot[0].taille, plusAncienne: hot[0].plusancienne },
      distant: { pointeurs: archives[0].pointeurs, archives: archives[0].archives,
                 configure: objectStoreConfigured() },
    },
    lignes,
  };
});
await p.$disconnect();

if (outJson) writeFileSync(outJson, JSON.stringify(report, null, 1));
if (outMd) {
  const esc = (v: unknown) => String(v ?? '—').replace(/\|/g, '\\|');
  writeFileSync(outMd,
    `# Rapport d'exploitation\n\n> ${report.at} — fenêtre ${report.fenetreHeures} h.\n\n` +
    `| Source | Maison | Mode | Dernier run | h | Volume | Variation | Publiées | 429 | Retenues | Échecs d’écriture | Actuellement fermées depuis le début de la fenêtre |\n` +
    `|---|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|\n` +
    report.lignes.map((l) => `| ${[l.source, l.maison, l.mode, l.dernierStatut, l.heuresDepuisDernierRun,
      l.volumeActuel, l.variation, l.publiees, l.limitations429, l.retenues, l.echecsEcriture, l.fermetures].map(esc).join(' | ')} |`).join('\n') + '\n');
}
const { lignes, ...resume } = report;
console.log(JSON.stringify(resume, null, 1));

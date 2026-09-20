/**
 * QUELLE TRACE UNE SOURCE A-T-ELLE LAISSÉE À LA DERNIÈRE COLLECTE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/trace-execution-source.mts <clé>…
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────────────────────────
 *
 * `Source.lastRunJobs` vide ne dit pas POURQUOI : la source peut n'avoir jamais été appelée, avoir
 * été écartée avant capture par un garde-fou, avoir capturé sans rien publier, ou avoir échoué.
 * Ces quatre cas demandent quatre actions différentes, et on ne les distingue qu'en lisant les
 * traces que la chaîne laisse derrière elle, dans l'ordre où elle les écrit :
 *
 *   SourceRun                    — la source a-t-elle été APPELÉE ?
 *   RawBlob / capture            — a-t-elle RAPPORTÉ quelque chose ?
 *   SourceIngestionAdmission     — a-t-elle été ADMISE à l'ingestion ?
 *   SourceIngestionCompletion    — l'ingestion est-elle allée au BOUT ?
 *   JobSource / Job              — des offres en sont-elles SORTIES ?
 *
 * Une absence à l'étape N explique toutes les absences suivantes : on lit donc de haut en bas et
 * on s'arrête au premier maillon vide. C'est lui, la cause.
 */
import { PrismaClient } from '@prisma/client';

const cles = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!cles.length) { console.error('Usage : trace-execution-source.mts <clé>…'); process.exit(2); }

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

/* Les colonnes varient selon les lots ; on lit le schéma plutôt que de le supposer. */
const colonnes = async (table: string) =>
  (await q<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, table))
    .map((c) => c.column_name);

const aTable = async (t: string) =>
  (await q<{ n: bigint }>(`SELECT count(*) AS n FROM information_schema.tables
     WHERE table_schema='public' AND table_name=$1`, t))[0].n > 0n;

for (const cle of cles) {
  console.log(`\n═══════════ ${cle} ═══════════`);

  const [s] = await q<Record<string, unknown>>(
    `SELECT key, maison, kind, status, "portalScope", "careersDomain", "tenantKey",
            "lastRunJobs", "lastRunStatus", "currentRevisionId"
       FROM "Source" WHERE key=$1`, cle);
  if (!s) { console.log('   ⚠ source absente du registre'); continue; }
  console.log('\n   ── registre ──');
  for (const [k, v] of Object.entries(s)) console.log(`   ${k.padEnd(18)} ${v === null ? '—' : String(v).slice(0, 100)}`);

  if (await aTable('SourceRun')) {
    const cols = await colonnes('SourceRun');
    const cleCol = cols.includes('sourceKey') ? '"sourceKey"' : cols.includes('key') ? 'key' : null;
    if (cleCol) {
      const runs = await q<Record<string, unknown>>(
        `SELECT * FROM "SourceRun" WHERE ${cleCol}=$1 ORDER BY 1 DESC LIMIT 3`, cle);
      console.log(`\n   ── SourceRun : ${runs.length} exécution(s) tracée(s) ──`);
      for (const r of runs) console.log(`      ${JSON.stringify(r).slice(0, 220)}`);
      if (!runs.length) console.log('      ⚠ AUCUNE — la source n\'a jamais été appelée, ou la trace n\'est pas conservée');
    }
  }

  for (const t of ['SourceIngestionAdmission', 'SourceIngestionCompletion', 'SourceAccessDecision']) {
    if (!(await aTable(t))) continue;
    const cols = await colonnes(t);
    const cleCol = cols.includes('sourceKey') ? '"sourceKey"' : null;
    if (!cleCol) { console.log(`\n   ── ${t} : pas de colonne sourceKey (jointure par révision) ──`); continue; }
    const rows = await q<Record<string, unknown>>(
      `SELECT * FROM "${t}" WHERE ${cleCol}=$1 LIMIT 3`, cle);
    console.log(`\n   ── ${t} : ${rows.length} ligne(s) ──`);
    for (const r of rows) console.log(`      ${JSON.stringify(r).slice(0, 260)}`);
    if (!rows.length) console.log('      ⚠ AUCUNE');
  }

  const [pub] = await q<{ n: bigint }>(
    `SELECT count(*) AS n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId"
      WHERE js."sourceKey"=$1 AND j."isActive"`, cle);
  console.log(`\n   ── offres publiées : ${pub.n} ──`);
}

console.log('');
await prisma.$disconnect();

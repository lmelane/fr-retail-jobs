/**
 * POURQUOI LES OFFRES CAPTURÉES NE SONT PAS PUBLIÉES — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/pourquoi-non-publiees.mts [<clé de source>…]
 *
 * ── LE CONSTAT QUI L'A DÉCLENCHÉ ───────────────────────────────────────────────────────────────
 *
 * 19/09/2026, fin de la collecte massive (21 vagues, 6 invariants verts) : le catalogue tient
 * 8 603 offres pour 32 868 captures RAW. Les trois dernières vagues — celles des gros groupes —
 * n'ont ajouté que 7 offres, alors qu'un appel direct à l'adaptateur LVMH rendait 6 191 offres.
 *
 * Les invariants ne mesurent QUE l'intégrité de la chaîne (pas de capture orpheline, pas de corps
 * manquant). Ils sont verts et le resteront : une offre refusée par un garde-fou est un refus
 * LÉGITIME, pas une rupture. Il faut donc lire les REFUS eux-mêmes, un par un, et dire lesquels
 * sont fondés et lesquels révèlent un défaut de notre côté.
 *
 * Ce script ne force rien et ne corrige rien : il compte et il nomme.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

const cles = process.argv.slice(2).filter((a) => !a.startsWith('-'));

/* Quelles tables portent la trace d'un refus ? On les lit plutôt que de les supposer. */
const tables = await q<{ table_name: string }>(`
  SELECT table_name FROM information_schema.tables
   WHERE table_schema='public'
     AND (table_name ILIKE '%reject%' OR table_name ILIKE '%refus%' OR table_name ILIKE '%admission%'
          OR table_name ILIKE '%ingest%' OR table_name ILIKE '%decision%' OR table_name ILIKE '%run%')
   ORDER BY table_name`);
console.log('\n═══ TABLES QUI PEUVENT PORTER UN REFUS ═══\n');
for (const t of tables) console.log(`   ${t.table_name}`);

/* L'état des sources après la collecte : ce que chacune a rapporté, et sous quel statut. */
console.log('\n═══ DERNIÈRE EXÉCUTION PAR SOURCE — LES 40 PLUS GROSSES ═══\n');
const runs = await q<{ key: string; maison: string; kind: string; status: string; lastRunJobs: number | null; lastRunStatus: string | null; publiees: bigint }>(`
  SELECT s.key, s.maison, s.kind, s.status, s."lastRunJobs", s."lastRunStatus",
         (SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
           WHERE js."sourceKey" = s.key AND j."isActive") AS publiees
    FROM "Source" s
   WHERE s.status = 'ACTIVE' AND coalesce(s."lastRunJobs", 0) > 0
   ORDER BY s."lastRunJobs" DESC NULLS LAST LIMIT 40`);
console.log(`   ${'source'.padEnd(26)} ${'vues'.padStart(6)} ${'publiées'.padStart(9)}  statut`);
for (const r of runs)
  console.log(`   ${r.key.padEnd(26)} ${String(r.lastRunJobs ?? 0).padStart(6)} ${String(r.publiees).padStart(9)}  ${r.lastRunStatus ?? '—'}`);

/* Les sources qui ont VU des offres et n'en publient AUCUNE : le cœur du sujet. */
console.log('\n═══ SOURCES QUI ONT VU DES OFFRES ET N\'EN PUBLIENT AUCUNE ═══\n');
const muettes = await q<{ key: string; maison: string; kind: string; lastRunJobs: number; lastRunStatus: string | null }>(`
  SELECT s.key, s.maison, s.kind, s."lastRunJobs", s."lastRunStatus"
    FROM "Source" s
   WHERE s.status='ACTIVE' AND coalesce(s."lastRunJobs",0) > 0
     AND NOT EXISTS (SELECT 1 FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
                      WHERE js."sourceKey" = s.key AND j."isActive")
   ORDER BY s."lastRunJobs" DESC LIMIT 40`);
let perdues = 0;
for (const m of muettes) {
  perdues += m.lastRunJobs;
  console.log(`   ${m.key.padEnd(26)} ${String(m.lastRunJobs).padStart(6)} vue(s)  ${m.kind.padEnd(18)} ${m.lastRunStatus ?? '—'}`);
}
console.log(`\n   ${muettes.length} source(s) muette(s) · ${perdues} offre(s) vues et non publiées`);

if (cles.length) {
  console.log('\n═══ DÉTAIL DES SOURCES DEMANDÉES ═══');
  for (const cle of cles) {
    console.log(`\n── ${cle} ──`);
    const [s] = await q<Record<string, unknown>>(
      `SELECT key, maison, kind, status, "portalScope", "careersDomain", "lastRunJobs", "lastRunStatus", note
         FROM "Source" WHERE key = $1`, cle);
    if (!s) { console.log('   source absente'); continue; }
    for (const [k, v] of Object.entries(s)) console.log(`   ${k.padEnd(16)} ${v === null ? '—' : String(v).slice(0, 110)}`);
    const [n] = await q<{ n: bigint }>(
      `SELECT count(*) AS n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId"
        WHERE js."sourceKey"=$1 AND j."isActive"`, cle);
    console.log(`   offres publiées  ${n.n}`);
  }
}

console.log('');
await prisma.$disconnect();

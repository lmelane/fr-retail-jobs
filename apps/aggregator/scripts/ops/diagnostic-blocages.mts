/**
 * OÙ CHAQUE SOURCE S'ARRÊTE, ET POURQUOI — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/diagnostic-blocages.mts [--csv=<fichier>]
 *
 * ── CE QU'IL RÉPOND ────────────────────────────────────────────────────────────────────────────
 *
 * Une source qui ne publie rien peut s'être arrêtée à six endroits différents, et les confondre
 * mène à corriger la mauvaise chose. Ce script situe CHAQUE source ACTIVE sur la chaîne :
 *
 *   PUBLIE                  des offres sont au catalogue — rien à corriger
 *   REFUS_EMPLOYEUR         elle collecte, mais l'identité employeur refuse l'écriture
 *   COLLECTE_SANS_SUITE     elle a capturé des offres, et l'ingestion n'a jamais été lancée
 *   COLLECTE_INTERROMPUE    son lot d'offres a échoué (délai dépassé, réseau, adaptateur)
 *   IDENTITE_SEULE          elle a tenté l'identité et s'est arrêtée avant la collecte
 *   JAMAIS_TENTEE           aucune capture du tout — écartée avant d'essayer
 *
 * Chaque ligne porte les chiffres qui justifient son classement : offres vues, publiées, refusées,
 * nombre de requêtes de la dernière collecte. Le nombre de requêtes compte : workday en demande une
 * par offre (Nordstrom, 663 requêtes), et c'est ce qui fait dépasser le délai de 120 secondes.
 *
 * Il ne corrige rien. Il dit où regarder.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const csvPath = process.argv.find((a) => a.startsWith('--csv='))?.slice(6);

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Ligne = {
  key: string; maison: string; kind: string; portalScope: string | null;
  vues: number | null; publiees: number; refusees: number; requetes: number | null;
  lots_jobs: number; lots_identite: number; lots_echoues: number;
  motif_refus: string | null;
};

const rows = await prisma.$queryRawUnsafe<Ligne[]>(`
  SELECT s.key, s.maison, s.kind, s."portalScope",
    (SELECT o."extractedCount" FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
      WHERE b."sourceKey"=s.key AND b.purpose='JOBS' AND o.status='EXTRACTED'
      ORDER BY b."startedAt" DESC LIMIT 1)                                                        AS vues,
    (SELECT count(*)::int FROM "JobSource" js WHERE js."sourceKey"=s.key)                         AS publiees,
    (SELECT count(*)::int FROM "PipelineEvent" e WHERE e."sourceKey"=s.key
      AND e.event='job.write_failed')                                                             AS refusees,
    (SELECT count(*)::int FROM "RawCapture" c JOIN "CaptureBatch" b ON b.id=c."batchId"
      WHERE b."sourceKey"=s.key AND b.purpose='JOBS'
        AND b.id=(SELECT b2.id FROM "CaptureBatch" b2 WHERE b2."sourceKey"=s.key AND b2.purpose='JOBS'
                   ORDER BY b2."startedAt" DESC LIMIT 1))                                         AS requetes,
    (SELECT count(*)::int FROM "CaptureBatch" b WHERE b."sourceKey"=s.key AND b.purpose='JOBS')   AS lots_jobs,
    (SELECT count(*)::int FROM "CaptureBatch" b WHERE b."sourceKey"=s.key
      AND b.purpose='SOURCE_IDENTITY')                                                            AS lots_identite,
    (SELECT count(*)::int FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
      WHERE b."sourceKey"=s.key AND b.purpose='JOBS' AND o.status<>'EXTRACTED')                   AS lots_echoues,
    (SELECT e.payload->'error'->>'proposedName' FROM "PipelineEvent" e WHERE e."sourceKey"=s.key
      AND e.event='job.write_failed' ORDER BY e.at DESC LIMIT 1)                                  AS motif_refus
   FROM "Source" s WHERE s.status='ACTIVE' ORDER BY s.kind, s.key`);

function situer(r: Ligne): { etat: string; detail: string } {
  if (r.publiees > 0) {
    return r.refusees > 0
      ? { etat: 'PUBLIE_PARTIEL', detail: `${r.publiees} publiée(s), ${r.refusees} refusée(s) — ${r.motif_refus ?? '?'}` }
      : { etat: 'PUBLIE', detail: `${r.publiees} offre(s)` };
  }
  if (r.refusees > 0) return { etat: 'REFUS_EMPLOYEUR', detail: `${r.refusees} refusée(s) — ${r.motif_refus ?? '?'}` };
  if (r.vues && r.vues > 0) {
    return { etat: 'COLLECTE_SANS_SUITE', detail: `${r.vues} offre(s) capturée(s), ingestion jamais lancée` };
  }
  if (r.lots_echoues > 0) return { etat: 'COLLECTE_INTERROMPUE', detail: `${r.lots_echoues} lot(s) d'offres en échec` };
  if (r.lots_jobs > 0) return { etat: 'COLLECTE_VIDE', detail: 'lot d\'offres sans aucune offre' };
  if (r.lots_identite > 0) return { etat: 'IDENTITE_SEULE', detail: `${r.lots_identite} capture(s) d'identité, aucune collecte` };
  return { etat: 'JAMAIS_TENTEE', detail: 'aucune capture' };
}

const classees = rows.map((r) => ({ ...r, ...situer(r) }));
const ORDRE = ['PUBLIE', 'PUBLIE_PARTIEL', 'REFUS_EMPLOYEUR', 'COLLECTE_SANS_SUITE',
  'COLLECTE_INTERROMPUE', 'COLLECTE_VIDE', 'IDENTITE_SEULE', 'JAMAIS_TENTEE'];

console.log(`\nDIAGNOSTIC — ${rows.length} source(s) ACTIVE\n`);
for (const etat of ORDRE) {
  const xs = classees.filter((c) => c.etat === etat);
  if (!xs.length) continue;
  const offres = xs.reduce((s, x) => s + (x.vues ?? 0), 0);
  console.log(`   ${etat.padEnd(22)} ${String(xs.length).padStart(4)} source(s)   ${String(offres).padStart(7)} offre(s) vue(s)`);
}

console.log(`\nPAR FAMILLE ET PAR ÉTAT\n`);
const familles = [...new Set(classees.map((c) => c.kind))];
for (const f of familles.sort()) {
  const xs = classees.filter((c) => c.kind === f);
  const parEtat = new Map<string, number>();
  for (const x of xs) parEtat.set(x.etat, (parEtat.get(x.etat) ?? 0) + 1);
  const resume = ORDRE.filter((e) => parEtat.has(e)).map((e) => `${e.toLowerCase()} ${parEtat.get(e)}`).join(' · ');
  console.log(`   ${f.padEnd(28)} ${resume}`);
}

/* Les sources qui ont capturé des offres sans jamais publier : le cas le plus coûteux. */
const perdues = classees.filter((c) => c.etat === 'COLLECTE_SANS_SUITE').sort((a, b) => (b.vues ?? 0) - (a.vues ?? 0));
if (perdues.length) {
  console.log(`\nOFFRES CAPTURÉES ET NON PUBLIÉES — ${perdues.reduce((s, x) => s + (x.vues ?? 0), 0)} offre(s)\n`);
  for (const x of perdues.slice(0, 20)) {
    console.log(`   ${x.key.padEnd(30)} ${String(x.vues).padStart(6)} vue(s) · ${String(x.requetes ?? '-').padStart(4)} requête(s) · ${x.kind}`);
  }
}

if (csvPath) {
  const entetes = ['cle', 'maison', 'ats', 'etat', 'detail', 'offres_vues', 'publiees', 'refusees',
    'requetes_derniere_collecte', 'lots_offres', 'lots_identite', 'lots_echoues', 'portail_une_seule_marque', 'motif_refus'];
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  writeFileSync(csvPath, '﻿' + [entetes.join(';'), ...classees.map((c) =>
    [c.key, c.maison, c.kind, c.etat, c.detail, c.vues, c.publiees, c.refusees,
     c.requetes, c.lots_jobs, c.lots_identite, c.lots_echoues, c.portalScope, c.motif_refus].map(esc).join(';'))].join('\n') + '\n');
  console.log(`\n   détail écrit dans ${csvPath}`);
}
console.log('');
await prisma.$disconnect();

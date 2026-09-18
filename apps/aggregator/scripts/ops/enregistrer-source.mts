/**
 * ENREGISTRER UNE SOURCE DANS LE REGISTRE — inspection par défaut, écriture sur `--ecrire`.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/enregistrer-source.mts --fiche=<fiche.json>
 *
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/enregistrer-source.mts --fiche=<fiche.json> --ecrire
 *
 * ── CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS ─────────────────────────────────────────────────────
 *
 * Il crée une ligne de registre en **DRAFT** — jamais ACTIVE. Une source DRAFT est identifiée mais
 * pas admise : la campagne ne la qualifie pas, le pipeline ne la collecte pas. C'est l'état correct
 * pour une source dont la collecte n'est pas encore PROUVÉE.
 *
 * Il ne crée aucune revue d'identité, aucune décision d'accès, aucune offre. Il ne promeut rien.
 * La promotion vers ACTIVE est un geste distinct, qui suppose une collecte démontrée.
 *
 * Le déclencheur `Source_record_revision` crée la révision v1 tout seul à l'INSERT : ce script ne
 * doit surtout pas en créer une (une tentative antérieure a violé la contrainte d'unicité
 * (sourceId, version) pour cette raison exacte).
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const ECRIRE = process.argv.includes('--ecrire');
const chemin = process.argv.find((a) => a.startsWith('--fiche='))?.slice(8);
if (!chemin) {
  console.error('Usage : enregistrer-source.mts --fiche=<fiche.json> [--ecrire]');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Fiche = {
  key: string; maison: string; kind: string; tenantKey: string; tier: string;
  careersDomain: string | null; jobUrlPattern: string | null;
  config: Record<string, unknown>; note?: string;
};
const fiche = JSON.parse(readFileSync(chemin, 'utf8')) as Fiche;

for (const champ of ['key', 'maison', 'kind', 'tenantKey', 'tier'] as const) {
  if (typeof fiche[champ] !== 'string' || !fiche[champ].trim()) {
    console.error(`Champ « ${champ} » manquant ou vide dans la fiche.`);
    process.exit(1);
  }
}

const [existe] = await prisma.$queryRawUnsafe<Array<{ key: string; status: string }>>(
  `SELECT key, status FROM "Source" WHERE key = $1`, fiche.key);

console.log(`\nENREGISTRER « ${fiche.key} »\n`);
console.log(`   maison        : ${fiche.maison}`);
console.log(`   famille       : ${fiche.kind}`);
console.log(`   palier        : ${fiche.tier}`);
console.log(`   careersDomain : ${fiche.careersDomain ?? '(vide)'}`);
console.log(`   config        : ${JSON.stringify(fiche.config)}`);
console.log(`   statut        : DRAFT  ← jamais ACTIVE : la collecte n'est pas prouvée`);
if (fiche.note) console.log(`   note          : ${fiche.note}`);

if (existe) {
  console.log(`\n   DÉJÀ PRÉSENTE (statut ${existe.status}) — rien à créer.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

if (!ECRIRE) {
  console.log(`\nINSPECTION SEULEMENT — rien n'a été écrit. Ajouter --ecrire pour créer.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

const cree = await prisma.source.create({
  data: {
    key: fiche.key, maison: fiche.maison, tenantKey: fiche.tenantKey, kind: fiche.kind,
    careersDomain: fiche.careersDomain, jobUrlPattern: fiche.jobUrlPattern,
    status: 'DRAFT' as never, tier: fiche.tier as never,
    note: fiche.note ?? null, config: fiche.config as never,
  },
  select: { id: true, key: true, status: true, currentRevisionId: true },
});

console.log(`\n   créée : ${cree.key} · statut ${cree.status} · révision ${cree.currentRevisionId?.slice(0, 8)}…`);
console.log(`\n✔ Aucune identité, aucune décision d'accès, aucune offre créée.`);
console.log(`   La source est identifiée, pas admise : DRAFT n'est ni qualifié ni collecté.\n`);

await prisma.$disconnect();

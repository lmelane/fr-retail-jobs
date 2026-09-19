/**
 * LES PORTAILS DE GROUPE DONT LE PÉRIMÈTRE N'EST PAS DÉCLARÉ — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/portails-groupe-sans-scope.mts
 *
 * Un portail qui sert PLUSIEURS Maisons doit le déclarer (`portalScope`), sinon le garde-fou
 * d'identité refuse toute offre dont l'annonce ne nomme aucun employeur
 * (`PORTAL_OWNER_NOT_CERTIFIED`). On repère ces portails par une PREUVE : le nombre de Maisons
 * distinctes auxquelles ils ont déjà servi des offres, ou que le registre de découverte leur
 * rattache. Un libellé « (toutes Maisons) » est un indice, jamais la preuve.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
const q = <T>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

/* Preuve 1 : les Maisons réellement servies par chaque source, mesurées sur les offres. */
const parSource = await q<{ sourceKey: string; maisons: bigint; offres: bigint }>(`
  SELECT js."sourceKey", count(DISTINCT j."companyId") AS maisons, count(*) AS offres
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
   WHERE j."isActive" GROUP BY 1`);
const servies = new Map(parSource.map((r) => [r.sourceKey, { maisons: Number(r.maisons), offres: Number(r.offres) }]));

/* Preuve 2 : le registre de découverte du 09/09 — une observation datée, pas un état courant. */
const LEDGER = 'audits/2026-09-09/fashionjobs-portals/ledger.json';
const rattachees = new Map<string, number>();
if (existsSync(LEDGER)) {
  for (const l of JSON.parse(readFileSync(LEDGER, 'utf8')) as Array<{ catalogueSources?: Array<{ key?: string }> }>)
    for (const s of l.catalogueSources ?? [])
      if (s.key) rattachees.set(s.key, (rattachees.get(s.key) ?? 0) + 1);
}

const sources = await q<{ key: string; maison: string; kind: string; portalScope: string | null; careersDomain: string | null }>(`
  SELECT key, maison, kind, "portalScope", "careersDomain" FROM "Source" WHERE status='ACTIVE' ORDER BY key`);

type L = { key: string; maison: string; kind: string; scope: string | null; servies: number; offres: number; ledger: number };
const lignes: L[] = sources.map((s) => ({
  key: s.key, maison: s.maison, kind: s.kind, scope: s.portalScope,
  servies: servies.get(s.key)?.maisons ?? 0, offres: servies.get(s.key)?.offres ?? 0,
  ledger: rattachees.get(s.key) ?? 0,
}));

/* Multi-Maisons PROUVÉ : plusieurs Maisons servies aujourd'hui, ou rattachées par le registre. */
const multi = lignes.filter((l) => l.servies > 1 || l.ledger > 1);
const sansScope = multi.filter((l) => l.scope !== 'MULTI_BRAND');

console.log(`\n═══ PORTAILS SERVANT PLUSIEURS MAISONS ═══\n`);
console.log(`   ${multi.length} portail(s) prouvé(s) multi-Maisons`);
console.log(`   ${sansScope.length} sans portalScope = MULTI_BRAND\n`);
console.log(`   ${'source'.padEnd(26)} ${'scope'.padEnd(13)} ${'Maisons'.padStart(8)} ${'offres'.padStart(7)} ${'registre'.padStart(9)}`);
for (const l of [...sansScope].sort((a, b) => (b.servies + b.ledger) - (a.servies + a.ledger)).slice(0, 25))
  console.log(`   ${l.key.padEnd(26)} ${(l.scope ?? '—').padEnd(13)} ${String(l.servies).padStart(8)} ${String(l.offres).padStart(7)} ${String(l.ledger).padStart(9)}`);

console.log(`\n── déjà déclarés MULTI_BRAND ──\n`);
const ok = lignes.filter((l) => l.scope === 'MULTI_BRAND');
for (const l of ok) console.log(`   ${l.key.padEnd(26)} ${String(l.servies).padStart(4)} Maison(s), ${l.offres} offre(s)`);
if (!ok.length) console.log('   aucun');

console.log('');
await prisma.$disconnect();

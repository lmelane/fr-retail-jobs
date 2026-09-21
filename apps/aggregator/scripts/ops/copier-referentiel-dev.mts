/**
 * COPIE DU RÉFÉRENTIEL VERS UNE BASE DE DEVELOPMENT — lecture seule côté production.
 *
 * Le pipeline d'ingestion exige la chaîne de preuve complète : Source, sa révision courante, sa
 * décision d'accès, et le lot de capture sur lequel cette décision s'adosse. Sans elle, aucune
 * collecte ne peut publier — et c'est voulu.
 *
 * On COPIE ces lignes telles quelles. On n'en fabrique aucune, on ne modifie rien en production,
 * et les identifiants sont conservés pour que les liens restent exacts.
 *
 *   AUDIT_DATABASE_URL=... DEV_DATABASE_URL=... npx tsx <ce fichier> <source...>
 */
import { PrismaClient } from '@prisma/client';
import { ouvrirAccesAudit } from './audit-acces.ts';

const devUrl = process.env.DEV_DATABASE_URL ?? '';
if (!/test|dev/i.test(devUrl)) { console.error('GARDE-FOU : base de development exigée.'); process.exit(2); }
const cles = process.argv.slice(2);
if (!cles.length) { console.error('usage : copier-referentiel-dev.mts <sourceKey...>'); process.exit(2); }

const { prisma: prod } = await ouvrirAccesAudit();
const dev = new PrismaClient({ datasources: { db: { url: devUrl } } });

const lire = <T,>(sql: string, ...p: unknown[]) => prod.$queryRawUnsafe<T[]>(sql, ...p);
const ecrire = (sql: string, ...p: unknown[]) => dev.$executeRawUnsafe(sql, ...p);

console.log(`\n═══ COPIE DU RÉFÉRENTIEL — ${cles.length} source(s) ═══\n`);

/*
 * Les REVUES DE SECTEUR d'abord : un trigger exige que `Company.sectorCodes` corresponde
 * exactement au manifeste de sa revue (`validate_company_sectors`). Copier la Maison sans sa
 * revue ferait échouer l'écriture — et c'est le garde-fou qui fait son travail.
 */
const maisons = await lire<any>(
  `SELECT * FROM "Company" WHERE name IN (SELECT maison FROM "Source" WHERE key = ANY($1::text[]))`, cles);
const revuesSecteur = await lire<any>(
  `SELECT * FROM "SectorReview" WHERE id = ANY($1::text[])`,
  [...new Set(maisons.map((m: any) => m.sectorReviewId).filter(Boolean))]);
for (const r of revuesSecteur) await dev.sectorReview.upsert({ where: { id: r.id }, update: {}, create: r });
console.log(`  revues secteur ${revuesSecteur.length}`);

for (const m of maisons) {
  await dev.company.upsert({ where: { id: m.id }, update: {}, create: m });
}
console.log(`  maisons        ${maisons.length}`);

/*
 * LES RÉVISIONS NE SE COPIENT PAS : un trigger `Source_record_revision` en crée une à chaque
 * écriture sur `Source`, calculée DEPUIS LA CONFIGURATION (clé, maison, kind, config, tier,
 * tenantKey). Copier les révisions de production entrerait en collision avec celles que le
 * trigger fabrique — la contrainte `(sourceId, version)` le refuse.
 *
 * La configuration étant identique, le trigger produit la MÊME charge utile, donc la même
 * empreinte. Mais l'IDENTIFIANT de révision diffère : les décisions d'accès copiées, qui
 * pointent la révision de production, devront donc être rattachées à la nouvelle. C'est
 * mesuré plus bas, pas supposé.
 */
const sources = await lire<any>(`SELECT * FROM "Source" WHERE key = ANY($1::text[])`, cles);
for (const s of sources) {
  const { currentRevisionId: _ignore, ...sansRevision } = s;
  await dev.source.upsert({ where: { key: s.key }, update: {}, create: sansRevision });
}
console.log(`  sources        ${sources.length}`);
const revDev = await dev.sourceRevision.count();
console.log(`  révisions      ${revDev} (créées par le trigger, non copiées)`);

/* Les lots de capture qui portent les preuves d'accès — sans leurs captures ni leurs sorties :
 * la nouvelle collecte produira les siennes. */
const lots = await lire<any>(
  `SELECT b.* FROM "CaptureBatch" b
    WHERE b.id IN (SELECT "captureBatchId" FROM "SourceAccessDecision"
                    WHERE "sourceKey" = ANY($1::text[]) AND "captureBatchId" IS NOT NULL)`, cles);
for (const b of lots) await dev.captureBatch.upsert({ where: { id: b.id }, update: {}, create: b });
console.log(`  lots de preuve ${lots.length}`);

const decisions = await lire<any>(
  `SELECT * FROM "SourceAccessDecision" WHERE "sourceKey" = ANY($1::text[])`, cles);
for (const d of decisions) await dev.sourceAccessDecision.upsert({ where: { id: d.id }, update: {}, create: d });
console.log(`  décisions      ${decisions.length}`);

/* Le référentiel des métiers : la classification en dépend. */
const occ = await lire<{ n: bigint }>(`SELECT count(*) AS n FROM "OccupationRelease"`);
console.log(`\n  (releases d'occupation en production : ${occ[0].n} — non copiées, la taxonomie se recharge)`);

await prod.$disconnect();
await dev.$disconnect();
console.log(`\n═══ RÉFÉRENTIEL COPIÉ ═══\n`);

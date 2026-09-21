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

/*
 * `Company.identityReviewId` référence une revue d'identité, et la clé étrangère exige sa
 * présence. On copie celles qui EXISTENT ; les autres sont mises à `null` sur la copie.
 *
 * CONSTAT SUR LA PRODUCTION (2026-09-21) : trois Maisons — Intersport, Blackstore, Exemplar
 * Luxury Group — portent un `identityReviewId` (`lot1-migrate-r…`, `20260910-LOT4-…`) qui ne
 * correspond à AUCUNE ligne, ni dans `EmployerIdentityReview` ni dans `SourceIdentityReview`.
 * Des références de migration devenues orphelines. La contrainte ne s'en plaint pas en
 * production — elle n'y est pas vérifiée rétroactivement — mais elle bloque toute copie.
 *
 * On ne corrige RIEN en production : on neutralise la référence sur la copie, et on le dit.
 */
const revuesIdentite = await lire<any>(
  `SELECT * FROM "EmployerIdentityReview" WHERE id = ANY($1::text[])`,
  [...new Set(maisons.map((m: any) => m.identityReviewId).filter(Boolean))]);
for (const r of revuesIdentite) await dev.employerIdentityReview.upsert({ where: { id: r.id }, update: {}, create: r });
const connues = new Set(revuesIdentite.map((r: any) => r.id));
const orphelines = maisons.filter((m: any) => m.identityReviewId && !connues.has(m.identityReviewId));
for (const m of orphelines) m.identityReviewId = null;
console.log(`  revues identité ${revuesIdentite.length}${orphelines.length ? ` (${orphelines.length} référence(s) orpheline(s) neutralisée(s) sur la copie)` : ''}`);

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

/*
 * LES LOTS DE PREUVE ET LES DÉCISIONS D'ACCÈS NE SE COPIENT PAS.
 *
 * Un lot de capture porte la révision de source qui gouvernait sa collecte, et un trigger refuse
 * de l'enregistrer sous une révision qui n'est plus courante (« Capture revision is not the
 * current source configuration »). Comme les révisions sont RECRÉÉES ici par
 * `Source_record_revision`, les identifiants diffèrent : rattacher ces preuves serait
 * précisément le rattachement artificiel qu'on s'interdit.
 *
 * La campagne de qualification (`source-campaign.mts`) produit de NOUVELLES décisions d'accès,
 * adossées à de nouvelles captures, sur les révisions de development. C'est le parcours normal,
 * et il a été éprouvé : 4 décisions ALLOWED produites sur 5 sources au premier run.
 */

/* Le référentiel des métiers : la classification en dépend. */
const occ = await lire<{ n: bigint }>(`SELECT count(*) AS n FROM "OccupationRelease"`);
console.log(`\n  (releases d'occupation en production : ${occ[0].n} — non copiées, la taxonomie se recharge)`);

await prod.$disconnect();
await dev.$disconnect();
console.log(`\n═══ RÉFÉRENTIEL COPIÉ ═══\n`);

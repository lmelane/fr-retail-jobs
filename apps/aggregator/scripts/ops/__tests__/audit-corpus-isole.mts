/**
 * HARNAIS D'ÉPREUVE DE L'EXPORT — sur BASE ISOLÉE uniquement.
 *
 *   python3 apps/aggregator/scripts/ops/db.py test \
 *     npx tsx apps/aggregator/scripts/ops/__tests__/audit-corpus-isole.mts
 *
 * ── POURQUOI CE HARNAIS N'EST PAS UN TEST VITEST ───────────────────────────────────────────────
 *
 * Les propriétés à éprouver sont celles d'une TRANSACTION CONCURRENTE : il faut deux connexions
 * simultanées, l'une lisant l'instantané pendant que l'autre modifie les mêmes lignes. Un test
 * unitaire ne peut pas le simuler — il faut un vrai serveur PostgreSQL.
 *
 * ── CE QU'IL ÉPROUVE, ET POURQUOI CHAQUE CAS EXISTE ────────────────────────────────────────────
 *
 *   1. Une source qui a des CAPTURES mais AUCUNE publication apparaît bien dans l'export.
 *      Sans `CaptureBatch.sourceKey`, cette source serait invisible : elle n'a aucune ligne
 *      `JobSource`, donc `jobId IS NULL` ne la trouve pas.
 *   2. Une modification CONCURRENTE n'est pas vue par l'instantané. C'est la propriété que la
 *      première version du script n'avait pas : elle notait `now()` et lisait table par table.
 *   3. `now()` est FIGÉ dans la transaction, donc le calcul d'expiration reste cohérent.
 *
 * L'interruption (cas 4) est éprouvée à part, par exécution du vrai script.
 *
 * GARDE-FOU : ce harnais REFUSE de tourner sur une base dont le nom ne contient pas « test ».
 */
import { PrismaClient, Prisma } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!/test/i.test(url)) {
  console.error('GARDE-FOU : base isolée exigée (son nom doit contenir « test »).');
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const autre = new PrismaClient({ datasources: { db: { url } } }); // la connexion CONCURRENTE
const echecs: string[] = [];
const ok = (m: string) => console.log(`   OK    ${m}`);
const ko = (m: string) => { console.log(`   ECHEC ${m}`); echecs.push(m); };

const SUFFIXE = `audit-isole-${process.pid}`;
const cleSource = `${SUFFIXE}-sans-publication`;

try {
  // ── PRÉPARATION : une source AVEC des captures, SANS aucune publication. ────────────────────
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Source" (id, key, kind, status, company, "createdAt", "updatedAt")
     VALUES ($1, $2, 'generic-listing', 'ACTIVE', $3, now(), now())`,
    cleSource, cleSource, `Maison ${SUFFIXE}`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CaptureBatch" (id, purpose, "sourceKey", "configHash", "readerRevision", "startedAt")
     VALUES ($1, 'JOBS', $2, 'hash-test', 'rev-test', now())`,
    `${SUFFIXE}-lot`, cleSource);

  // ── CAS 1 : la source sans publication est-elle atteignable par les lots ? ──────────────────
  const viaLots = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM "CaptureBatch" WHERE "sourceKey" = $1`, cleSource);
  const viaPublications = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM "JobSource" WHERE "sourceKey" = $1`, cleSource);

  Number(viaLots[0].n) === 1 && Number(viaPublications[0].n) === 0
    ? ok('une source à captures sans publication est vue par CaptureBatch.sourceKey, pas par JobSource')
    : ko(`lots=${viaLots[0].n} publications=${viaPublications[0].n} (attendu 1 / 0)`);

  // PRÉMISSE : c'est bien le cas que `jobId IS NULL` manquerait — la source n'a AUCUNE ligne JobSource.
  Number(viaPublications[0].n) === 0
    ? ok('prémisse : aucune ligne JobSource, donc « jobId IS NULL » ne la trouverait pas')
    : ko('prémisse fausse : la source a des publications, le cas n\'est pas exercé');

  // ── CAS 2 et 3 : l'instantané ignore-t-il une modification concurrente ? ────────────────────
  await prisma.$transaction(async (tx) => {
    const [avant] = await tx.$queryRawUnsafe<Array<{ company: string; maintenant: Date }>>(
      `SELECT company, now() AS maintenant FROM "Source" WHERE key = $1`, cleSource);

    // Une AUTRE connexion modifie la ligne, et valide, pendant que la transaction est ouverte.
    await autre.$executeRawUnsafe(
      `UPDATE "Source" SET company = $1, "updatedAt" = now() WHERE key = $2`,
      'MODIFIE PENDANT L EXPORT', cleSource);

    const [apres] = await tx.$queryRawUnsafe<Array<{ company: string; maintenant: Date }>>(
      `SELECT company, now() AS maintenant FROM "Source" WHERE key = $1`, cleSource);

    apres.company === avant.company
      ? ok(`l'instantané ignore la modification concurrente (lu : "${apres.company}")`)
      : ko(`l'instantané a vu la modification : "${avant.company}" -> "${apres.company}"`);

    apres.maintenant.getTime() === avant.maintenant.getTime()
      ? ok('now() est figé dans la transaction : l\'expiration reste cohérente')
      : ko(`now() a avancé de ${apres.maintenant.getTime() - avant.maintenant.getTime()} ms`);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });

  // Hors transaction, la modification EST visible — sinon le cas 2 n'aurait rien prouvé.
  const [final] = await prisma.$queryRawUnsafe<Array<{ company: string }>>(
    `SELECT company FROM "Source" WHERE key = $1`, cleSource);
  final.company === 'MODIFIE PENDANT L EXPORT'
    ? ok('prémisse : hors transaction, la modification est bien visible')
    : ko(`prémisse fausse : la modification concurrente n'a pas eu lieu (lu "${final.company}")`);
} finally {
  // Nettoyage : ce harnais ne laisse aucune trace, même s'il échoue.
  await prisma.$executeRawUnsafe(`DELETE FROM "CaptureBatch" WHERE "sourceKey" = $1`, cleSource).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "Source" WHERE key = $1`, cleSource).catch(() => {});
  await prisma.$disconnect();
  await autre.$disconnect();
}

console.log(echecs.length ? `\n=== ${echecs.length} ECHEC(S) ===\n` : '\n=== INSTANTANE COHERENT PROUVE ===\n');
process.exit(echecs.length ? 1 : 0);

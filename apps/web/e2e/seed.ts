import { PrismaClient } from '@prisma/client';

/**
 * E2E fixtures (N-07): a deterministic base for the Playwright suite, so the
 * critical-path tests assert against KNOWN data instead of skipping when the
 * API answers empty — a skip that once hid a fully broken board.
 *
 * Same guard as the aggregator's integration tests: this wipes tables, so it
 * refuses any database whose name does not mark it as a test DB.
 */

const url = process.env.DATABASE_URL ?? '';
const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!/test/i.test(dbName)) {
  console.error(`e2e seed refuses to run against "${dbName || url}" — use a *test* database.`);
  process.exit(1);
}

const prisma = new PrismaClient();

/** Fixed ids, so the 410/200 tests hit known URLs without API discovery. */
export const FIXTURES = {
  activeJobId: 'e2e-active-1',
  closedJobId: 'e2e-closed-1',
};

async function main() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});

  const company = await prisma.company.create({
    data: {
      name: 'Maison Fixture',
      canonicalKey: 'MAISON_FIXTURE',
      fashionjobsUrl: 'resolved:MAISON_FIXTURE',
      sector: 'LUXURY',
      kind: 'MAISON',
    },
  });

  const job = (id: string, title: string, isActive: boolean) =>
    prisma.job.create({
      data: {
        id,
        companyId: company.id,
        externalId: id,
        source: 'GREENHOUSE',
        title,
        location: 'Paris, France',
        city: 'PARIS',
        country: 'France',
        isFrance: true,
        contract: 'CDI',
        description:
          'Description complète de poste pour les tests bout-en-bout. '.repeat(10),
        language: 'fr',
        url: `https://careers.example.com/${id}`,
        isActive,
        fingerprint: `fp-${id}`,
        clusterKey: `${company.id}|PARIS`,
        sources: {
          create: {
            sourceKey: 'maison-fixture',
            sourceTier: 'ATS_OFFICIAL',
            externalId: id,
            url: `https://careers.example.com/${id}`,
            isActive,
          },
        },
      },
    });

  await job(FIXTURES.activeJobId, 'Vendeur / Vendeuse Boutique (H/F)', true);
  await job('e2e-active-2', 'Responsable Boutique (H/F)', true);
  await job('e2e-active-3', 'Conseiller de vente (H/F)', true);
  await job(FIXTURES.closedJobId, 'Offre expirée — CDI Vendeur', false);

  console.log('e2e fixtures seeded: 3 active offers, 1 closed, 1 Maison.');
}

// No top-level await: the web workspace has no "type": "module", so tsx
// transpiles this file as CJS.
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

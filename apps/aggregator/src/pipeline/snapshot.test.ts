import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runSnapshot, dayBounds, SNAPSHOT_SCOPES } from './snapshot.js';

/**
 * D38 — la photographie quotidienne : un jeu de 12 offres, 2 pays, 2 Maisons,
 * 3 fermées aujourd'hui (durées 4, 10, 2 jours), 1 fermée hier, 1 ré-ouverte
 * aujourd'hui. Chaque ligne attendue est calculée à la main dans les
 * commentaires ; rejouer le jour ne double rien ; le backfill reconstruit un
 * jour passé depuis firstSeenAt / closedAt.
 */

const prisma = new PrismaClient();
const NOW = new Date();
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

async function wipe() {
  await prisma.marketSnapshot.deleteMany({});
  await prisma.jobEvent.deleteMany({});
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
}

type Seed = {
  ext: string;
  city: string;
  country: string;
  firstSeenAt: Date;
  closedAt?: Date;
  isActive?: boolean;
  jobFunction?: string;
  isRetail?: boolean;
  isAiRelated?: boolean;
  seniority?: string;
  contract?: string;
};

async function seed(companyId: string, rows: Seed[]) {
  for (const row of rows) {
    await prisma.job.create({
      data: {
        companyId, externalId: row.ext, source: 'GENERIC_JSONLD', title: `Poste ${row.ext}`, url: `https://x/${row.ext}`,
        fingerprint: `fp-${row.ext}`, city: row.city, country: row.country, firstSeenAt: row.firstSeenAt,
        closedAt: row.closedAt ?? null, isActive: row.isActive ?? true,
        jobFunction: row.jobFunction ?? null, isRetail: row.isRetail ?? null, isAiRelated: row.isAiRelated ?? false,
        seniority: row.seniority ?? null, contract: row.contract ?? null,
      },
    });
  }
}

async function scenario() {
  const acme = await prisma.company.create({
    data: { name: 'Acme', canonicalKey: 'acme', fashionjobsUrl: 'resolved:acme', sector: 'LUXURY' },
  });
  const beta = await prisma.company.create({
    data: { name: 'Beta', canonicalKey: 'beta', fashionjobsUrl: 'resolved:beta', sector: 'FASHION', parentGroup: 'GroupB' },
  });
  await seed(acme.id, [
    { ext: 'a1', city: 'Paris', country: 'FR', firstSeenAt: NOW, jobFunction: 'retail-client-advisor', isRetail: true, seniority: 'JUNIOR', contract: 'CDI' },
    { ext: 'a2', city: 'Paris', country: 'FR', firstSeenAt: daysAgo(10) },
    { ext: 'a3', city: 'Paris', country: 'FR', firstSeenAt: daysAgo(10), jobFunction: 'atelier-craft', isRetail: false },
    { ext: 'a4', city: 'Paris', country: 'FR', firstSeenAt: daysAgo(10), jobFunction: 'finance', isRetail: false, isAiRelated: true },
    { ext: 'a5', city: 'Paris', country: 'FR', firstSeenAt: daysAgo(10), jobFunction: 'retail-store-management', isRetail: true },
    { ext: 'a6', city: 'Lyon', country: 'FR', firstSeenAt: daysAgo(10) },
    { ext: 'a7', city: 'Milan', country: 'IT', firstSeenAt: daysAgo(10) },
    { ext: 'a8', city: 'Paris', country: 'FR', firstSeenAt: daysAgo(4), closedAt: NOW, isActive: false },
  ]);
  await seed(beta.id, [
    { ext: 'b1', city: 'Milan', country: 'IT', firstSeenAt: daysAgo(10) },
    { ext: 'b2', city: 'Milan', country: 'IT', firstSeenAt: daysAgo(10), closedAt: NOW, isActive: false },
    { ext: 'b3', city: 'Paris', country: 'FR', firstSeenAt: daysAgo(2), closedAt: NOW, isActive: false },
    { ext: 'b4', city: 'Paris', country: 'FR', firstSeenAt: daysAgo(10), closedAt: daysAgo(1), isActive: false },
  ]);
  const a2 = await prisma.job.findFirstOrThrow({ where: { externalId: 'a2' } });
  await prisma.jobEvent.create({ data: { jobId: a2.id, type: 'REOPENED', at: NOW } });
  // Les fermetures du jour sont des ÉVÉNEMENTS (le refresh les écrit) : en
  // live, c'est eux que la photographie compte, pas `closedAt` (audit I-2).
  for (const ext of ['a8', 'b2', 'b3']) {
    const job = await prisma.job.findFirstOrThrow({ where: { externalId: ext } });
    await prisma.jobEvent.create({ data: { jobId: job.id, type: 'CLOSED', at: NOW } });
  }
  return { acme, beta };
}

async function row(scope: string, key: string, date = dayBounds(NOW).day) {
  const found = await prisma.marketSnapshot.findUnique({ where: { date_scope_key: { date, scope, key } } });
  if (!found) return null;
  const { activeJobs, newJobs, closedJobs, hiringCompanies, medianLifespanDays, reopenedJobs } = found;
  return { activeJobs, newJobs, closedJobs, hiringCompanies, medianLifespanDays, reopenedJobs };
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('runSnapshot — le jour même (live)', () => {
  it('écrit les lignes attendues par périmètre, exactes', async () => {
    const { acme, beta } = await scenario();

    const stats = await runSnapshot(prisma, { now: NOW });
    expect(stats.days).toHaveLength(1);
    expect(stats.days[0].mode).toBe('live');

    // global : actives a1..a7 + b1 = 8 ; nouvelle a1 ; fermées a8, b2, b3 ; 2 Maisons ; médiane {4,10,2} = 4 ; a2 ré-ouverte.
    expect(await row('global', '')).toEqual({ activeJobs: 8, newJobs: 1, closedJobs: 3, hiringCompanies: 2, medianLifespanDays: 4, reopenedJobs: 1 });
    // FR : actives a1..a6 = 6 ; fermées a8, b3 ; Acme seule recrute ; médiane {4,2} = 3.
    expect(await row('country', 'FR')).toEqual({ activeJobs: 6, newJobs: 1, closedJobs: 2, hiringCompanies: 1, medianLifespanDays: 3, reopenedJobs: 1 });
    // IT : actives a7, b1 ; fermée b2 (10 j) ; les deux Maisons.
    expect(await row('country', 'IT')).toEqual({ activeJobs: 2, newJobs: 0, closedJobs: 1, hiringCompanies: 2, medianLifespanDays: 10, reopenedJobs: 0 });
    // Ville : Paris seule atteint 5 actives (a1..a5) ; Lyon (1) et Milan (2) n'existent pas.
    expect(await row('city', 'FR|Paris')).toEqual({ activeJobs: 5, newJobs: 1, closedJobs: 2, hiringCompanies: 1, medianLifespanDays: 3, reopenedJobs: 1 });
    expect(await row('city', 'FR|Lyon')).toBeNull();
    expect(await row('city', 'IT|Milan')).toBeNull();
    expect(stats.days[0].byScope.city).toBe(1);
    // Maisons.
    expect(await row('company', acme.id)).toEqual({ activeJobs: 7, newJobs: 1, closedJobs: 1, hiringCompanies: 1, medianLifespanDays: 4, reopenedJobs: 1 });
    expect(await row('company', beta.id)).toEqual({ activeJobs: 1, newJobs: 0, closedJobs: 2, hiringCompanies: 1, medianLifespanDays: 6, reopenedJobs: 0 });
    // Groupe : Acme n'en a pas ; Beta = GroupB.
    expect(stats.days[0].byScope.group).toBe(1);
    expect(await row('group', 'GroupB')).toEqual({ activeJobs: 1, newJobs: 0, closedJobs: 2, hiringCompanies: 1, medianLifespanDays: 6, reopenedJobs: 0 });
    // Secteur (enum de la Maison).
    expect(await row('sector', 'LUXURY')).toEqual({ activeJobs: 7, newJobs: 1, closedJobs: 1, hiringCompanies: 1, medianLifespanDays: 4, reopenedJobs: 1 });
    expect(await row('sector', 'FASHION')).toEqual({ activeJobs: 1, newJobs: 0, closedJobs: 2, hiringCompanies: 1, medianLifespanDays: 6, reopenedJobs: 0 });
    // Métier : null compte comme « unclassified », jamais deviné.
    expect(stats.days[0].byScope.function).toBe(5);
    expect(await row('function', 'retail-client-advisor')).toEqual({ activeJobs: 1, newJobs: 1, closedJobs: 0, hiringCompanies: 1, medianLifespanDays: null, reopenedJobs: 0 });
    expect(await row('function', 'unclassified')).toEqual({ activeJobs: 4, newJobs: 0, closedJobs: 3, hiringCompanies: 2, medianLifespanDays: 4, reopenedJobs: 1 });
    // Famille : craft tranché par la fonction, pas par isRetail=false.
    expect(await row('family', 'craft')).toMatchObject({ activeJobs: 1 });
    expect(await row('family', 'retail')).toMatchObject({ activeJobs: 2 });
    expect(await row('family', 'corporate')).toMatchObject({ activeJobs: 1 });
    expect(await row('family', 'unclassified')).toMatchObject({ activeJobs: 4, closedJobs: 3 });
    // Séniorité, contrat, IA.
    expect(await row('seniority', 'JUNIOR')).toMatchObject({ activeJobs: 1 });
    expect(await row('seniority', 'unclassified')).toMatchObject({ activeJobs: 7 });
    expect(await row('contract', 'CDI')).toMatchObject({ activeJobs: 1 });
    expect(await row('contract', 'UNKNOWN')).toMatchObject({ activeJobs: 7 });
    expect(await row('ai', 'true')).toEqual({ activeJobs: 1, newJobs: 0, closedJobs: 0, hiringCompanies: 1, medianLifespanDays: null, reopenedJobs: 0 });
    // Croisements : pays×métier n'atteint jamais 5 actives ici ; pays×secteur FR|LUXURY = 6.
    expect(stats.days[0].byScope['country-function']).toBe(0);
    expect(stats.days[0].byScope['country-sector']).toBe(1);
    expect(await row('country-sector', 'FR|LUXURY')).toEqual({ activeJobs: 6, newJobs: 1, closedJobs: 1, hiringCompanies: 1, medianLifespanDays: 4, reopenedJobs: 1 });

    // Hier n'existe pas : b4 (fermée hier) n'apparaît nulle part aujourd'hui.
    expect(await prisma.marketSnapshot.count({ where: { closedJobs: 4 } })).toBe(0);
    // Chaque périmètre a été visité.
    expect(Object.keys(stats.days[0].byScope).sort()).toEqual([...SNAPSHOT_SCOPES].sort());
    expect(stats.rows).toBe(await prisma.marketSnapshot.count());
  });

  it('rejouer le même jour ne double rien', async () => {
    await scenario();
    const first = await runSnapshot(prisma, { now: NOW });
    const second = await runSnapshot(prisma, { now: NOW });
    expect(second.rows).toBe(first.rows);
    expect(await prisma.marketSnapshot.count()).toBe(first.rows);
    expect(await row('global', '')).toMatchObject({ activeJobs: 8, closedJobs: 3 });
  });

  it('une fermeture du jour reste comptée après une ré-ouverture (événement immuable, pas closedAt)', async () => {
    await scenario();
    // b3 fermée puis ré-ouverte le même jour : closedAt repasse à null.
    const b3 = await prisma.job.findFirstOrThrow({ where: { externalId: 'b3' } });
    await prisma.job.update({ where: { id: b3.id }, data: { isActive: true, closedAt: null, reopenedCount: 1, events: { create: { type: 'REOPENED', at: NOW } } } });
    await runSnapshot(prisma, { now: NOW });
    expect(await row('global', '')).toMatchObject({ activeJobs: 9, closedJobs: 3, reopenedJobs: 2 });
    expect((await prisma.marketSnapshot.findFirst({ where: { scope: 'global' } }))?.mode).toBe('live');
  });

  it('refuse un jour futur', async () => {
    await expect(runSnapshot(prisma, { now: NOW, date: daysAgo(-1) })).rejects.toThrow(/future/);
  });
});

describe('runSnapshot — backfill (reconstruction)', () => {
  it('reconstruit chaque jour passé depuis firstSeenAt / closedAt, et prend le jour même en live', async () => {
    await scenario();
    const stats = await runSnapshot(prisma, { now: NOW, backfillFrom: daysAgo(3) });
    expect(stats.days.map((d) => d.mode)).toEqual(['reconstructed', 'reconstructed', 'reconstructed', 'live']);

    // J-3 : actives à la fin du jour = nées avant et pas fermées avant : a2..a7 (6), a8 (née J-4, fermée aujourd'hui),
    // b1, b2 (fermée aujourd'hui), b4 (fermée hier, sans closedAt aujourd'hui… avec closedAt = hier) = 10. a1 (aujourd'hui) et b3 (J-2) non.
    const d3 = dayBounds(daysAgo(3)).day;
    expect(await row('global', '', d3)).toEqual({ activeJobs: 10, newJobs: 0, closedJobs: 0, hiringCompanies: 2, medianLifespanDays: null, reopenedJobs: 0 });
    // J-2 : b3 naît ce jour-là → nouvelle, et active : 11.
    const d2 = dayBounds(daysAgo(2)).day;
    expect(await row('global', '', d2)).toMatchObject({ activeJobs: 11, newJobs: 1 });
    // J-1 : b4 fermée ce jour-là (durée 9 j) → closedJobs 1, active 10.
    const d1 = dayBounds(daysAgo(1)).day;
    expect(await row('global', '', d1)).toMatchObject({ activeJobs: 10, closedJobs: 1, medianLifespanDays: 9 });
    // Aujourd'hui : la vérité `isActive`.
    expect(await row('global', '')).toMatchObject({ activeJobs: 8, newJobs: 1, closedJobs: 3 });
    expect(await prisma.marketSnapshot.groupBy({ by: ['date'] })).toHaveLength(4);
  });

  it('une reconstruction n’écrase JAMAIS un jour photographié live', async () => {
    await scenario();
    // Hier, photographié « en direct » (simulé : now = hier), avec la vérité d'hier.
    const yesterday = daysAgo(1);
    await runSnapshot(prisma, { now: yesterday });
    const liveYesterday = await row('global', '', dayBounds(yesterday).day);
    expect((await prisma.marketSnapshot.findFirst({ where: { date: dayBounds(yesterday).day } }))?.mode).toBe('live');
    // Aujourd'hui, un backfill qui repasse sur hier depuis l'état actuel des offres.
    const stats = await runSnapshot(prisma, { now: NOW, backfillFrom: daysAgo(2) });
    expect(stats.days.map((d) => [d.mode, d.skippedLive ?? false])).toEqual([
      ['reconstructed', false], ['reconstructed', true], ['live', false],
    ]);
    expect(await row('global', '', dayBounds(yesterday).day)).toEqual(liveYesterday);
    expect((await prisma.marketSnapshot.findFirst({ where: { date: dayBounds(daysAgo(2)).day } }))?.mode).toBe('reconstructed');
  });

  it('une offre fermée avant closedAt (isActive false, closedAt null) est fermée à son lastSeenAt', async () => {
    const acme = await prisma.company.create({ data: { name: 'Acme', canonicalKey: 'acme', fashionjobsUrl: 'resolved:acme' } });
    await prisma.job.create({
      data: {
        companyId: acme.id, externalId: 'old', source: 'GENERIC_JSONLD', title: 'Ancienne', url: 'https://x/old', fingerprint: 'fp-old',
        firstSeenAt: daysAgo(10), lastSeenAt: daysAgo(5), isActive: false, closedAt: null, country: 'FR',
      },
    });
    await runSnapshot(prisma, { now: NOW, backfillFrom: daysAgo(6) });
    expect(await row('global', '', dayBounds(daysAgo(6)).day)).toMatchObject({ activeJobs: 1 });
    expect(await row('global', '', dayBounds(daysAgo(4)).day)).toBeNull(); // plus rien ce jour-là : aucune ligne
  });
});

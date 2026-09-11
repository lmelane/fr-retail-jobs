import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { runRefresh } from './refresh.js';
import { checkSourceHealth } from './health.js';
import { enumerationVerdict, verdictToComplete } from './enumeration.js';

/**
 * LES QUATRE CAS BORNÉS DE LA RÈGLE « SEUL UN PARCOURS DÉMONTRÉ FERME » (2026-09-11).
 *
 * Ils s'exécutent sur le CHEMIN RÉEL : `checkSourceHealth` calcule `canAttestAbsence` comme en production, puis
 * `runRefresh` — la fonction de clôture elle-même — décide. Aucun prédicat n'est testé en isolation ici : c'est
 * exactement ce qui manquait, puisqu'un verdict correct peut très bien être mal consommé en aval.
 *
 * Ce qu'ils verrouillent, un par un :
 *
 *   1. UNKNOWN, MÊME volume que le run précédent mais ensemble d'identifiants DIFFÉRENT → aucune fermeture.
 *      C'est le cœur de l'objection : un volume stable ne prouve pas qu'on a parcouru le même périmètre.
 *   2. UNKNOWN à 60 % du volume précédent → aucune fermeture, bien que la garde d'effondrement (50 %) soit
 *      franchie. Franchir un indicateur de santé n'est pas une preuve de disparition.
 *   3. Total déclaré 100, 90 identifiants lus → aucune fermeture. Les 10 % non lus ne sont pas attestés.
 *   4. ATS sans total dont la pagination est réellement parcourue jusqu'à sa fin → PROVEN, fermeture autorisée.
 */

const prisma = new PrismaClient();
const STALE = new Date(Date.now() - 30 * 86_400_000);
const FRESH = new Date();

/** Attache N offres à une source, vues pour la dernière fois à l'instant donné. */
async function addPostings(sourceKey: string, externalIds: string[], lastSeenAt: Date) {
  const company = await prisma.company.findFirst({ where: { name: `CRP ${sourceKey}` } })
    ?? await prisma.company.create({ data: { name: `CRP ${sourceKey}`, canonicalKey: `CRP ${sourceKey}`,
      fashionjobsUrl: `https://crp.example/${sourceKey}` } });
  const ids: string[] = [];
  for (const externalId of externalIds) {
    const key = `${sourceKey}-${externalId}`;
    const job = await prisma.job.create({ data: {
      companyId: company.id, title: `Poste ${externalId}`, url: `https://crp.example/${sourceKey}/${externalId}`,
      source: 'GENERIC_JSONLD', externalId: key, fingerprint: `crp:${key}`, pipelineVersion: 1,
      isActive: true, firstSeenAt: lastSeenAt, lastSeenAt,
      canonicalSourceKey: sourceKey, canonicalExternalId: key, canonicalTier: 'EMPLOYER_DIRECT',
    } });
    await prisma.jobSource.create({ data: {
      jobId: job.id, sourceKey, sourceTier: 'EMPLOYER_DIRECT', externalId: key,
      url: job.url, isActive: true, firstSeenAt: lastSeenAt, lastSeenAt,
    } });
    ids.push(job.id);
  }
  return ids;
}

/** Un décor minimal : N offres attestées par une source, toutes périmées depuis 30 jours. */
const seed = (sourceKey: string, externalIds: string[]) => addPostings(sourceKey, externalIds, STALE);

/**
 * Le run est enregistré par `checkSourceHealth`, donc `canAttestAbsence` est calculé par le code de production
 * et non posé à la main : c'est ce qui fait de ces tests une épreuve du chemin réel.
 */
async function recordRun(sourceKey: string, stat: {
  jobs: number; fetched?: number; declaredTotal?: number; complete?: boolean; truncated?: boolean;
}) {
  await checkSourceHealth(prisma, [{
    source: sourceKey, fetched: stat.fetched ?? stat.jobs, created: 0, merged: 0, updated: stat.jobs,
    france: stat.jobs, inSector: stat.jobs, errors: 0, withDescription: stat.jobs, withDate: stat.jobs,
    withCountry: stat.jobs, withUrl: stat.jobs,
    ...(stat.declaredTotal === undefined ? {} : { declaredTotal: stat.declaredTotal }),
    ...(stat.complete === undefined ? {} : { complete: stat.complete }),
    ...(stat.truncated === undefined ? {} : { truncated: stat.truncated }),
  } as never]);
  return prisma.sourceRun.findFirstOrThrow({ where: { sourceKey }, orderBy: { ranAt: 'desc' } });
}

const stateOf = (ids: string[]) => prisma.job.findMany({ where: { id: { in: ids } },
  select: { id: true, externalId: true, isActive: true, closedAt: true, withdrawnAt: true }, orderBy: { externalId: 'asc' } });

describe('seul un parcours démontré ferme une offre', () => {
  // La base d'intégration est vidée entre les tests : les autres sources ne doivent ni peser sur la garde de
  // fermeture de masse, ni laisser un `SourceRun` qui servirait de référence à un run qu'on veut sans passé.
  beforeEach(async () => {
    await prisma.jobEvent.deleteMany({});
    await prisma.jobSource.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.sourceRun.deleteMany({});
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('1. UNKNOWN, même volume mais identifiants DIFFÉRENTS : aucune offre absente n\'est fermée', async () => {
    // Premier passage : la source atteste A/B/C. Le run ne démontre pas la fin de son parcours.
    const first = await seed('crp-ids', ['A', 'B', 'C']);
    await recordRun('crp-ids', { jobs: 3 });

    /**
     * Second passage sur LA MÊME source : elle atteste maintenant D/E/F, fraîchement vues, tandis que A/B/C ne
     * sont plus relistées depuis 30 jours. Le volume est identique (3 → 3), l'ENSEMBLE est entièrement
     * différent. C'est exactement le cas que le volume de référence ne peut pas distinguer : A/B/C ont-elles
     * disparu, ou le balayage a-t-il lu une autre partie du board ?
     */
    const second = await addPostings('crp-ids', ['D', 'E', 'F'], FRESH);
    const run = await recordRun('crp-ids', { jobs: 3 });
    expect(run.previousJobs).toBe(3);
    expect(run.complete).toBeNull();
    expect(run.canAttestAbsence).toBe(false);

    await runRefresh(prisma);
    // Les trois offres absentes du second ensemble restent ACTIVES : rien ne prouve leur disparition.
    const absent = await stateOf(first);
    expect(absent).toHaveLength(3);
    expect(absent.every((j) => j.isActive && !j.closedAt && !j.withdrawnAt)).toBe(true);
    // Et les trois nouvelles n'ont pas été touchées non plus.
    expect((await stateOf(second)).every((j) => j.isActive)).toBe(true);
  });

  it('2. UNKNOWN à 60 % du volume précédent : aucune fermeture, bien que la garde à 50 % soit franchie', async () => {
    const ids = await seed('crp-60', ['A', 'B', 'C', 'D', 'E']);
    await recordRun('crp-60', { jobs: 100 });
    // 60 > 50 : l'indicateur d'effondrement est franchi. Ce n'est pas une preuve de parcours.
    const run = await recordRun('crp-60', { jobs: 60 });
    expect(run.previousJobs).toBe(100);
    expect(run.canAttestAbsence).toBe(false);

    await runRefresh(prisma);
    const after = await stateOf(ids);
    expect(after.every((j) => j.isActive && !j.closedAt && !j.withdrawnAt)).toBe(true);
  });

  it('3. total déclaré 100, 90 identifiants lus : aucune fermeture sans preuve de fin d\'énumération', async () => {
    const ids = await seed('crp-90', ['A', 'B', 'C']);
    // 90 % franchit le seuil de couverture — indicateur de santé — mais les 10 % non lus ne sont pas attestés.
    const run = await recordRun('crp-90', { jobs: 90, fetched: 90, declaredTotal: 100 });
    expect(verdictToComplete(enumerationVerdict({ declaredTotal: 100, uniqueCollected: 90 }))).toBeUndefined();
    expect(run.canAttestAbsence).toBe(false);

    await runRefresh(prisma);
    const after = await stateOf(ids);
    expect(after.every((j) => j.isActive && !j.closedAt)).toBe(true);
  });

  it('4. ATS sans total, pagination parcourue jusqu\'à sa fin : PROVEN et fermeture autorisée', async () => {
    const ids = await seed('crp-proven', ['A', 'B', 'C']);
    // Le cas Teamtailor / Recruitee / Personio : aucun total déclaré, mais la fin du parcours est démontrée
    // (`next_url: null`, ou endpoint unique servi en entier).
    expect(enumerationVerdict({ uniqueCollected: 3, adapterProvesCompletion: true })).toBe('PROVEN');
    await recordRun('crp-proven', { jobs: 3, complete: true });
    const run = await recordRun('crp-proven', { jobs: 3, complete: true });
    expect(run.complete).toBe(true);
    expect(run.canAttestAbsence).toBe(true);

    await runRefresh(prisma);
    const after = await stateOf(ids);
    // Les offres n'ont pas été relistées depuis 30 jours et le parcours est démontré : elles se ferment.
    expect(after.every((j) => !j.isActive && j.closedAt && !j.withdrawnAt)).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { occupationManifestHash } from '@catwalks/db/occupations';
import { conceptsDe, pageApprise, versionActive } from './taxonomie-export';
import { enregistrerSignalement, lireSignalement, resolutions } from './signalements-metier';

/**
 * Lot 2E de D-475 (plan §3.7), CONTRE UNE BASE LOCALE DÉDIÉE (nom contenant « test », toutes migrations appliquées) :
 * l'export sert la version ACTIVE réelle (le manifeste v3 publié), et la table des signaux tient ses contraintes.
 * Sauté ailleurs : jamais contre la production.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const MANIFESTE = join(__dirname, '..', '..', '..', 'audits', '2026-09-28', 'curation-v3', '6-manifeste-v3.json');
const PREFIXE = 'temoin-2e-';

describe.skipIf(!enabled)('export de la taxonomie et signaux « métier manquant » (base locale dédiée)', () => {
  let releaseId = '';
  beforeAll(async () => {
    const manifest = JSON.parse(readFileSync(MANIFESTE, 'utf8'));
    releaseId = manifest.id;
    const existe = await prisma.occupationRelease.findUnique({ where: { id: releaseId }, select: { id: true } });
    // Une version publiée est une preuve immuable : on la publie une fois dans la base de témoin, jamais on ne l'efface.
    if (!existe) await prisma.occupationRelease.create({ data: { id: releaseId, contentHash: occupationManifestHash(manifest), manifest } });
    await prisma.occupationState.upsert({ where: { id: 'active' }, create: { id: 'active', releaseId }, update: { releaseId } });
    await prisma.$executeRaw`DELETE FROM "OccupationMissingSignal" WHERE "externalId" LIKE ${`${PREFIXE}%`}`;
  });
  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "OccupationMissingSignal" WHERE "externalId" LIKE ${`${PREFIXE}%`}`;
    await prisma.$disconnect();
  });

  it('l’export sert la version active, son empreinte stockée, et tous ses concepts', async () => {
    const { version, taxonomie, apprise } = await versionActive();
    expect(version.releaseId).toBe(releaseId);
    const stockee = await prisma.occupationRelease.findUniqueOrThrow({ where: { id: releaseId }, select: { contentHash: true } });
    expect(version.empreinte).toBe(stockee.contentHash);
    expect(apprise).toBeNull();
    const concepts = conceptsDe(taxonomie);
    // Chaque concept exporté est connu des déclencheurs d'intégrité de la version (mêmes clés).
    const cles = await prisma.occupationReleaseConcept.count({ where: { releaseId } });
    expect(concepts).toHaveLength(cles);
    expect(await pageApprise('aucune-version-apprise', null, 10)).toEqual({ entrees: [], suivant: null });
  });

  it('un signal est enregistré une fois ; un renvoi ne le réécrit pas', async () => {
    const s = lireSignalement({ id: `${PREFIXE}a`, offreId: 'cmoffre1', titre: 'Conseiller clienteling', metierChoisi: 'sales-advisor', commentaire: 'première', signaleLe: '2026-09-30T21:00:00Z' });
    expect(await enregistrerSignalement(s)).toEqual({ cree: true });
    expect(await enregistrerSignalement({ ...s, commentaire: 'seconde' })).toEqual({ cree: false });
    const ligne = await prisma.occupationMissingSignal.findUniqueOrThrow({ where: { source_externalId: { source: 'backend', externalId: s.id } } });
    expect(ligne).toMatchObject({ comment: 'première', status: 'OPEN', offerId: 'cmoffre1', chosenOccupation: 'sales-advisor' });
    expect(await resolutions([s.id, 'inconnu'])).toEqual([{ id: s.id, statut: 'ouvert', metier: null, releaseId: null, resoluLe: null }]);
  });

  it('une résolution nomme un métier que sa version publie, sinon la base la refuse', async () => {
    const s = lireSignalement({ id: `${PREFIXE}b`, offreId: 'cmoffre2', titre: 'X', metierChoisi: null, commentaire: null, signaleLe: '2026-09-30T21:00:00Z' });
    await enregistrerSignalement(s);
    const ou = { source_externalId: { source: 'backend', externalId: s.id } };
    await expect(prisma.occupationMissingSignal.update({ where: ou, data: { status: 'RESOLVED', resolvedOccupation: 'metier-invente', resolvedReleaseId: releaseId, resolvedAt: new Date() } }))
      .rejects.toThrow(/unknown to release/);
    // Un statut résolu sans métier est refusé par la contrainte.
    await expect(prisma.occupationMissingSignal.update({ where: ou, data: { status: 'RESOLVED', resolvedAt: new Date() } })).rejects.toThrow();
    await prisma.occupationMissingSignal.update({ where: ou, data: { status: 'RESOLVED', resolvedOccupation: 'sales-advisor', resolvedReleaseId: releaseId, resolvedAt: new Date('2026-10-31T00:00:00Z') } });
    expect(await resolutions([s.id])).toEqual([{ id: s.id, statut: 'resolu', metier: 'sales-advisor', releaseId, resoluLe: '2026-10-31T00:00:00.000Z' }]);
  });
});

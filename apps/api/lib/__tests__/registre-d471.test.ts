import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DirectOffer } from '@prisma/client';
import { prisma } from '@catwalks/db';
import { refuserSiCleInvalide } from '../cle-api';
import { directToRow } from '../direct-offers';
import { projeterFiche, projeterLigne } from '../projection';
import { rechercherSocietes } from '../registre';

/**
 * D-471 — LE BACKEND, SECOND APPELANT DE L'API, ET CE QU'IL Y LIT.
 *
 *  - Sa clé (`CATALOGUE_API_KEY_BACKEND`) n'ouvre que les routes qui le nomment : la fiche d'une offre et la recherche
 *    du registre. La clé du site ne lit pas le registre.
 *  - La recherche du registre ne rend que des sociétés canoniques, trouvées sans casse ni accents, par leur nom ou un
 *    alias REVU ; le fragment saisi n'est jamais un motif.
 *  - Une offre Catwalks sert le domaine de son logo et son visuel ; la ligne de liste ne porte pas le visuel.
 */
const requete = (autorisation?: string): NextRequest =>
  ({ headers: new Headers(autorisation ? { authorization: autorisation } : {}) }) as NextRequest;

describe('le garde de clé à deux appelants (D-464 §3, D-471)', () => {
  beforeEach(() => {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-du-site');
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-du-backend');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('par défaut, une route reste au site : la clé du backend y est refusée', () => {
    expect(refuserSiCleInvalide(requete('Bearer cle-du-site'), 'r')).toBeNull();
    expect(refuserSiCleInvalide(requete('Bearer cle-du-backend'), 'r')?.status).toBe(401);
  });

  it('une route qui nomme les deux accepte les deux, et rien d’autre', () => {
    expect(refuserSiCleInvalide(requete('Bearer cle-du-site'), 'r', ['site', 'backend'])).toBeNull();
    expect(refuserSiCleInvalide(requete('Bearer cle-du-backend'), 'r', ['site', 'backend'])).toBeNull();
    for (const entete of [undefined, 'Bearer ', 'Bearer autre', 'Basic cle-du-backend'])
      expect(refuserSiCleInvalide(requete(entete), 'r', ['site', 'backend'])?.status).toBe(401);
  });

  it('une route réservée au backend refuse la clé du site', () => {
    expect(refuserSiCleInvalide(requete('Bearer cle-du-backend'), 'r', ['backend'])).toBeNull();
    expect(refuserSiCleInvalide(requete('Bearer cle-du-site'), 'r', ['backend'])?.status).toBe(401);
  });

  it('en production, une route réservée au backend sans sa clé ferme en 503, même si la clé du site existe', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', '');
    expect(refuserSiCleInvalide(requete('Bearer cle-du-site'), 'r', ['backend'])?.status).toBe(503);
    // La route du site, elle, continue de servir le site.
    expect(refuserSiCleInvalide(requete('Bearer cle-du-site'), 'r')).toBeNull();
  });

  it('les routes du backend le nomment, et elles seules (D-471, lot 2E de D-475, R-130 §10)', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const racine = join(__dirname, '..', '..', 'app', 'api');
    const routes: string[] = [];
    const parcourir = (dossier: string) => {
      for (const e of readdirSync(dossier, { withFileTypes: true })) {
        if (e.isDirectory()) parcourir(join(dossier, e.name));
        else if (e.name === 'route.ts') routes.push(join(dossier, e.name));
      }
    };
    parcourir(racine);
    // PRÉMISSE : le parcours voit bien toutes les routes, sinon « elles seules » ne prouverait rien.
    expect(routes.length).toBeGreaterThanOrEqual(10);
    const nommantLeBackend = routes.filter((r) => /['"]backend['"]/.test(readFileSync(r, 'utf8'))).map((r) => relative(racine, r)).sort();
    expect(nommantLeBackend).toEqual(['alertes/examen/route.ts', 'metiers/signalements/route.ts', 'offres/[id]/route.ts', 'registre/societes/route.ts', 'taxonomie/export/route.ts']);
    expect(readFileSync(join(racine, 'registre', 'societes', 'route.ts'), 'utf8')).toContain("['backend']");
  });
});

describe('la route du registre (D-471)', () => {
  beforeEach(() => {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-du-site');
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-du-backend');
  });
  afterEach(() => vi.unstubAllEnvs());
  const appeler = async (q: string, cle = 'cle-du-backend') => {
    const { GET } = await import('../../app/api/registre/societes/route');
    return GET(new NextRequest(`https://example.com/api/registre/societes?q=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${cle}` } }));
  };

  it('refuse la clé du site, et borne le fragment (2 à 80 caractères) avant toute lecture', async () => {
    expect((await appeler('lancel', 'cle-du-site')).status).toBe(401);
    for (const q of ['', ' l ', 'x'.repeat(81)]) expect((await appeler(q)).status).toBe(400);
  });

});

describe('le domaine et le visuel d’une offre Catwalks (D-471)', () => {
  const directe = (surcharge: Partial<DirectOffer> = {}) => ({
    id: 'cmliste0001', eligible: true, validThrough: null, title: 'Conseiller de vente', company: 'Lancel', companyDomain: 'lancel.com',
    visuel: 'https://storage.googleapis.com/catwalks-storage-medias-publics/jobs/cmliste0001.webp', slug: 'conseiller-de-vente',
    applyUrl: 'https://catwalks.io/offres/conseiller-de-vente', sectorCodes: [], salaryMin: null, salaryMax: null, salaryCurrency: null,
    salaryPeriod: null, postedAt: new Date('2026-09-22'), receivedAt: new Date('2026-09-22'), ...surcharge,
  }) as unknown as DirectOffer;

  it('la ligne sert le domaine projeté et le visuel ; un mandat n’a pas de domaine', () => {
    expect(directToRow(directe())).toMatchObject({ origine: 'CATWALKS', companyDomain: 'lancel.com', visuel: expect.stringContaining('.webp') });
    expect(directToRow(directe({ company: 'Catwalks', companyDomain: null }))).toMatchObject({ company: 'Catwalks', companyDomain: null });
  });

  it('la fiche porte le visuel, la ligne de liste non', () => {
    const ligne = directToRow(directe());
    expect(projeterFiche(ligne).visuel).toContain('.webp');
    expect(projeterLigne(ligne)).not.toHaveProperty('visuel');
    expect(projeterLigne(ligne)).not.toHaveProperty('description');
  });
});

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const R = 'temoinregistre';
const REVUE = 'temoin-registre-d471-revue';

describe.skipIf(!enabled)('la recherche du registre, sur une vraie base (D-471)', () => {
  const nettoyer = async () => {
    await prisma.companyAlias.deleteMany({ where: { companyId: { startsWith: R } } });
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: R } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: R } } });
    await prisma.company.updateMany({ where: { id: { startsWith: R } }, data: { mergedIntoId: null } });
    await prisma.company.deleteMany({ where: { id: { startsWith: R } } });
  };
  const societe = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    prisma.company.create({ data: { id: `${R}${id}`, name, canonicalKey: `${R}${id}`, fashionjobsUrl: `resolved:${R}${id}`, ...extra } });
  const offres = async (id: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const lien = `https://example.com/${R}/${id}/${i}`;
      await prisma.job.create({ data: {
        id: `${R}${id}offre${i}`, companyId: `${R}${id}`, source: 'GENERIC_JSONLD', externalId: `${id}-${i}`, title: 'Conseiller de vente', url: lien,
        city: 'Paris', countryCode: 'FR', language: 'fr', isActive: true, postedAt: new Date('2026-09-01'), firstSeenAt: new Date('2026-09-01'),
        sources: { create: { sourceKey: R, sourceTier: 'ATS_OFFICIAL', externalId: `${id}-${i}`, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: R, sourceTier: 'ATS_OFFICIAL', externalId: `${id}-${i}`, url: lien, title: 'Conseiller de vente', city: 'Paris', country: 'FR', language: 'fr', postedAt: new Date('2026-09-01') }) } },
      } });
    }
  };

  beforeAll(async () => {
    await nettoyer();
    // La revue d'identité est en ajout seul (déclencheur) : elle reste d'une exécution à l'autre, insérée sans doublon.
    await prisma.employerIdentityReview.createMany({ data: [{ id: REVUE, statement: 'Témoin D-471 : alias revu.', evidence: {},
      planHash: 'temoin-registre-d471', reviewedBy: 'temoin', reviewedAt: new Date('2026-09-27') }], skipDuplicates: true });
    await societe('loewe', 'Loewe Temoinregistre', { domain: 'loewe.com' });
    await societe('perfumes', 'Perfumes Loewe Temoinregistre', { domain: 'loewe.com' });
    await societe('sezane', 'Sézane Témoinregistre');
    await societe('survivante', 'Lancel Temoinregistre', { domain: 'lancel.com', parentGroup: 'Piquadro' });
    await societe('absorbee', 'Lancel Temoinregistre Paris');
    // Une fusion exige une décision revue (contrainte `Company_identity_relationship_review`).
    await prisma.company.update({ where: { id: `${R}absorbee` }, data: { mergedIntoId: `${R}survivante`, identityReviewId: REVUE } });
    await societe('joker', 'Maison 100% Temoinregistre');
    // Ce que `%` et `_` trouveraient s'ils redevenaient des jokers.
    await societe('cent', 'Maison 100 Ans Temoinregistre');
    await societe('souligne', 'Maison_Souligne Temoinregistre');
    // Deux sociétés qui commencent par le même fragment : l'une publie plus que l'autre, que l'ordre alphabétique placerait devant.
    await societe('alpha', 'Loewe Temoinregistre Alpha');
    await societe('beta', 'Loewe Temoinregistre Beta');
    await societe('alias', 'Nom Officiel Temoinregistre');
    // Un alias revu porte son libellé normalisé (contrainte `CompanyAlias_reviewed_label`).
    await prisma.companyAlias.create({ data: { aliasKey: `${R}revu`, displayName: 'Atelier Revu Temoinregistre', normalizedName: `${R} atelier revu`, companyId: `${R}alias`, reviewId: REVUE } });
    await prisma.companyAlias.create({ data: { aliasKey: `${R}nonrevu`, displayName: 'Atelier Brut Temoinregistre', companyId: `${R}alias` } });
    await offres('loewe', 3);
    await offres('perfumes', 1);
    await offres('alpha', 1);
    await offres('beta', 2);
  }, 120_000);
  afterAll(nettoyer);

  it('sans casse ni accents, sociétés canoniques seulement, avec domaine, groupe et offres publiables', async () => {
    const sezane = await rechercherSocietes('SEZANE temoinregistre');
    expect(sezane.map((s) => s.id)).toEqual([`${R}sezane`]);
    const lancel = await rechercherSocietes('lancel temoinregistre');
    // PRÉMISSE : la société absorbée est fusionnée ET son nom contient le fragment cherché ; elle ne sort pas, sa survivante oui.
    const absorbee = await prisma.company.findUniqueOrThrow({ where: { id: `${R}absorbee` } });
    expect(absorbee.mergedIntoId).toBe(`${R}survivante`);
    expect(absorbee.name.toLowerCase()).toContain('lancel temoinregistre');
    expect(lancel).toEqual([{ id: `${R}survivante`, nom: 'Lancel Temoinregistre', domaine: 'lancel.com', groupe: 'Piquadro', offres: 0 }]);
  });

  it('le nom exact d’abord, puis ceux qui commencent par le fragment, et à pertinence égale, le plus d’offres', async () => {
    const loewe = await rechercherSocietes('loewe temoinregistre');
    // PRÉMISSE : l'ordre alphabétique mettrait « Alpha » devant « Beta » ; seul le compte d'offres les départage.
    expect('Loewe Temoinregistre Alpha' < 'Loewe Temoinregistre Beta').toBe(true);
    expect(loewe.map((s) => [s.id, s.offres])).toEqual([[`${R}loewe`, 3], [`${R}beta`, 2], [`${R}alpha`, 1], [`${R}perfumes`, 1]]);
  });

  it('un alias REVU trouve sa société ; un alias brut, non', async () => {
    expect((await rechercherSocietes('atelier revu temoinregistre')).map((s) => s.id)).toEqual([`${R}alias`]);
    expect(await rechercherSocietes('atelier brut temoinregistre')).toEqual([]);
  });

  it('`%` et `_` sont des caractères, pas des jokers, même en pleine chasse (`％`, `＿`)', async () => {
    // PRÉMISSE : en joker, « 100% temoinregistre » trouverait aussi « Maison 100 Ans Temoinregistre ».
    expect((await rechercherSocietes('100% temoinregistre')).map((s) => s.id)).toEqual([`${R}joker`]);
    expect((await rechercherSocietes('100％ temoinregistre')).map((s) => s.id)).toEqual([`${R}joker`]);
    for (const q of ['l_ncel temoinregistre', 'l＿ncel temoinregistre', '%temoinregistre', '％temoinregistre']) {
      expect(await rechercherSocietes(q), q).toEqual([]);
    }
  });

  it('un nom qui contient `_` reste une correspondance exacte, en tête', async () => {
    const r = await rechercherSocietes('maison_souligne temoinregistre');
    expect(r[0]?.id).toBe(`${R}souligne`);
  });
});

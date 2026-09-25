import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { lireOffre } from '../../../aggregator/src/direct/contrat';
import { offreBrute, contexteTemoin } from '../../../aggregator/src/direct/fixture';
import { projeterOffreDirecte } from '../../../aggregator/src/direct/projection';
import { directPubliable } from '../direct-offers';
import { getCompanies } from '../companies';
import { getCompanyAside } from '../jobs';

/**
 * D-455 §1 (R-96, « Sur la page Emploi ») — L'ANNUAIRE COMPTE LES OFFRES CATWALKS SANS MAISON PUBLIQUE SOUS UNE SEULE
 * LIGNE « CATWALKS ». Sur une vraie base, par la chaîne réelle : la projection de l'agrégateur écrit l'employeur affiché,
 * l'annuaire de l'API regroupe par ce nom. La version 1 de la projection nommait ces offres par leur univers : deux
 * univers faisaient deux fausses Maisons (« Mode, Luxe », « Beauté »), et « Maison confidentielle » une troisième.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const P = 'annuaireD455';
const DIOR = 'Maison Témoin D-455';

describe.skipIf(!enabled)('annuaire : une seule ligne « Catwalks » pour les offres sans Maison publique (D-455 §1)', () => {
  const nettoyer = () => prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
  beforeAll(async () => {
    await nettoyer();
    const offres = [
      offreBrute({ id: `${P}ModeLuxe`, slug: `${P}-mode-luxe`, maison: null, univers: ['MODE', 'LUXE'] }),
      offreBrute({ id: `${P}Beaute`, slug: `${P}-beaute`, maison: null, univers: ['BEAUTE'] }),
      offreBrute({ id: `${P}SansUnivers`, slug: `${P}-sans-univers`, maison: null, univers: [] }),
      offreBrute({ id: `${P}Maison`, slug: `${P}-maison`, maison: { nom: DIOR, slug: 'maison-temoin-d455' } }),
    ];
    for (const brute of offres) await prisma.directOffer.create({ data: projeterOffreDirecte(lireOffre(brute), BigInt(1), BigInt(1), contexteTemoin()) });
  });
  afterAll(nettoyer);

  it('PRÉMISSE puis preuve — trois offres sans Maison, d’univers différents, forment UNE ligne « Catwalks » ; la Maison publique garde la sienne', async () => {
    // PRÉMISSE : les quatre offres sont publiables en France, et le registre ne connaît aucune société « Catwalks »
    // (sinon l'annuaire rattacherait la ligne à cette société, par son nom).
    expect(await prisma.directOffer.count({ where: { id: { startsWith: P }, countryCode: 'FR', ...directPubliable() } })).toBe(4);
    expect(await prisma.company.count({ where: { name: 'Catwalks' } })).toBe(0);
    const r = await getCompanies({ marche: 'FR' });
    const lignes = r.companies.filter((c) => c.name === 'Catwalks');
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ id: 'cw_catwalks', jobCount: 3, group: null, domain: null });
    for (const faux of ['Mode, Luxe', 'Beauté', 'Maison confidentielle']) expect(r.companies.map((c) => c.name), faux).not.toContain(faux);
    expect(r.companies.find((c) => c.name === DIOR)).toMatchObject({ jobCount: 1 });
  });

  it('le bloc Maison d’une fiche sans Maison publique compte ses offres sous « Catwalks », sans domaine ni groupe', async () => {
    expect(await getCompanyAside('Catwalks')).toMatchObject({ openJobs: 3, domain: null, group: null });
  });
});

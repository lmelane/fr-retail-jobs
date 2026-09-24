import { initializeSearchIndex, drainSearchIndex } from '../search-index';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { projeterListe } from '../projection';
import { getJobs, getJobStatus, type JobFilters } from '../jobs';
import { getCompanies } from '../companies';
import { contratMarches } from '../marches-catalogue';
import { PerimetreRequisError, exigerPerimetre } from '../perimetre';
import { suggestCompanies, suggestTitles } from '../suggestions';

/**
 * LE TÉMOIN DU PÉRIMÈTRE (lot 6) — sur une vraie base, parce que le défaut
 * historique vivait dans le SQL : `marche=US` rendait le total mondial.
 *
 * Le semis est mondial et connu ligne à ligne, de sorte que chaque assertion
 * sache combien d'offres elle DOIT trouver, et surtout combien elle ne doit
 * PAS trouver. Deux Maisons : la Maison témoin (France, plus une offre à
 * Austin) et une autre Maison qui recrute partout ailleurs — c'est elle qui
 * porte la contre-épreuve « périmètre contre monde ».
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const M = 'temoin-perimetre';
const MAISON = 'Maison Périmètre Témoin';
const AUTRE = 'Autre Maison Périmètre';

type Graine = {
  id: string; maison: string; pays: string | null; ville: string; titre?: string; contrat?: string | null; temps?: string | null;
  codePostal?: string | null; subdivision?: string | null; remote?: boolean; langue?: string; posteLe?: string;
};
const GRAINES: readonly Graine[] = [
  { id: 'paris1', maison: MAISON, pays: 'FR', ville: 'Paris', contrat: 'PERMANENT', temps: 'FULL_TIME', codePostal: '75008', subdivision: 'Île-de-France', posteLe: '2026-09-01' },
  { id: 'paris2', maison: MAISON, pays: 'FR', ville: 'Paris', contrat: 'FIXED_TERM', temps: 'FULL_TIME', codePostal: '75009', subdivision: 'Île-de-France', posteLe: '2026-09-03' },
  { id: 'paris3', maison: MAISON, pays: 'FR', ville: 'Paris', contrat: null, temps: null, codePostal: null, subdivision: 'Île-de-France', posteLe: '2026-09-05' },
  { id: 'lille', maison: MAISON, pays: 'FR', ville: 'Lille', contrat: 'PERMANENT', temps: 'PART_TIME', codePostal: '59000', subdivision: 'Hauts-de-France', posteLe: '2026-09-02' },
  { id: 'nice', maison: MAISON, pays: 'FR', ville: 'Nice', contrat: null, temps: 'FULL_TIME', remote: true, posteLe: '2026-09-04' },
  { id: 'austin', maison: MAISON, pays: 'US', ville: 'Austin', subdivision: 'Texas', contrat: null, temps: 'FULL_TIME', posteLe: '2026-09-01' },
  { id: 'paris-tx', maison: AUTRE, pays: 'US', ville: 'Paris', subdivision: 'Texas', contrat: null, temps: 'PART_TIME', codePostal: '75460' },
  { id: 'newyork', maison: AUTRE, pays: 'US', ville: 'New York', subdivision: 'New York', remote: true, temps: 'FULL_TIME' },
  { id: 'mons', maison: AUTRE, pays: 'BE', ville: 'Mons', contrat: 'PERMANENT', temps: 'FULL_TIME' },
  { id: 'tournai', maison: AUTRE, pays: 'BE', ville: 'Tournai', contrat: 'FIXED_TERM', temps: 'FULL_TIME' },
  { id: 'shanghai', maison: AUTRE, pays: 'CN', ville: 'Shanghai', titre: '销售顾问', langue: 'zh', contrat: 'PERMANENT', temps: 'FULL_TIME' },
  { id: 'vienne', maison: AUTRE, pays: 'AT', ville: 'Wien', contrat: 'PERMANENT', temps: 'FULL_TIME' },
  { id: 'dublin', maison: AUTRE, pays: 'IE', ville: 'Dublin', contrat: 'PERMANENT', temps: 'FULL_TIME' },
  { id: 'sofia', maison: AUTRE, pays: 'BG', ville: 'Sofia', titre: 'Store Manager Vitosha', contrat: 'PERMANENT', temps: 'FULL_TIME' },
  { id: 'nulle-part', maison: AUTRE, pays: null, ville: 'Nulle Part', remote: true, contrat: 'PERMANENT', temps: 'FULL_TIME' },
];
const jobId = (g: Graine) => `${M}-${g.id}`;
const companyId = (maison: string) => `${M}-${maison === MAISON ? 'maison' : 'autre'}`;

const chercher = (marche: string | undefined, extra: Partial<JobFilters> = {}, filtres: JobFilters['filtres'] = {}) =>
  getJobs({ marche, ...extra, filtres });
const ids = (r: Awaited<ReturnType<typeof getJobs>>) => r.jobs.map((j) => j.id.replace(`${M}-`, '')).sort();
const facette = (r: Awaited<ReturnType<typeof getJobs>>, cle: string) => r.facettes.find((f) => f.cle === cle);
const AUTRE_SEULE = { maison: [AUTRE] };
const MAISON_SEULE = { maison: [MAISON] };

describe.skipIf(!enabled)('la recherche est bornée par le périmètre (lot 6)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: M } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: M } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: M } } });
  };
  beforeAll(async () => {
    await nettoyer();
    for (const maison of [MAISON, AUTRE]) {
      await prisma.company.create({ data: { id: companyId(maison), name: maison, canonicalKey: companyId(maison), fashionjobsUrl: `resolved:${companyId(maison)}` } });
    }
    for (const g of GRAINES) {
      const titre = g.titre ?? `Conseiller de vente ${g.id}`;
      const lien = `https://example.com/${M}/${g.id}`;
      await prisma.job.create({ data: {
        id: jobId(g), companyId: companyId(g.maison), source: 'GENERIC_JSONLD', externalId: g.id, title: titre, url: lien, city: g.ville, countryCode: g.pays, adminArea1: g.subdivision ?? null,
        postalCode: g.codePostal ?? null, employmentTerm: g.contrat ?? null, workTime: g.temps ?? null,
        workplaceType: g.remote ? 'REMOTE' : null, language: g.langue ?? 'fr', isActive: true,
        postedAt: new Date(g.posteLe ?? '2026-08-15'), firstSeenAt: new Date(g.posteLe ?? '2026-08-15'),
        sources: { create: { sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, title: titre, city: g.ville,
            country: g.pays ?? undefined, postalCode: g.codePostal ?? undefined, employmentTerm: g.contrat ?? undefined, workTime: g.temps ?? undefined,
            workplaceType: g.remote ? 'REMOTE' : undefined, language: g.langue, postedAt: new Date(g.posteLe ?? '2026-08-15') }) } },
      } });
    }
    await initializeSearchIndex();
    while (await drainSearchIndex()) {}
  }, 120_000);
  afterAll(nettoyer);

  it('PRÉMISSE — le semis est mondial : l’autre Maison recrute dans sept pays et une fois sans pays', async () => {
    const monde = await prisma.job.groupBy({ by: ['countryCode'], where: { companyId: companyId(AUTRE), isActive: true }, _count: true });
    expect(monde.map((r) => r.countryCode).sort()).toEqual([null, 'AT', 'BE', 'BG', 'CN', 'IE', 'US'].sort());
    expect(await prisma.job.count({ where: { companyId: companyId(AUTRE), isActive: true } })).toBe(9);
  });

  it('CONTRE-ÉPREUVE DU DÉFAUT HISTORIQUE — `marche=US` ne rend plus le total mondial', async () => {
    const monde = await prisma.job.count({ where: { companyId: companyId(AUTRE), isActive: true } });
    const us = await chercher('US', {}, AUTRE_SEULE);
    // Le défaut : 9 (le monde). Le contrat : 2 (Paris, Texas et New York).
    expect(monde).toBeGreaterThan(us.total);
    expect(us.total).toBe(2);
    expect(ids(us)).toEqual(['newyork', 'paris-tx']);
    expect(us.perimetre).toMatchObject({ code: 'US', pays: ['US'], mesure: true, nom: 'United States' });
  });

  it('sans marché, ou avec un code inconnu : refus explicite, jamais une liste mondiale', async () => {
    await expect(chercher(undefined)).rejects.toThrow(PerimetreRequisError);
    await expect(chercher('')).rejects.toMatchObject({ code: 'MARCHE_REQUIS' });
    await expect(chercher('ZZ')).rejects.toMatchObject({ code: 'MARCHE_INCONNU' });
    await expect(chercher('monde')).rejects.toMatchObject({ code: 'MARCHE_INCONNU' });
  });

  it('chaque marché ne voit que ses pays : FR, US, BE, CN — et DE voit l’Autriche, GB voit l’Irlande', async () => {
    expect(ids(await chercher('FR', {}, MAISON_SEULE))).toEqual(['lille', 'nice', 'paris1', 'paris2', 'paris3']);
    expect(ids(await chercher('BE', {}, AUTRE_SEULE))).toEqual(['mons', 'tournai']);
    expect(ids(await chercher('CN', {}, AUTRE_SEULE))).toEqual(['shanghai']);
    const de = await chercher('DE', {}, AUTRE_SEULE);
    expect(ids(de)).toEqual(['vienne']);
    expect(de.perimetre.pays).toEqual(['DE', 'AT']);
    expect(ids(await chercher('GB', {}, AUTRE_SEULE))).toEqual(['dublin']);
  });

  it('lot 8 — chaque périmètre dit la langue de ses libellés, et les options comme les lignes la suivent', async () => {
    const us = await chercher('US', {}, AUTRE_SEULE);
    expect(us.perimetre.langueDesLibelles).toBe('en');
    // Prémisse : le marché US sert la facette « temps » et deux de ses offres témoin la renseignent.
    const temps = facette(us, 'temps');
    expect(temps?.options.map((o) => o.label).sort()).toEqual(['Full-time', 'Part-time']);
    expect(projeterListe(us).jobs.map((j) => j.countryLabel)).toEqual(['United States', 'United States']);
    const gb = await chercher('GB', {}, AUTRE_SEULE);
    expect(gb.perimetre.langueDesLibelles).toBe('en');
    expect(projeterListe(gb).jobs[0]).toMatchObject({ employmentTermLabel: 'Permanent', workTimeLabel: 'Full-time', countryLabel: 'Ireland' });
    // Chaque marché suit désormais son catalogue de langue réellement servi.
    const be = await chercher('BE', {}, AUTRE_SEULE);
    expect(be.perimetre.langueDesLibelles).toBe('fr');
    expect(projeterListe(be).jobs.map((j) => j.employmentTermLabel).sort()).toEqual(['CDD', 'CDI']);
    const de = await chercher('DE', {}, AUTRE_SEULE);
    expect(de.perimetre).toMatchObject({ localeParDefaut: 'de-DE', langueDesLibelles: 'de' });
    expect(projeterListe(de).jobs[0].countryLabel).toBe('Österreich');
  });

  it('un pays sans marché mesuré est un périmètre servi seul, sans facettes natives — le stock hors marchés n’est pas invisible', async () => {
    /*
     * `BG` a remplacé `JP` le 17/09/2026 : le Japon est devenu un marché routable (552 offres) et
     * ce témoin a rougi — c'est son travail. La Bulgarie porte 45 offres publiables, sous le seuil
     * de 50 : un code pays réel, servi par le catalogue, sans marché mesuré.
     */
    const bg = await chercher('BG', {}, AUTRE_SEULE);
    expect(ids(bg)).toEqual(['sofia']);
    expect(bg.perimetre).toMatchObject({ code: 'BG', mesure: false, pays: ['BG'] });
    expect(bg.facettes.map((f) => f.cle)).toEqual(['secteur', 'ville', 'maison', 'groupe', 'langue']);
    expect(bg.totalPerimetre).toBeGreaterThanOrEqual(1);
  });

  it('une offre sans pays n’appartient à aucun périmètre, mais reste servie par son identifiant', async () => {
    for (const marche of ['FR', 'US', 'BE', 'BG']) expect(ids(await chercher(marche, {}, AUTRE_SEULE))).not.toContain('nulle-part');
    expect((await getJobStatus(`${M}-nulle-part`)).status).toBe('active');
  });

  it('Paris, Texas et Paris, France sont deux lieux : le champ lieu se résout dans le périmètre', async () => {
    const fr = await chercher('FR', { lieu: 'Paris' }, MAISON_SEULE);
    expect(ids(fr)).toEqual(['paris1', 'paris2', 'paris3']);
    expect(fr.lieu).toEqual({ type: 'ville', libelle: 'Paris' });
    const us = await chercher('US', { lieu: 'Paris' }, AUTRE_SEULE);
    expect(ids(us)).toEqual(['paris-tx']);
    // La subdivision aussi : « Texas » atteint Paris (TX) et Austin, pas New York.
    expect(ids(await chercher('US', { lieu: 'Texas' }))).toEqual(expect.arrayContaining(['austin', 'paris-tx']));
    expect(ids(await chercher('US', { lieu: 'Texas' }))).not.toContain('newyork');
  });

  it('France tapée dans le contexte américain est refusée explicitement, les résultats restent américains', async () => {
    const r = await chercher('US', { lieu: 'France' }, AUTRE_SEULE);
    expect(r.filtresRefuses).toEqual([{ cle: 'lieu', valeurs: ['France'], motif: 'LIEU_HORS_MARCHE' }]);
    expect(r.lieu).toEqual({ type: 'pays', libelle: 'France' });
    expect(ids(r)).toEqual(['newyork', 'paris-tx']);
    // Et France tapée en France : acceptée, sans rien changer.
    expect((await chercher('FR', { lieu: 'France' }, MAISON_SEULE)).filtresRefuses).toEqual([]);
    expect(ids(await chercher('FR', { lieu: 'France' }, MAISON_SEULE))).toHaveLength(5);
  });

  it('un code postal reste une chaîne et se cherche en préfixe dans le périmètre', async () => {
    expect(ids(await chercher('FR', { lieu: '75008' }, MAISON_SEULE))).toEqual(['paris1']);
    expect(ids(await chercher('FR', { lieu: '750' }, MAISON_SEULE))).toEqual(['paris1', 'paris2']);
    // 75460 est Paris, Texas : invisible depuis la France.
    expect(ids(await chercher('FR', { lieu: '75460' }))).toEqual([]);
    expect(ids(await chercher('US', { lieu: '75460' }, AUTRE_SEULE))).toEqual(['paris-tx']);
  });

  it('BE/FR transfrontalier : Lille reste française, Mons reste belge', async () => {
    expect(ids(await chercher('BE', { lieu: 'Lille' }))).toEqual([]);
    expect(ids(await chercher('FR', { lieu: 'Mons' }))).toEqual([]);
    expect(ids(await chercher('BE', { lieu: 'Mons' }, AUTRE_SEULE))).toEqual(['mons']);
  });

  it('le télétravail est un mode de travail borné par le pays de l’offre, jamais un droit mondial', async () => {
    expect(ids(await chercher('FR', { lieu: 'télétravail' }, MAISON_SEULE))).toEqual(['nice']);
    expect(ids(await chercher('US', { lieu: 'remote' }, AUTRE_SEULE))).toEqual(['newyork']);
    expect(ids(await chercher('BE', { lieu: 'télétravail' }))).toEqual([]);
  });

  it('un filtre exige une valeur attestée ; une valeur absente ne devient pas une correspondance', async () => {
    const cdi = await chercher('FR', {}, { ...MAISON_SEULE, contrat: ['PERMANENT'] });
    expect(ids(cdi)).toEqual(['lille', 'paris1']);
    expect(cdi.total).toBe(2);
    expect(cdi.totalConfirmes).toBe(2);
    expect(cdi.jobs.every(j => j.correspondance?.statut === 'CONFIRMEE')).toBe(true);
    const deux = await chercher('FR', {}, { ...MAISON_SEULE, contrat: ['PERMANENT'], temps: ['FULL_TIME'] });
    expect(ids(deux)).toEqual(['paris1']);
    expect((await chercher('FR', {}, MAISON_SEULE)).total).toBe(5);
  });

  it('ET entre dimensions, OU dans une dimension, et chaque facette exclut sa propre sélection', async () => {
    const r = await chercher('FR', {}, { ...MAISON_SEULE, contrat: ['PERMANENT'] });
    // La facette contrat compte sans sa sélection : le CDD reste proposé.
    expect(facette(r, 'contrat')?.options).toEqual(expect.arrayContaining([
      { value: 'PERMANENT', label: 'CDI', count: 2 }, { value: 'FIXED_TERM', label: 'CDD', count: 1 },
    ]));
    // La facette ville, elle, est comptée avec le filtre contrat (tolérant) : Paris 3 et Nice y restent.
    expect(facette(r, 'ville')?.options).toEqual(expect.arrayContaining([
      { value: 'paris', label: 'Paris', count: 1 }, { value: 'lille', label: 'Lille', count: 1 },
    ]));
    const ou = await chercher('FR', {}, { ...MAISON_SEULE, contrat: ['PERMANENT', 'FIXED_TERM'] });
    expect(ids(ou)).toEqual(['lille', 'paris1', 'paris2']);
  });

  it('un filtre que le marché ne sert pas est refusé et nommé ; un changement de marché avec d’anciens filtres ne ment pas', async () => {
    const r = await chercher('US', {}, { ...AUTRE_SEULE, contrat: ['PERMANENT'] });
    expect(r.filtresRefuses).toEqual([{ cle: 'contrat', valeurs: ['PERMANENT'], motif: 'FACETTE_NON_SERVIE' }]);
    expect(r.facettes.map((f) => f.cle)).not.toContain('contrat');
    expect(ids(r)).toEqual(['newyork', 'paris-tx']);
    // Le pays hors périmètre, sur un marché qui expose `pays` : refusé nommément, le reste honoré.
    const gb = await chercher('GB', {}, { ...AUTRE_SEULE, pays: ['IE', 'FR'] });
    expect(gb.filtresRefuses).toEqual([{ cle: 'pays', valeurs: ['FR'], motif: 'PAYS_HORS_MARCHE' }]);
    expect(ids(gb)).toEqual(['dublin']);
  });

  it('totaux, facettes et pages disent la même chose dans le périmètre', async () => {
    const r = await chercher('BE', {}, AUTRE_SEULE);
    expect(r.total).toBe(2);
    expect(r.suivant).toBeNull();
    expect(facette(r, 'pays')?.options.reduce((n, o) => n + o.count, 0)).toBe(r.total);
    expect(facette(r, 'pays')?.options[0]).toEqual({ value: 'BE', label: 'Belgique', count: 2 });
    expect(facette(r, 'ville')?.options.map((o) => o.label).sort()).toEqual(['Mons', 'Tournai']);
    expect(r.totalPerimetre).toBeGreaterThanOrEqual(2);
    // Les libellés d'options suivent la langue de service : l'Autriche s'écrit en allemand sur le marché DE.
    const de = await chercher('DE', {}, AUTRE_SEULE);
    expect(facette(de, 'pays')?.options[0]).toEqual({ value: 'AT', label: 'Österreich', count: 1 });
    const cn = await chercher('CN', {}, AUTRE_SEULE);
    expect(facette(cn, 'langue')?.options[0]).toEqual({ value: 'zh', label: '中文', count: 1 });
  });

  it('la recherche texte et les suggestions vivent dans le périmètre', async () => {
    expect((await chercher('FR', { q: 'Conseiller' }, MAISON_SEULE)).total).toBe(5);
    expect((await chercher('FR', { q: 'Ginza' })).total).toBe(0);
    expect((await chercher('BG', { q: 'Vitosha' })).total).toBe(1);
    expect(await suggestTitles('Store Manager', exigerPerimetre('BG'))).toEqual(['Store Manager Vitosha', 'Store manager']);
    expect(await suggestTitles('Store Manager', exigerPerimetre('FR'))).toEqual([]);
    expect(await suggestCompanies('Périmètre Témoin', exigerPerimetre('FR'))).toEqual([MAISON]);
    expect(await suggestCompanies('Périmètre Témoin', exigerPerimetre('BG'))).toEqual([]);
    expect(await suggestCompanies('Périmètre', exigerPerimetre('US'))).toEqual(expect.arrayContaining([MAISON, AUTRE]));
  });

  it('l’annuaire des Maisons est borné par le même périmètre', async () => {
    const fr = await getCompanies({ marche: 'FR', q: 'Périmètre' });
    expect(fr.companies.map((c) => [c.name, c.jobCount])).toEqual([[MAISON, 5]]);
    expect(fr.companies[0].cities.map((c) => c.city)).toEqual(expect.arrayContaining(['Paris', 'Lille', 'Nice']));
    const us = await getCompanies({ marche: 'US', q: 'Périmètre' });
    expect(us.companies.map((c) => [c.name, c.jobCount]).sort()).toEqual([[AUTRE, 2], [MAISON, 1]]);
    expect(us.facettes.map((f) => f.cle)).toEqual(['secteur']);
    const gb = await getCompanies({ marche: 'GB', q: 'Périmètre', pays: ['FR'] });
    expect(gb.filtresRefuses).toEqual([{ cle: 'pays', valeurs: ['FR'], motif: 'PAYS_HORS_MARCHE' }]);
    expect(gb.facettes.find((f) => f.cle === 'pays')?.options).toEqual([{ value: 'IE', label: 'Ireland', count: 1 }]);
    await expect(getCompanies({ q: 'Périmètre' })).rejects.toThrow(PerimetreRequisError);
  });

  it('le contrat des marchés compte le catalogue par périmètre, hors marchés et sans pays', async () => {
    const contrat = await contratMarches();
    expect(contrat.version).toBe(2);
    /*
     * 41 marchés depuis le 17/09/2026 : les 12 LOCALISÉS (interface et libellés dans leur langue)
     * plus les 29 ROUTABLES (corpus mesuré, interface anglaise en repli). Le nombre est gravé
     * plutôt que dérivé du registre : un `toHaveLength(CODES_MARCHE.length)` serait toujours vrai
     * et laisserait une ouverture de marché passer inaperçue.
     */
    expect(contrat.marches.map((m) => m.code)).toHaveLength(41);
    const compte = async (pays: string[]) => prisma.job.count({ where: { isActive: true, mergedIntoId: null, countryCode: { in: pays }, sources: { some: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } } });
    expect(contrat.marches.find((m) => m.code === 'DE')?.offresPubliables).toBe(await compte(['DE', 'AT']));
    expect(contrat.marches.find((m) => m.code === 'FR')?.offresPubliables).toBe(await compte(['FR']));
    expect(contrat.marches.find((m) => m.code === 'FR')?.facettes.map((f) => f.cle)).toContain('contrat');
    expect(contrat.catalogue.autresPays.find((p) => p.code === 'BG')?.offresPubliables).toBe(await compte(['BG']));
    expect(contrat.catalogue.autresPays.some((p) => p.code === 'AT')).toBe(false);
    expect(contrat.catalogue.sansPays).toBeGreaterThanOrEqual(1);
    expect(contrat.catalogue.offresPubliables).toBeGreaterThanOrEqual(GRAINES.length);
  });
});

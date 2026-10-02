import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@catwalks/db';
import * as database from '@catwalks/db/occupations';
import { occupationManifestHash } from '@catwalks/db/occupations';
import { exigerPerimetre } from '../perimetre';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { examinerAlerte, getJobs, type JobFilters } from '../jobs';
import { suggestCities, suggestTitlesDetaillees } from '../suggestions';
import { sansJetons } from '../__fixtures__/jetons-opaques';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * D-500, D-501 — LE CONTRAT D'AVANT, À L'IDENTIQUE, POUR UN CLIENT QUI N'ANNONCE PAS LE CONTRAT 2.
 *
 * catwalks.io (branche `main` du site) n'envoie pas `x-catwalks-client: 2` ; la préversion, qui l'envoie, interroge la
 * même API. Sans l'en-tête, ce lot ne change rien : mêmes offres, même ordre, mêmes totaux, mêmes curseurs pour une
 * recherche tapée (écriture inclusive, marques, mot seul au féminin, liaison omise), mêmes suggestions d'intitulés
 * (brutes), mêmes lieux au focus (aucun), même examen d'alerte.
 *
 * LE TÉMOIN EST DIFFÉRENTIEL : `__temoins__/contrat-v1-d500.json` a été écrit par le code d'AVANT le lot (agrégateur
 * `568fa88`, ce fichier copié dans une copie de travail de ce commit, sur une base neuve migrée jusqu'au lot,
 * `ECRIRE_TEMOIN_CONTRAT_V1_D500=1`) ; le code courant doit rendre exactement le même document.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'v1-d500-';
const MAISON = `${P}maison`;
const GROUPE = 'Groupe Contrat V1 D500';
const TEMOIN = join(__dirname, '__temoins__', 'contrat-v1-d500.json');

/** Des intitulés réels de la mesure du 01/10/2026 ; `classe` : le métier que le moteur leur donne. */
const OFFRES: readonly { titre: string; classe?: string; description?: string; n?: number }[] = [
  { titre: 'Conseiller de Vente CDD', classe: 'Conseiller de vente', n: 3 },
  { titre: 'CONSEILLER DE VENTE /NB', classe: 'Conseiller de vente', n: 2 },
  { titre: 'Conseillère de Vente Paris', classe: 'Conseiller de vente', n: 2 },
  { titre: 'Conseiller(ère) de vente', n: 2 },
  { titre: 'Conseiller·ère de vente parfumerie' },
  { titre: 'Vendeur(euse) en CDD', classe: 'Vendeur' },
  { titre: 'Vendeuse', classe: 'Vendeuse', n: 2 },
  { titre: 'Vendeur polyvalent', n: 3 },
  { titre: 'Responsable Boutique', classe: 'Responsable de boutique', n: 2 },
  { titre: 'Responsable boutique .' },
  { titre: 'Adjoint Responsable Boutique', classe: 'Adjoint au responsable de boutique' },
  { titre: 'Conseillère de vente luxe', classe: 'Conseiller de vente' },
  { titre: 'Styliste', description: 'Vous accompagnez chaque conseillère et chaque conseiller de la boutique.' },
  // Assez d'offres d'un même métier pour deux pages : le curseur servi est exercé.
  ...Array.from({ length: 24 }, (_v, i) => ({ titre: i % 2 ? 'Vendeur' : 'Conseiller de vente', classe: 'Conseiller de vente' })),
];
const RECHERCHES: string[] = [
  'conseiller(ère) de vente', 'conseiller·ère de vente', 'CONSEILLER DE VENTE /NB', 'conseillère de vente H/F', 'conseillère',
  'vendeuses', 'responsable boutique', 'conseiller de vente', 'conseillère de vente luxe', 'vendeur/vendeuse', 'directrice',
];
const FRAPPES = ['conseill', 'conseillère', 'vendeu', 'responsable bout', 'conseiller(ère) de'];

/** La taxonomie v3 ACTIVE, celle de la production : un autre témoin de la même base peut en avoir publié une autre. Rend
 * la version active d'avant, que `afterAll` remet : les témoins suivants retrouvent la base telle qu'ils l'attendent. */
async function activerV3(): Promise<string | null> {
  const avant = (await prisma.occupationState.findUnique({ where: { id: 'active' }, select: { releaseId: true } }))?.releaseId ?? null;
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'audits', '2026-09-28', 'curation-v3', '6-manifeste-v3.json'), 'utf8'));
  const existe = await prisma.occupationRelease.findUnique({ where: { id: manifest.id }, select: { id: true } });
  if (!existe) await prisma.occupationRelease.create({ data: { id: manifest.id, contentHash: occupationManifestHash(manifest), manifest } });
  if (avant !== manifest.id) await prisma.occupationState.upsert({ where: { id: 'active' }, create: { id: 'active', releaseId: manifest.id }, update: { releaseId: manifest.id } });
  return avant;
}

describe.skipIf(!enabled)('sans le signal du client, le contrat d’avant ce lot (D-500, D-501)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };

  let versionAvant: string | null = null;
  beforeAll(async () => {
    versionAvant = await activerV3();
    await nettoyer();
    const catalogue = await database.loadOccupationTaxonomy(prisma);
    await prisma.company.create({ data: { id: MAISON, name: MAISON, canonicalKey: MAISON, fashionjobsUrl: `resolved:${MAISON}`, sector: 'LUXURY', parentGroup: GROUPE } });
    let i = 0;
    for (const o of OFFRES) for (let k = 0; k < (o.n ?? 1); k++) {
      const id = `${P}${String(i++).padStart(2, '0')}`;
      const lien = `https://example.com/${id}`;
      const decision = o.classe ? database.persistedOccupationDecision(catalogue.classify(o.classe)) : {};
      await prisma.job.create({ data: { id, companyId: MAISON, externalId: id, source: 'GENERIC_JSONLD', title: o.titre, url: lien, isActive: true,
        countryCode: 'FR', city: 'Paris', location: 'Paris', description: o.description ?? null, ...decision,
        postedAt: new Date(Date.UTC(2026, 8, 1 + (i % 28), 8)), firstSeenAt: new Date('2026-09-01T09:00:00Z'), lastSeenAt: new Date('2026-09-30T00:00:00Z') } });
      await prisma.jobSource.create({ data: { jobId: id, sourceKey: 'v1-d500', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: 'v1-d500', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: o.titre, country: 'FR' }) } });
    }
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(async () => {
    await nettoyer();
    const active = (await prisma.occupationState.findUnique({ where: { id: 'active' }, select: { releaseId: true } }))?.releaseId;
    if (versionAvant && active !== versionAvant) await prisma.occupationState.update({ where: { id: 'active' }, data: { releaseId: versionAvant } });
  });

  /** Le document, sans ce que d'autres témoins de la même base peuvent changer (le total du périmètre, les autres groupes). */
  const documenter = (valeur: unknown): unknown => JSON.parse(JSON.stringify(valeur, (cle, v) => {
    if (cle === 'totalPerimetre') return undefined;
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as { cle?: unknown }).cle === 'groupe') {
      const f = v as { options?: Array<{ value: string }> };
      return { ...f, options: (f.options ?? []).filter((o) => o.value === GROUPE) };
    }
    return v;
  }));
  const avecGroupe = (f: Partial<JobFilters>): JobFilters => ({ marche: 'FR', ...f, filtres: { groupe: [GROUPE], ...f.filtres } });

  const constituer = async () => {
    const recherches: Record<string, unknown> = {};
    for (const q of RECHERCHES) {
      const premiere = await getJobs(avecGroupe({ q }));
      const seconde = premiere.suivant ? await getJobs({ ...avecGroupe({ q }), apres: premiere.suivant }) : null;
      recherches[q] = { premiere, seconde };
    }
    const fr = exigerPerimetre('FR');
    const suggestions: Record<string, unknown> = {};
    for (const f of FRAPPES) suggestions[f] = await suggestTitlesDetaillees(f, fr, 'fr');
    suggestions['lieu au focus'] = await suggestCities('', fr);
    const examens = {
      'conseiller(ère) de vente': await examinerAlerte(avecGroupe({ q: 'conseiller(ère) de vente' }), new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z')),
      'responsable boutique': await examinerAlerte(avecGroupe({ q: 'responsable boutique' }), new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z')),
    };
    return documenter({ recherches, suggestions, examens });
  };

  it('PRÉMISSE : le témoin exerce les formes du défaut (écriture inclusive, marque, liaison omise) et un curseur', async () => {
    // Les frappes et le lieu au focus lisent tout le marché français : le document n'est comparable que sur une base où
    // le témoin est seul (`npm run test:local` en crée une neuve). Une autre offre française le rendrait rouge sans défaut.
    const autres = await prisma.job.count({ where: { isActive: true, countryCode: { in: ['FR', 'MC'] }, NOT: { id: { startsWith: P } } } });
    expect(autres, 'base non vierge : d’autres offres françaises actives que celles du témoin').toBe(0);
    expect((await getJobs(avecGroupe({ q: 'conseiller de vente' }))).suivant).not.toBeNull();
    expect((await getJobs(avecGroupe({ q: 'conseiller(ère) de vente' }))).total).toBeLessThan((await getJobs(avecGroupe({ q: 'conseiller de vente' }))).total);
  });

  it('TÉMOIN DIFFÉRENTIEL : recherches tapées, curseurs, suggestions et examens rendent le document du code d’avant le lot', async () => {
    const document = await constituer();
    if (process.env.ECRIRE_TEMOIN_CONTRAT_V1_D500 === '1') {
      mkdirSync(dirname(TEMOIN), { recursive: true });
      writeFileSync(TEMOIN, `${JSON.stringify(document, null, 2)}\n`);
      return;
    }
    expect(existsSync(TEMOIN), 'le document du code d’avant le lot').toBe(true);
    // Curseur version 3 : un jeton chiffré n'a jamais les mêmes octets ; la page qu'il sert est comparée (`sansJetons`).
    expect(sansJetons(document)).toEqual(sansJetons(JSON.parse(readFileSync(TEMOIN, 'utf8'))));
  });

  it('la route : sans l’en-tête, la recherche et les suggestions d’avant ; avec `x-catwalks-client: 2`, la requête comprise', async () => {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-du-site');
    try {
      const { GET: rechercher } = await import('../../app/api/jobs/route');
      const { GET: suggerer } = await import('../../app/api/suggest/route');
      const appel = (chemin: string, client?: string) => new NextRequest(`http://catalogue.test${chemin}`,
        { headers: { authorization: 'Bearer cle-du-site', ...(client ? { 'x-catwalks-client': client } : {}) } });
      const chemin = `/api/jobs?marche=FR&groupe=${encodeURIComponent(GROUPE)}&q=${encodeURIComponent('conseiller(ère) de vente')}`;
      const avant = (await getJobs(avecGroupe({ q: 'conseiller(ère) de vente' }))).total;
      for (const autre of [undefined, '1', 'deux', ' ']) expect((await (await rechercher(appel(chemin, autre))).json()).total, String(autre)).toBe(avant);
      expect((await (await rechercher(appel(chemin, '2'))).json()).total).toBeGreaterThan(avant);
      const titres = '/api/suggest?type=title&q=conseill&marche=FR&locale=fr';
      const details = await suggestTitlesDetaillees('conseill', exigerPerimetre('FR'), 'fr');
      expect(await (await suggerer(appel(titres))).json()).toEqual({ suggestions: details.map((d) => d.valeur), metiers: details.map((d) => d.metier) });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

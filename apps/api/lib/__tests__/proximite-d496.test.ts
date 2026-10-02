import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@catwalks/db';
import { exigerPerimetre } from '../perimetre';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { examinerAlerte, getJobs, type JobFilters } from '../jobs';
import { suggestLieux } from '../suggestions';
import { Prisma } from '@catwalks/db';
import { ANNEAUX_KM, boiteSql, lireSaisieLieu, oublierVilles } from '../geo';
import { semerCodesPostaux, semerVilles, viderVilles, VILLES_TEMOINS } from '../__fixtures__/villes';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * D-496 (01/10/2026) — LA RECHERCHE DE PROXIMITÉ, sur une vraie base, par la vraie chaîne (`getJobs`, `examinerAlerte`,
 * `suggestLieux`, le déclencheur du point, la fonction de rattrapage), avec un extrait réel de GeoNames.
 *
 * Le témoin clé : « Chennevières-sur-Marne » rend les offres autour, non vides. Sa PRÉMISSE est le défaut mesuré en
 * production : une seule offre porte la ville à son nom, les autres sont autour (Champigny 4 km, Créteil 5,5 km, Paris
 * 16,5 km, La Défense 25 km), et la comparaison au mot près n'en trouvait qu'une.
 *
 * D-510 (02/10/2026) : la distance ne trie plus. Les cercles retiennent les offres ; l'ordre est Catwalks d'abord, puis la
 * plus fraîche (`fraicheur-d510.test.ts`). Le contrat 2 du client porte les deux (`proximite`, `fraicheur`).
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'prox-d496-';
const MAISON = `${P}maison`;
const AUTRE = `${P}autre`;
const GROUPE = 'Groupe Proximité D496';

type Semis = { ville: string; n: number; maison?: string; point?: [number, number]; pays?: string; adminArea1?: string };
const coord = (nom: string) => VILLES_TEMOINS.find((v) => v.name === nom && v.pays === 'FR')!;
/** Le point natif d'une offre : le centre de sa ville décalé de quelques centaines de mètres (une adresse). */
const pres = (nom: string, dLat = 0.002): [number, number] => [coord(nom).lat + dLat, coord(nom).lon];
const SEMIS: Semis[] = [
  { ville: 'Chennevières-sur-Marne', n: 1 },
  { ville: 'Champigny-sur-Marne', n: 3, point: pres('Champigny-sur-Marne') },
  { ville: 'Créteil', n: 4 },
  { ville: 'Paris', n: 15, point: pres('Paris') },
  { ville: 'Paris 9e Arrondissement', n: 1 },
  { ville: 'Paris', n: 2, maison: AUTRE },
  // Deux offres du 15e (point natif à quelques centaines de mètres du centre du 15e).
  { ville: 'Paris', n: 2, point: [48.8405, 2.2985] },
  { ville: 'Meaux', n: 2 },
  { ville: 'Fontainebleau', n: 3, maison: AUTRE },
  { ville: 'Provins', n: 2 },
  { ville: 'Orléans', n: 5 },
  { ville: 'Lyon', n: 4 },
  { ville: 'La Défense', n: 1 },
  { ville: 'Zzyzxville', n: 1 },
  { ville: 'Austin', n: 3, pays: 'US', adminArea1: 'Texas' },
  // Un nom ambigu : la règle par nom désigne la commune d'Alsace (68) ; les offres qui portent des coordonnées sont au
  // quartier de Marseille (13). Le rattrapage l'apprend et y place aussi l'offre sans coordonnées.
  { ville: 'Saint-Louis', n: 2, point: [43.3462, 5.3601] },
  { ville: 'Saint-Louis', n: 1 },
  // À 27 km de Lyon : seul un cercle propre à Lyon l'atteint quand Paris remplit le sien à 15 km.
  { ville: 'Vienne', n: 2 },
  // « Austin, Ohio » : l'Ohio est une subdivision connue, sans Austin dans la base témoin → aucune ville, aucun point.
  { ville: 'Austin', n: 1, pays: 'US', adminArea1: 'Ohio' },
];

const haversine = (a: [number, number], b: [number, number]) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

describe('la saisie d’un lieu', () => {
  it('lit la subdivision entre parenthèses ou après une virgule', () => {
    expect(lireSaisieLieu('Chennevières-sur-Marne (94)')).toEqual({ nom: 'Chennevières-sur-Marne', indice: '94', code: null });
    expect(lireSaisieLieu('  Austin,  TX ')).toEqual({ nom: 'Austin', indice: 'TX', code: null });
    expect(lireSaisieLieu('Paris')).toEqual({ nom: 'Paris', indice: null, code: null });
    expect(lireSaisieLieu('Paris 15e (75)')).toEqual({ nom: 'Paris 15e', indice: '75', code: null });
    expect(lireSaisieLieu('94430 Chennevières-sur-Marne (94)')).toEqual({ nom: 'Chennevières-sur-Marne', indice: '94', code: '94430' });
    expect(lireSaisieLieu('SW1A 1AA', true)).toEqual({ nom: null, indice: null, code: 'SW1A 1AA' });
  });
});

describe('la boîte englobante (filtre grossier avant la distance exacte)', () => {
  const lat = Prisma.sql`lat`, lon = Prisma.sql`lon`;
  it('borne la latitude et la longitude, et contient le cercle', () => {
    const b = boiteSql({ latitude: 48.8, longitude: 2.5 }, 100, lat, lon);
    expect(b.sql).toContain('lon BETWEEN');
    const [latMin, latMax, lonMin, lonMax] = b.values as number[];
    expect(latMax - 48.8).toBeGreaterThanOrEqual(100 / 111.32);
    expect(2.5 - lonMin).toBeGreaterThanOrEqual(100 / (111.32 * Math.cos((48.8 * Math.PI) / 180)));
    expect(latMin).toBeLessThan(48.8);
    expect(lonMax).toBeGreaterThan(2.5);
  });
  it('près de l’antiméridien ou d’un pôle, ne borne que la latitude (jamais un cercle tronqué)', () => {
    expect(boiteSql({ latitude: -36.8, longitude: 179.5 }, 100, lat, lon).sql).not.toContain('lon BETWEEN');
    expect(boiteSql({ latitude: 89.5, longitude: 10 }, 100, lat, lon).sql).not.toContain('lon BETWEEN');
  });
});

describe.skipIf(!enabled)('la recherche de proximité sur une base locale dédiée', () => {
  const villeDe = new Map<string, string>();
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await viderVilles(prisma);
    oublierVilles();
    // La file de l'index de recherche suit les offres créées et retirées : vidée ici, elle ne vieillit pas sous les
    // témoins suivants (une file de plus de 300 s rend la recherche indisponible).
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };
  beforeAll(async () => {
    await nettoyer();
    await semerVilles(prisma);
    await semerCodesPostaux(prisma);
    for (const m of [MAISON, AUTRE]) {
      await prisma.company.create({ data: { id: m, name: m, canonicalKey: m, fashionjobsUrl: `resolved:${m}`, sector: 'LUXURY', parentGroup: GROUPE } });
    }
    let i = 0;
    for (const s of SEMIS) {
      for (let k = 0; k < s.n; k++) {
        const id = `${P}${String(i++).padStart(3, '0')}`;
        const pays = s.pays ?? 'FR';
        villeDe.set(id, s.ville);
        await prisma.job.create({ data: { id, companyId: s.maison ?? MAISON, externalId: id, source: 'GENERIC_JSONLD', title: 'Conseiller de vente',
          url: `https://example.com/${id}`, isActive: true, countryCode: pays, city: s.ville, adminArea1: s.adminArea1 ?? null,
          latitude: s.point?.[0] ?? null, longitude: s.point?.[1] ?? null,
          postedAt: new Date(Date.UTC(2026, 8, 1, 0, i)), firstSeenAt: new Date(Date.UTC(2026, 8, 20, 0, i)) } });
        await prisma.jobSource.create({ data: { jobId: id, sourceKey: 'prox-d496', sourceTier: 'ATS_OFFICIAL', externalId: id,
          url: `https://example.com/${id}`, isActive: true,
          ...publicationFixture({ sourceKey: 'prox-d496', sourceTier: 'ATS_OFFICIAL', externalId: id, url: `https://example.com/${id}`,
            title: 'Conseiller de vente', country: pays }) } });
      }
    }
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  // Le client annonce le contrat 2 (`x-catwalks-client: 2`, contrat-client.ts) : la route pose `proximite` et, depuis
  // D-510, `fraicheur`.
  const filtres = (extra: Partial<JobFilters> = {}): JobFilters => ({ marche: 'FR', proximite: true, fraicheur: true, ...extra, filtres: { groupe: [GROUPE], ...extra.filtres } });
  /** D-510 : l'ordre attendu de ces offres, relu en base — Catwalks d'abord, la plus fraîche, l'identifiant. */
  const ordreFraicheur = async (ids: string[]) => {
    const dates = new Map<string, number>();
    for (const j of await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, postedAt: true, firstSeenAt: true } })) {
      dates.set(j.id, Math.min(j.postedAt?.getTime() ?? Infinity, j.firstSeenAt.getTime()));
    }
    const directes = ids.filter((id) => id.startsWith('cw_')).map((id) => id.slice(3));
    for (const d of await prisma.directOffer.findMany({ where: { id: { in: directes } }, select: { id: true, postedAt: true, receivedAt: true } })) {
      dates.set(`cw_${d.id}`, Math.min(d.postedAt?.getTime() ?? Infinity, d.receivedAt.getTime()));
    }
    const rang = (id: string) => (id.startsWith('cw_') ? 0 : 1);
    return [...ids].sort((a, b) => rang(a) - rang(b) || dates.get(b)! - dates.get(a)! || (a < b ? -1 : 1));
  };
  /** Toutes les pages d'une recherche, dans l'ordre servi. */
  const toutes = async (f: JobFilters) => {
    const ids: string[] = [];
    let apres: string | undefined;
    let total = 0;
    do {
      const r = await getJobs({ ...f, apres });
      total = r.total;
      ids.push(...r.jobs.map((j) => j.id));
      apres = r.suivant ?? undefined;
    } while (apres);
    return { ids, total };
  };
  const point = async (id: string): Promise<[number, number]> => {
    const j = await prisma.job.findUniqueOrThrow({ where: { id }, select: { geoLatitude: true, geoLongitude: true } });
    return [j.geoLatitude!, j.geoLongitude!];
  };
  const CHENNEVIERES: [number, number] = [coord('Chennevières-sur-Marne').lat, coord('Chennevières-sur-Marne').lon];

  it('le déclencheur donne un point à chaque offre : natif s’il existe, sinon le centre de sa ville ; un arrondissement est son propre lieu (D-499)', async () => {
    const lignes = await prisma.job.findMany({ where: { id: { startsWith: P } }, select: { id: true, city: true, geoSource: true, geoCityId: true } });
    const de = (ville: string) => lignes.filter((l) => l.city === ville);
    expect(new Set(de('Paris').filter((l) => l.geoSource === 'NATIVE').map((l) => l.geoCityId))).toEqual(new Set([2988507]));
    expect(de('Créteil').every((l) => l.geoSource === 'CITY' && l.geoCityId === 3022530)).toBe(true);
    // D-499 : un arrondissement est son propre lieu, avec son point.
    expect(de('Paris 9e Arrondissement')[0]).toMatchObject({ geoSource: 'CITY', geoCityId: 2989487 });
    // « La Défense » est un quartier (PPLX) que seule sa variante accentuée nomme.
    expect(de('La Défense')[0]).toMatchObject({ geoSource: 'CITY', geoCityId: 8504417 });
    expect(de('Zzyzxville')[0]).toMatchObject({ geoSource: null, geoCityId: null });
    expect(de('Austin').filter((l) => l.geoSource === 'CITY').map((l) => l.geoCityId)).toEqual([4671654, 4671654, 4671654]);
    // Une subdivision connue du pays est exigée : « Austin, Ohio » n'est pas placée au Texas.
    expect(de('Austin').filter((l) => l.geoSource === null)).toHaveLength(1);
  });

  it('PRÉMISSE : une seule offre porte Chennevières-sur-Marne à son nom ; les autres sont autour, à moins de 30 km', async () => {
    expect(SEMIS.filter((s) => s.ville === 'Chennevières-sur-Marne').reduce((n, s) => n + s.n, 0)).toBe(1);
    const proches = [...villeDe.entries()].filter(([, v]) => ['Champigny-sur-Marne', 'Créteil', 'Paris', 'Paris 9e Arrondissement', 'La Défense'].includes(v));
    for (const [id] of proches) expect(haversine(CHENNEVIERES, await point(id))).toBeLessThan(30);
    // Meaux est juste au-delà du deuxième cercle (30,7 km) : la frontière est exercée.
    const meaux = [...villeDe.entries()].find(([, v]) => v === 'Meaux')![0];
    expect(haversine(CHENNEVIERES, await point(meaux))).toBeGreaterThan(30);
    // Le premier cercle (15 km) n'atteint pas 20 offres : la recherche doit s'élargir.
    const dans15 = (await Promise.all([...villeDe.keys()].filter((id) => !id.startsWith('cw_')).map(async (id) => {
      const j = await prisma.job.findUniqueOrThrow({ where: { id }, select: { geoLatitude: true, geoLongitude: true, countryCode: true } });
      return j.countryCode === 'FR' && j.geoLatitude !== null && haversine(CHENNEVIERES, [j.geoLatitude, j.geoLongitude!]) <= 15;
    }))).filter(Boolean).length;
    expect(dans15).toBe(8);
  });

  it('TÉMOIN CLÉ : « Chennevières-sur-Marne » rend les offres autour, non vides, la plus fraîche d’abord (D-510)', async () => {
    const { ids, total } = await toutes(filtres({ lieu: 'Chennevières-sur-Marne' }));
    expect(ids.length).toBeGreaterThan(1);
    expect(total).toBe(ids.length);
    const distances = await Promise.all(ids.map(async (id) => haversine(CHENNEVIERES, await point(id))));
    expect(ids).toEqual(await ordreFraicheur(ids));
    // PRÉMISSE : l'ordre par distance serait un autre ordre (l'offre au nom de la ville, à 0 km, est la plus ancienne).
    expect(villeDe.get(ids[ids.length - 1])).toBe('Chennevières-sur-Marne');
    // Le cercle de 15 km (8 offres) s'élargit à 30 km : Paris et La Défense y entrent ; Meaux (30,7 km) et
    // Fontainebleau (45 km) non.
    const villes = new Set(ids.map((id) => villeDe.get(id)));
    expect(villes).toEqual(new Set(['Chennevières-sur-Marne', 'Champigny-sur-Marne', 'Créteil', 'Paris', 'Paris 9e Arrondissement', 'La Défense']));
    expect(total).toBe(1 + 3 + 4 + 15 + 1 + 2 + 2 + 1);
    expect(Math.max(...distances)).toBeLessThanOrEqual(ANNEAUX_KM[1]);
  });

  it('SANS LE SIGNAL du client, le contrat d’avant : la comparaison au mot près, une seule offre à Chennevières-sur-Marne', async () => {
    const avant = await toutes(filtres({ lieu: 'Chennevières-sur-Marne', proximite: undefined, fraicheur: undefined }));
    expect(avant.ids.map((id) => villeDe.get(id))).toEqual(['Chennevières-sur-Marne']);
    expect(avant.total).toBe(1);
    // Et le même lieu, annoncé par le client, rend les offres autour.
    expect((await toutes(filtres({ lieu: 'Chennevières-sur-Marne' }))).total).toBeGreaterThan(1);
  });

  it('le lieu compris se dit comme la base l’écrit, avec sa subdivision', async () => {
    expect((await getJobs(filtres({ lieu: 'chennevieres sur marne' }))).lieu).toEqual({ type: 'ville', libelle: 'Chennevières-sur-Marne (94)' });
    expect((await getJobs(filtres({ lieu: 'Paris 9e Arrondissement' }))).lieu).toEqual({ type: 'ville', libelle: 'Paris 9e (75)' });
  });

  it('le premier cercle suffit quand il compte 20 offres : Paris s’arrête à 15 km', async () => {
    const { ids } = await toutes(filtres({ lieu: 'Paris (75)' }));
    const villes = new Set(ids.map((id) => villeDe.get(id)));
    // Paris (20, 9e et 15e compris) + La Défense (1, 9 km) + Créteil (4, 10 km) + Champigny (3, 11 km) ≥ 20 ;
    // Chennevières (16,6 km) et Meaux restent dehors.
    expect(villes).toEqual(new Set(['Paris', 'Paris 9e Arrondissement', 'La Défense', 'Créteil', 'Champigny-sur-Marne']));
  });

  it('D-499 : « Paris 15e » est son propre lieu ; son cercle retient le 15e, puis Paris et sa banlieue, la plus fraîche d’abord (D-510)', async () => {
    const quinzieme: [number, number] = [48.8412, 2.3003];
    const { ids } = await toutes(filtres({ lieu: 'Paris 15e (75)' }));
    expect((await getJobs(filtres({ lieu: 'Paris 15e (75)' }))).lieu).toEqual({ type: 'ville', libelle: 'Paris 15e (75)' });
    expect(ids.length).toBeGreaterThan(2);
    const distances = await Promise.all(ids.map(async (id) => haversine(quinzieme, await point(id))));
    // Les deux offres du 15e sont dans le cercle, à moins d'un kilomètre ; les autres sont plus loin.
    expect(distances.filter((d) => d < 1)).toHaveLength(2);
    expect(Math.max(...distances)).toBeLessThanOrEqual(ANNEAUX_KM[0]);
    expect(ids).toEqual(await ordreFraicheur(ids));
  });

  it('D-499 : un code postal est un lieu, avec son point ; inconnu de la base, il garde son préfixe d’avant', async () => {
    const r = await getJobs(filtres({ lieu: '94430' }));
    expect(r.lieu).toEqual({ type: 'codePostal', libelle: '94430 Chennevières-sur-Marne (94)' });
    expect((await toutes(filtres({ lieu: '94430' }))).ids.map((id) => villeDe.get(id))).toContain('Chennevières-sur-Marne');
    expect(r.total).toBeGreaterThan(1);
    // « 75015 » dessert Paris et le 15e : le lieu le plus précis.
    expect((await getJobs(filtres({ lieu: '75015' }))).lieu).toEqual({ type: 'codePostal', libelle: '75015 Paris 15e (75)' });
    expect((await getJobs(filtres({ lieu: '75015 Paris' }))).lieu).toEqual({ type: 'ville', libelle: '75015 Paris 15e (75)' });
    expect((await getJobs(filtres({ lieu: '94430 Chennevières-sur-Marne (94)' }))).total).toBe(r.total);
    const inconnu = await getJobs(filtres({ lieu: '99999' }));
    expect(inconnu.lieu).toEqual({ type: 'codePostal', libelle: '99999' });
    expect(inconnu.total).toBe(0);
  });

  it('un cercle trop pauvre s’élargit jusqu’à 100 km, jamais au-delà', async () => {
    const r = await getJobs(filtres({ lieu: 'Provins' }));
    const villes = new Set(r.jobs.map((j) => villeDe.get(j.id)));
    expect(villes.has('Orléans')).toBe(false); // Orléans est à 130 km de Provins
    expect(villes.has('Fontainebleau')).toBe(true);
    expect(villes.has('Provins')).toBe(true);
  });

  it('chaque compte de facette annonce la liste qu’un clic affichera, cercle compris', async () => {
    const r = await getJobs(filtres({ lieu: 'Chennevières-sur-Marne' }));
    const maison = r.facettes.find((f) => f.cle === 'maison')!;
    for (const option of maison.options) {
      const apres = await getJobs(filtres({ lieu: 'Chennevières-sur-Marne', filtres: { groupe: [GROUPE], maison: [option.value] } }));
      expect(apres.total, option.value).toBe(option.count);
    }
    // PRÉMISSE : la Maison « autre » n'a que 2 offres dans le cercle de la recherche entière (30 km), mais 5 dans le sien
    // (100 km, Fontainebleau compris) : un compte calculé dans le cercle de la recherche entière annoncerait 2.
    expect(maison.options.find((o) => o.value === AUTRE)?.count).toBe(5);
  });

  it('la pagination prolonge le même ordre, sans doublon ni trou', async () => {
    const premiere = await getJobs(filtres({ lieu: 'Chennevières-sur-Marne' }));
    expect(premiere.suivant).not.toBeNull();
    const seconde = await getJobs(filtres({ lieu: 'Chennevières-sur-Marne', apres: premiere.suivant! }));
    const ids = [...premiere.jobs, ...seconde.jobs].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(premiere.total);
    expect(ids).toEqual(await ordreFraicheur(ids));
  });

  it('le filtre « ville » (accueil de l’inscrit, alertes) suit la même proximité, plusieurs villes en union', async () => {
    const parLieu = await toutes(filtres({ lieu: 'Chennevières-sur-Marne' }));
    const parVille = await toutes(filtres({ filtres: { groupe: [GROUPE], ville: ['Chennevières-sur-Marne (94)'] } }));
    expect(parVille.ids).toEqual(parLieu.ids);
    const deux = await toutes(filtres({ filtres: { groupe: [GROUPE], ville: ['Chennevières-sur-Marne', 'Lyon'] } }));
    expect(new Set(deux.ids.map((id) => villeDe.get(id))).has('Lyon')).toBe(true);
    // La facette « ville » ignore son propre filtre : on peut toujours ajouter une ville du marché.
    const r = await getJobs(filtres({ filtres: { groupe: [GROUPE], ville: ['Chennevières-sur-Marne'] } }));
    expect(r.facettes.find((f) => f.cle === 'ville')!.options.map((o) => o.value)).toContain('orléans');
  });

  it('une ville inconnue garde la comparaison texte d’avant ; un homonyme se départage par sa subdivision', async () => {
    const inconnue = await getJobs(filtres({ lieu: 'Zzyzxville' }));
    expect(inconnue.jobs.map((j) => villeDe.get(j.id))).toEqual(['Zzyzxville']);
    expect(inconnue.lieu).toEqual({ type: 'ville', libelle: 'Zzyzxville' });
    expect((await getJobs(filtres({ lieu: 'Valence (82)' }))).lieu?.libelle).toBe('Valence (82)');
    expect((await getJobs(filtres({ lieu: 'Valence' }))).lieu?.libelle).toBe('Valence (26)');
  });

  it('une région du marché garde sa recherche par subdivision (« Texas ») ; le pays, le code postal et le télétravail, la leur', async () => {
    const texas = await getJobs({ marche: 'US', proximite: true, lieu: 'Texas', filtres: { maison: [MAISON] } });
    expect(texas.lieu?.type).toBe('ville');
    expect(texas.jobs.map((j) => villeDe.get(j.id))).toEqual(['Austin', 'Austin', 'Austin']);
    // Une ville dans la région de son nom reste une ville (« New York » n'est pas tout l'État).
    expect((await getJobs({ marche: 'US', proximite: true, lieu: 'New York', filtres: { maison: [MAISON] } })).lieu).toEqual({ type: 'ville', libelle: 'New York City (NY)' });
    // Une région nommée dans la langue de l'interface (« Bourgogne ») l'emporte sur une petite commune homonyme hors d'elle ;
    // la commune reste cherchable par sa subdivision.
    expect((await getJobs(filtres({ lieu: 'Bourgogne' }))).lieu).toEqual({ type: 'ville', libelle: 'Bourgogne' });
    expect((await getJobs(filtres({ lieu: 'Bourgogne (51)' }))).lieu).toEqual({ type: 'ville', libelle: 'Bourgogne (51)' });
    expect((await getJobs(filtres({ lieu: 'France' }))).lieu?.type).toBe('pays');
    expect((await getJobs(filtres({ lieu: '94430' }))).lieu?.type).toBe('codePostal');
    expect((await getJobs(filtres({ lieu: 'Télétravail' }))).lieu?.type).toBe('teletravail');
  });

  it('plusieurs villes : chacune son cercle (Paris s’arrête à 15 km, Lyon s’élargit jusqu’à Vienne)', async () => {
    const f = filtres({ filtres: { groupe: [GROUPE], ville: ['Paris (75)', 'Lyon'] } });
    const { ids } = await toutes(f);
    const villes = new Set(ids.map((id) => villeDe.get(id)));
    // PRÉMISSE : un cercle commun (le plus petit qui compte 20 offres sur l'ensemble) s'arrêterait à 15 km pour les deux
    // villes et laisserait Vienne (27 km de Lyon) dehors ; Lyon seule compte 4 offres à 15 km.
    expect(haversine([45.74906, 4.84789], [45.52569, 4.87484])).toBeGreaterThan(15);
    expect(villes.has('Vienne')).toBe(true);
    expect(villes.has('Chennevières-sur-Marne')).toBe(false);
    // Les facettes annoncent la liste d'un clic, cercles par ville compris.
    const r = await getJobs(f);
    for (const option of r.facettes.find((x) => x.cle === 'maison')!.options) {
      const apres = await getJobs(filtres({ filtres: { groupe: [GROUPE], ville: ['Paris (75)', 'Lyon'], maison: [option.value] } }));
      expect(apres.total, option.value).toBe(option.count);
    }
  });

  it('une offre sans point : retenue par le nom de sa ville, à sa place de fraîcheur (D-510) ; jamais un homonyme refusé', async () => {
    // « Austin, Ohio » (sans point : le déclencheur a refusé de la placer au Texas) n'est pas retenue pour Austin (TX).
    const texas = await getJobs({ marche: 'US', proximite: true, lieu: 'Austin', filtres: { maison: [MAISON] } });
    expect(texas.jobs.map((j) => villeDe.get(j.id))).toEqual(['Austin', 'Austin', 'Austin']);
    expect(await prisma.job.count({ where: { id: { in: texas.jobs.map((j) => j.id) }, geoSource: null } })).toBe(0);
    // Une offre de Créteil pas encore rattrapée (sans point, sans subdivision) : retenue, à sa place de fraîcheur.
    const id = [...villeDe.entries()].find(([, v]) => v === 'Créteil')![0];
    await prisma.$executeRaw`UPDATE "Job" SET "geoLatitude" = NULL, "geoLongitude" = NULL, "geoCityId" = NULL, "geoSource" = NULL WHERE id = ${id}`;
    try {
      const { ids } = await toutes(filtres({ lieu: 'Créteil' }));
      expect(ids).toContain(id);
      expect(ids).toEqual(await ordreFraicheur(ids));
    } finally {
      await prisma.$executeRaw`UPDATE "Job" SET "geoLatitude" = 48.79266, "geoLongitude" = 2.46569, "geoCityId" = 3022530, "geoSource" = 'CITY' WHERE id = ${id}`;
    }
  });

  it('une seule ville filtrée avec des offres sans point : la facette choisit le même cercle que la liste', async () => {
    // PRÉMISSE : Provins n'a que 2 offres situées à 15 km ; 18 offres « Provins » pas encore rattrapées (sans point) les
    // portent à 20 : une facette qui les compterait et une liste qui les ignorerait choisiraient deux cercles différents.
    const ajoutees = Array.from({ length: 18 }, (_v, i) => `${P}provins-${i}`);
    for (const id of ajoutees) {
      await prisma.job.create({ data: { id, companyId: MAISON, externalId: id, source: 'GENERIC_JSONLD', title: 'Conseiller de vente',
        url: `https://example.com/${id}`, isActive: true, countryCode: 'FR', city: 'Provins',
        sources: { create: { sourceKey: 'prox-d496', sourceTier: 'ATS_OFFICIAL', externalId: id, url: `https://example.com/${id}`, isActive: true,
          ...publicationFixture({ sourceKey: 'prox-d496', sourceTier: 'ATS_OFFICIAL', externalId: id, url: `https://example.com/${id}`, title: 'Conseiller de vente', country: 'FR' }) } } } });
    }
    await prisma.$executeRaw`UPDATE "Job" SET "geoLatitude" = NULL, "geoLongitude" = NULL, "geoCityId" = NULL, "geoSource" = NULL WHERE id = ANY(${ajoutees})`;
    try {
      for (const ville of [['Provins'], ['Provins', 'Zzyzxville']]) {
        const f = filtres({ filtres: { groupe: [GROUPE], ville } });
        const r = await getJobs(f);
        expect(r.total, ville.join('+')).toBe(20 + (ville.length > 1 ? 1 : 0));
        for (const option of r.facettes.find((x) => x.cle === 'maison')!.options) {
          expect((await getJobs(filtres({ filtres: { groupe: [GROUPE], ville, maison: [option.value] } }))).total, option.value).toBe(option.count);
        }
      }
    } finally {
      await prisma.jobSource.deleteMany({ where: { jobId: { in: ajoutees } } });
      await prisma.job.deleteMany({ where: { id: { in: ajoutees } } });
      while (await drainSearchIndex()) { /* index à jour */ }
    }
  });

  it('les deux origines (D-419, D-496, D-510) : dans le cercle retenu, toutes les offres Catwalks d’abord, puis les agrégées, chacune la plus fraîche d’abord ; hors du cercle, aucune', async () => {
    const directe = (suffixe: string, ville: string) => ({
      id: `${P}directe-${suffixe}`, version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin', payload: {},
      correspondanceVersion: 1, slug: `prox-d496-directe-${suffixe}`, title: 'Conseiller de vente', company: MAISON, companyId: MAISON,
      countryCode: 'FR', city: ville, location: ville, language: 'fr', description: 'Conseiller de vente',
      applyUrl: `https://catwalks.io/offres/prox-d496-directe-${suffixe}`, postedAt: new Date('2026-09-01T00:00:00Z'),
      modifiedAt: new Date('2026-09-01T00:00:00Z'), searchText: 'Conseiller de vente' });
    // Écrites de la plus loin à la plus proche : l'ordre d'écriture ne doit rien décider. La plus proche est aussi la plus
    // ancienne : D-510, la fraîcheur départage les offres Catwalks entre elles, plus la distance.
    await prisma.directOffer.create({ data: directe('meaux', 'Meaux') });
    await prisma.directOffer.create({ data: directe('defense', 'La Défense') });
    await prisma.directOffer.create({ data: directe('paris', 'Paris') });
    await prisma.directOffer.create({ data: { ...directe('champigny', 'Champigny-sur-Marne'), postedAt: new Date('2026-08-01T00:00:00Z') } });
    try {
      // PRÉMISSE : les offres Catwalks reçoivent le point de leur ville (déclencheur) : Champigny 4 km, Paris 16 km,
      // La Défense 25 km (dans le cercle de 30 km), Meaux 30,7 km (dehors). Une offre agrégée est à Chennevières même (0 km).
      const points = await prisma.directOffer.findMany({ where: { id: { startsWith: `${P}directe-` } },
        select: { id: true, geoSource: true, geoCityId: true, geoLatitude: true, geoLongitude: true } });
      expect(points.map((d) => [d.geoSource, d.geoCityId]).sort()).toEqual([['CITY', 2988507], ['CITY', 2994798], ['CITY', 3027105], ['CITY', 8504417]]);
      const km = (suffixe: string) => { const d = points.find((x) => x.id === `${P}directe-${suffixe}`)!; return haversine(CHENNEVIERES, [d.geoLatitude!, d.geoLongitude!]); };
      expect(km('defense')).toBeGreaterThan(20);
      expect(km('defense')).toBeLessThan(ANNEAUX_KM[1]);
      expect(km('meaux')).toBeGreaterThan(ANNEAUX_KM[1]);

      const { ids, total } = await toutes(filtres({ lieu: 'Chennevières-sur-Marne' }));
      // Les offres Catwalks passent devant toutes les agrégées, l'offre à 25 km comprise ; entre elles, la plus fraîche
      // d'abord (Paris et La Défense le même jour, départagées par l'identifiant ; Champigny, la plus ancienne, après).
      expect(ids.slice(0, 3)).toEqual([`cw_${P}directe-defense`, `cw_${P}directe-paris`, `cw_${P}directe-champigny`]);
      expect(ids).toEqual(await ordreFraicheur(ids));
      // Le cercle retenu (30 km) ne change pas pour une offre Catwalks : Meaux n'est pas rendue, ni comptée.
      expect(ids).not.toContain(`cw_${P}directe-meaux`);
      expect(ids).toHaveLength(29 + 3);
      expect(total).toBe(29 + 3);
      // Un code postal aussi : la même logique de lieu pour les deux origines.
      expect((await getJobs(filtres({ lieu: '94430' }))).jobs.slice(0, 3).map((j) => j.id))
        .toEqual([`cw_${P}directe-defense`, `cw_${P}directe-paris`, `cw_${P}directe-champigny`]);
      // Sans lieu : les offres Catwalks d'abord, toutes, Meaux comprise.
      const sansLieu = await toutes(filtres());
      expect(sansLieu.ids.slice(0, 4).sort()).toEqual(['champigny', 'defense', 'meaux', 'paris'].map((s) => `cw_${P}directe-${s}`));
    } finally {
      await prisma.directOffer.deleteMany({ where: { id: { startsWith: `${P}directe-` } } });
      while (await drainSearchIndex()) { /* index à jour */ }
    }
  });

  it('l’alerte rejoue la même recherche : même total, nouvelles dans l’ordre de la page, la plus fraîche d’abord (D-510)', async () => {
    const page = await getJobs(filtres({ lieu: 'Chennevières-sur-Marne' }));
    const examen = await examinerAlerte(filtres({ lieu: 'Chennevières-sur-Marne' }), new Date('2026-09-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));
    expect(examen.total).toBe(page.total);
    expect(examen.total).toBe(29); // le cercle de 30 km, pas la seule offre au nom de la ville
    expect(examen.nouvelles).toBe(page.total);
    expect(examen.jobs.map((j) => j.id).slice(0, page.jobs.length)).toEqual(page.jobs.map((j) => j.id));
    expect(examen.jobs.map((j) => j.id)).toEqual(await ordreFraicheur(examen.jobs.map((j) => j.id)));
    const parVille = await examinerAlerte(filtres({ filtres: { groupe: [GROUPE], ville: ['Chennevières-sur-Marne'] } }),
      new Date('2026-09-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));
    expect(parVille.total).toBe(page.total);
  });

  it('les suggestions sont des lieux reconnus avec leur subdivision : la ville, puis ses arrondissements ; les codes postaux', async () => {
    const fr = exigerPerimetre('FR');
    expect(await suggestLieux('Chenn', fr)).toEqual(['Chennevières-sur-Marne (94)']);
    // D-499 : « paris » : Paris d'abord (le plus d'offres), puis ses arrondissements (le 9e porte une offre, le 15e aucune).
    expect(await suggestLieux('Paris', fr)).toEqual(['Paris (75)', 'Paris 9e (75)', 'Paris 15e (75)']);
    expect(await suggestLieux('9443', fr)).toEqual(['94430 Chennevières-sur-Marne (94)']);
    expect(await suggestLieux('75015', fr)).toEqual(['75015 Paris 15e (75)']);
    expect(await suggestLieux('100', exigerPerimetre('US'))).toEqual(['10001 New York (NY)']);
    expect(await suggestLieux('100', fr)).toEqual([]);
    // Sans offre à leur nom, deux homonymes se rangent par population ; la subdivision les distingue.
    expect(await suggestLieux('Vale', fr)).toEqual(['Valence (26)', 'Valence (82)']);
    // Le nombre d'offres d'abord : Champigny-sur-Marne (3 offres) devant Chennevières-sur-Marne (1), avant toute population.
    expect(await suggestLieux('Ch', fr)).toEqual(['Champigny-sur-Marne (94)', 'Chennevières-sur-Marne (94)']);
    // Un quartier est un lieu reconnu (D-499) : proposé après la commune homonyme plus peuplée.
    expect(await suggestLieux('La Def', fr)).toEqual(['La Défense (92)']);
    expect(await suggestLieux('Saint-Lo', fr)).toEqual(['Saint-Louis (68)', 'Saint-Louis (13)']);
    // Le cloisonnement par marché tient.
    expect(await suggestLieux('Aus', fr)).toEqual([]);
    expect(await suggestLieux('Paris', exigerPerimetre('US'))).toEqual(['Paris (TX)', 'Paris (KY)']);
    // Le nom dans la langue de l'interface servie par le marché.
    expect(await suggestLieux('Mün', exigerPerimetre('DE'), 'de-DE')).toEqual(['München']);
  });

  it('le rattrapage du stock (scripts/geo/rattrapage-ecriture.sql) donne leur point aux offres d’avant la base de villes, et ne réécrit rien au second passage', async () => {
    // PRÉMISSE : une offre écrite quand la base de villes était vide n'a pas de point.
    const id = `${P}avant-base`;
    await viderVilles(prisma);
    await prisma.job.create({ data: { id, companyId: MAISON, externalId: id, source: 'GENERIC_JSONLD', title: 'Conseiller de vente',
      url: `https://example.com/${id}`, isActive: true, countryCode: 'FR', city: 'Créteil' } });
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).geoSource).toBeNull();
    await semerVilles(prisma);
    oublierVilles();
    const avant = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM catwalks_geo_rattrapage() WHERE origine = 'job'`;
    expect(avant.map((r) => r.id)).toContain(id);
    const ecrire = async () => {
      const script = readFileSync(join(__dirname, '..', '..', '..', 'aggregator', 'scripts', 'geo', 'rattrapage-ecriture.sql'), 'utf8')
        .split('\n').filter((l) => !l.startsWith('\\') && !l.startsWith('--')).join('\n');
      // Les réglages de session (`SET`) restent au script : sur la connexion partagée du témoin, ils survivraient à lui.
      const instructions = script.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !/^(BEGIN|COMMIT|SET\b)/i.test(s));
      const appels = instructions.filter((s) => /^CALL\b/i.test(s));
      // PRÉMISSE : le script écrit le point par la procédure en tranches, hors de toute transaction.
      expect(appels).toEqual(['CALL catwalks_geo_rattrapage_ecrire(1000)']);
      await prisma.$transaction(async (tx) => { for (const sql of instructions.filter((s) => !appels.includes(s))) await tx.$executeRawUnsafe(sql); }, { timeout: 30_000 });
      for (const appel of appels) await prisma.$executeRawUnsafe(appel);
    };
    await ecrire();
    expect(await prisma.job.findUniqueOrThrow({ where: { id }, select: { geoSource: true, geoCityId: true } })).toEqual({ geoSource: 'CITY', geoCityId: 3022530 });
    expect(await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM catwalks_geo_rattrapage() WHERE id LIKE ${`${P}%`}`).toEqual([{ n: 0n }]);
    // L'apprentissage : PRÉMISSE, la règle par nom désigne Saint-Louis (68) ; les offres de ce nom sont toutes rattachées
    // au quartier de Marseille (13), celle sans coordonnées comprise, et la saisie « Saint-Louis » le désigne aussi.
    expect(await prisma.$queryRaw<{ id: number }[]>`SELECT catwalks_ville_par_nom(ARRAY['FR'], 'Saint-Louis', NULL) AS id`).toEqual([{ id: 2978742 }]);
    const saintLouis = await prisma.job.findMany({ where: { id: { startsWith: P }, city: 'Saint-Louis' }, select: { geoCityId: true, geoSource: true } });
    expect(saintLouis.map((j) => j.geoCityId)).toEqual([2978738, 2978738, 2978738]);
    expect(saintLouis.filter((j) => j.geoSource === 'CITY')).toHaveLength(1);
    oublierVilles();
    expect((await getJobs(filtres({ lieu: 'Saint-Louis' }))).lieu?.libelle).toBe('Saint-Louis (13)');
    expect((await getJobs(filtres({ lieu: 'Saint-Louis (68)' }))).lieu?.libelle).toBe('Saint-Louis (68)');
  });
});

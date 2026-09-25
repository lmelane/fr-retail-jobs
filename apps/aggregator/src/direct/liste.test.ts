import { describe, expect, it } from 'vitest';
import { contexteTemoin, offreListe } from './fixture.js';
import { ListeIndisponibleError, ListeInvalideError, lireItemListe, lireListe, listeHttp, offreCatalogueDepuisListe } from './liste.js';
import { colonnesProjetees } from './projection.js';

/**
 * D-444 — LA LISTE PUBLIQUE DU BACKEND, LUE SANS CONFIANCE. La forme de `offreListe` est celle de
 * `GET https://catwalks.api.catwalks.io/api/jobs` au 25/09/2026 (29 champs).
 */
describe('lecture de la liste publique (D-444)', () => {
  it('une offre de la liste devient un contrat catalogue v1, au miroir de la projection du backend, sans rien deviner', () => {
    const offre = offreCatalogueDepuisListe(lireItemListe(offreListe()), 'FR');
    expect(offre).toMatchObject({
      version: 1, id: 'cmliste0001', slug: 'conseiller-de-vente-h-f', anciensSlugs: [], titre: 'Conseiller de vente H/F',
      maison: { nom: 'Maison Liste Témoin', slug: 'maison-liste-temoin' }, univers: ['MODE', 'LUXE'], specialisations: ['PRET_A_PORTER_ACCESSOIRES'],
      metier: { slug: 'CONSEILLER_VENTE', libelle: 'Conseiller de vente' }, contrat: 'CDI', tempsDeTravail: 'TEMPS_PLEIN', experience: null, teletravail: null,
      // La liste ne porte ni ville, ni arrondissement, ni code postal : ils restent vides ; le pays est celui qu'on lui donne.
      lieu: { libelle: 'Paris 8e — avenue Montaigne', ville: null, arrondissement: null, codePostal: null, pays: 'FR', latitude: 48.8666, longitude: 2.3048 },
      salaire: { min: 30000, max: 35000, devise: 'EUR', texte: '30K à 35K €' },
      publieeLe: '2026-09-22T11:13:21.199Z', finLe: '2027-09-17T11:13:21.199Z', modifieeLe: '2026-09-23T08:31:05.640Z',
      // Au miroir de `urlOffre` du backend.
      candidature: { type: 'CATWALKS', url: 'https://catwalks.io/offres/conseiller-de-vente-h-f' },
    });
    // Au miroir du backend : une section vide ou blanche ne sort pas (avantages « »), la devise n'existe qu'avec une borne.
    expect(offre.description.avantages).toBeNull();
    expect(offreCatalogueDepuisListe(lireItemListe(offreListe({ salaryMin: null, salaryMax: null, salary: '  ' })), null).salaire)
      .toEqual({ min: null, max: null, devise: null, texte: null });
  });

  it('D-455 sur la forme réelle de la liste : un mandat (`maison: null`) a « Catwalks » pour employeur, aucun rattachement', () => {
    const mandat = lireItemListe(offreListe({ maison: null }));
    // PRÉMISSE : la liste sert le mandat sans Maison, avec des univers (ceux que la version 1 prenait pour employeur).
    expect(mandat.maison).toBeNull();
    expect(mandat.univers).toEqual(['MODE', 'LUXE']);
    const colonnes = colonnesProjetees(offreCatalogueDepuisListe(mandat, 'FR'), contexteTemoin({ maisons: { Catwalks: 'societe-homonyme' } }));
    expect(colonnes.company).toBe('Catwalks');
    expect(colonnes.maisonSlug).toBeNull();
    // Même si le registre connaissait une société « Catwalks », un mandat n'est rattaché à rien (jamais un groupe inventé).
    expect(colonnes.companyId).toBeNull();
  });

  it('refuse une offre illisible en nommant son chemin, garde les autres ; accepte les champs inconnus', () => {
    const lecture = lireListe([
      offreListe({ id: 'ok1', slug: 'ok-1', champNouveau: 'ignoré' }),
      offreListe({ id: 'horsLigne', slug: 'hors-ligne', status: 'OFFLINE' }),
      offreListe({ id: 'sansTitre', slug: 'sans-titre', title: null }),
      offreListe({ id: 'latitude', slug: 'latitude', latitude: '48.8' }),
      42,
    ]);
    expect(lecture.taille).toBe(5);
    expect(lecture.offres.map((o) => o.id)).toEqual(['ok1']);
    expect(lecture.refus.map(({ index, id, chemin }) => ({ index, id, chemin }))).toEqual([
      { index: 1, id: 'horsLigne', chemin: 'liste[1].status' },
      { index: 2, id: 'sansTitre', chemin: 'liste[2].title' },
      { index: 3, id: 'latitude', chemin: 'liste[3].latitude' },
      { index: 4, id: null, chemin: 'liste[4]' },
    ]);
  });

  it('`isActive` n’est pas un critère (la route publique ne le filtre pas) : seule sa forme est lue', () => {
    expect(lireListe([offreListe({ isActive: false })]).offres).toHaveLength(1);
    expect(lireListe([offreListe({ isActive: 'oui' })]).refus[0].chemin).toBe('liste[0].isActive');
  });

  it('une réponse qui n’est pas un tableau, ou qui sert deux fois le même identifiant, est invalide tout entière', () => {
    expect(() => lireListe({ offres: [] })).toThrow(ListeInvalideError);
    expect(() => lireListe(null)).toThrow(ListeInvalideError);
    expect(() => lireListe([offreListe(), offreListe()])).toThrow(/servi deux fois/);
  });

  it('l’origine du backend vient de la configuration : https nue, http seulement vers la machine locale', () => {
    for (const refusee of ['http://catwalks.api.catwalks.io', 'https://a:b@catwalks.api.catwalks.io', 'https://catwalks.api.catwalks.io/api',
      'https://catwalks.api.catwalks.io?x=1', 'ftp://catwalks.api.catwalks.io', 'pas une url'])
      expect(() => listeHttp(refusee), refusee).toThrow(/CATALOGUE_LISTE_URL/);
    expect(() => listeHttp('https://catwalks.api.catwalks.io/')).not.toThrow();
    expect(() => listeHttp('http://127.0.0.1:3101')).not.toThrow();
  });

  it('lit `/api/jobs` sans suivre de redirection ; panne et réponse illisible sont nommées', async () => {
    const appels: { url: string; init?: RequestInit }[] = [];
    const repondre = (reponse: Response | Error) => (async (url: string | URL | Request, init?: RequestInit) => {
      appels.push({ url: String(url), init });
      if (reponse instanceof Error) throw reponse;
      return reponse;
    }) as typeof fetch;
    const liste = [offreListe()];
    expect(await listeHttp('https://catwalks.api.catwalks.io', repondre(Response.json(liste))).lire()).toEqual(liste);
    expect(appels[0].url).toBe('https://catwalks.api.catwalks.io/api/jobs');
    expect(appels[0].init?.redirect).toBe('error');
    await expect(listeHttp('https://x.example', repondre(new Response('panne', { status: 503 }))).lire()).rejects.toMatchObject({ name: 'ListeIndisponibleError', statut: 503 });
    await expect(listeHttp('https://x.example', repondre(new TypeError('fetch failed'))).lire()).rejects.toBeInstanceOf(ListeIndisponibleError);
    // La cause est nommée, route comprise : une panne DNS ne se confond pas avec une redirection refusée.
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x.example' } });
    await expect(listeHttp('https://x.example', repondre(dns)).compter()).rejects.toThrow('/api/jobs/filters : TypeError : fetch failed (ENOTFOUND)');
    const redirection = Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') });
    await expect(listeHttp('https://x.example', repondre(redirection)).lire()).rejects.toThrow('/api/jobs : TypeError : fetch failed (unexpected redirect)');
    await expect(listeHttp('https://x.example', repondre(new Response('<html>', { status: 200 }))).lire()).rejects.toBeInstanceOf(ListeInvalideError);
    await expect(listeHttp('https://x.example', repondre(new Response('[]', { status: 200, headers: { 'content-length': '999999999' } }))).lire())
      .rejects.toBeInstanceOf(ListeInvalideError);
    // Sans en-tête de longueur, le corps est coupé à la borne pendant la lecture, jamais lu en entier. Le corps est FINI
    // (40 Mo d'espaces, le double de la borne) : lu sans borne, il irait au bout et échouerait sur « JSON attendu », un
    // échec d'assertion net plutôt qu'un processus tué faute de mémoire.
    let servis = 0;
    const flot = new ReadableStream<Uint8Array>({ pull(controle) {
      if (++servis > 40) controle.close(); else controle.enqueue(new Uint8Array(1_000_000).fill(32));
    } });
    await expect(listeHttp('https://x.example', repondre(new Response(flot, { status: 200 }))).lire()).rejects.toThrow(/\/api\/jobs : réponse au-delà de 20000000 octets/);
    expect(servis).toBeLessThan(25);
  });
});

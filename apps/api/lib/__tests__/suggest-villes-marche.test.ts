import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { estCodeMarche } from '@catwalks/db/marches';

/**
 * TÉMOIN — LE CLOISONNEMENT DES VILLES PAR MARCHÉ (arbitrage CEO, option A).
 *
 * « Je sélectionne FR → je ne vois que des villes FR ; je sélectionne US →
 * uniquement des villes US. » Cloisonnement strict, comme Indeed.
 *
 * ── POURQUOI CE TÉMOIN PARLE À UNE VRAIE BASE ─────────────────────────────
 *
 * Parce que le défaut qu'il garde vit dans le SQL, et nulle part ailleurs. La
 * déduction du pays est une CTE avec un `HAVING COUNT(DISTINCT …) = 1` et un
 * `COALESCE` dont l'abstention repose sur la logique ternaire de SQL
 * (`NULL = ANY(...)` est faux). Une doublure de Prisma ne prouverait que ce
 * qu'on lui a fait dire : elle passerait au vert avec un `HAVING` inversé.
 *
 * La base est la base de TEST, jetable et vérifiée comme telle avant toute
 * écriture. Elle est SEMÉE ici, pas empruntée à la production : un témoin qui
 * dépend des données du jour rougit le jour où une offre bouge, et personne ne
 * sait plus si c'est le code ou le catalogue.
 *
 * ── LE JEU D'ESSAI EST CONSTRUIT POUR EXERCER CHAQUE BRANCHE ──────────────
 *
 * Chaque ligne semée existe pour faire passer le code par un chemin précis, et
 * l'assertion de prémisse ci-dessous VÉRIFIE qu'elle y arrive vraiment. Sans
 * ça, un jeu d'essai peut passer au vert sans jamais exercer le défaut — le
 * pire des faux négatifs, parce qu'il rassure.
 *
 *   PARIS      FR + US + ES  → la ville multi-pays ; 370 comme elle en prod
 *   AUSTIN     US seul       → la ville qui ne doit apparaître QU'en US
 *   LEVALLOIS  sans pays, vue ailleurs en FR seul   → DÉDUCTIBLE → FR
 *   BEDFORD    sans pays, vue ailleurs en GB ET US  → AMBIGUË → nulle part
 *   ZURVILLE   sans pays, vue nulle part ailleurs   → SANS OCCURRENCE → idem
 */

const url = process.env.DATABASE_URL ?? '';
/*
 * Le même garde que `setup-integration.ts` de l'agrégateur, et pour la même
 * raison : ce fichier ÉCRIT. Il refuse de tourner ailleurs que sur une base
 * dont le NOM porte « test ». Le témoin est simplement sauté quand la base
 * n'est pas là — il ne rougit pas, parce qu'un environnement sans Postgres
 * n'est pas un défaut du produit.
 */
const nomBase = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
const actif = Boolean(url) && /test/i.test(nomBase);

/** Un identifiant de semis reconnaissable : le nettoyage ne touche que lui. */
const MARQUEUR = 'temoin-villes-marche';

type Semis = { ville: string; pays: string | null; n: number };

/*
 * Le semis, ligne à ligne. Les volumes sont choisis pour que l'ORDRE du
 * résultat soit décidable : le tri est `COUNT(*) DESC`, donc deux villes à
 * égalité rendraient un ordre instable et le témoin deviendrait intermittent.
 */
const SEMIS: readonly Semis[] = [
  // PARIS existe dans trois pays — le cœur du défaut.
  { ville: 'Paris', pays: 'FR', n: 5 },
  { ville: 'Paris', pays: 'US', n: 2 },
  { ville: 'Paris', pays: 'ES', n: 1 },
  // Une ville purement américaine, pour prouver que FR ne la voit pas.
  { ville: 'Austin', pays: 'US', n: 4 },
  // Une ville purement française, pour le sens inverse.
  { ville: 'Pantin', pays: 'FR', n: 3 },
  // Pays ajoutés au registre : une présence positive évite un vert sur liste vide.
  { ville: 'Panjin', pays: 'CN', n: 6 },
  { ville: 'Paal', pays: 'BE', n: 7 },
  // DÉDUCTIBLE : sans pays ici, et vue ailleurs SOUS UN SEUL pays (FR).
  { ville: 'Levallois', pays: null, n: 3 },
  { ville: 'Levallois', pays: 'FR', n: 1 },
  // AMBIGUË : sans pays ici, et vue ailleurs sous DEUX pays (GB et US).
  { ville: 'Bedford', pays: null, n: 3 },
  { ville: 'Bedford', pays: 'GB', n: 1 },
  { ville: 'Bedford', pays: 'US', n: 1 },
  // SANS OCCURRENCE : sans pays, et jamais vue avec un pays.
  { ville: 'Panzurville', pays: null, n: 3 },
];

describe.skipIf(!actif)('suggestCities — cloisonnement par marché', () => {
  let suggestCities: (q: string, marche?: string) => Promise<string[]>;
  let prisma: import('@prisma/client').PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await import('@catwalks/db'));
    ({ suggestCities } = await import('../jobs'));
    await nettoyer();

    const entreprise = await prisma.company.create({
      data: {
        name: MARQUEUR,
        canonicalKey: MARQUEUR,
        fashionjobsUrl: `https://example.invalid/${MARQUEUR}`,
      },
    });
    /*
     * `createMany` plutôt qu'une boucle de `create` : une centaine d'allers-
     * retours réseau feraient de ce témoin le plus lent du dépôt pour aucun
     * bénéfice — rien ici ne dépend de l'ordre d'insertion.
     */
    let i = 0;
    await prisma.job.createMany({
      data: SEMIS.flatMap((s) =>
        Array.from({ length: s.n }, () => {
          const numero = i++;
          return {
            companyId: entreprise.id,
            externalId: `${MARQUEUR}-${numero}`,
            source: 'UNKNOWN' as const,
            title: 'Conseiller de vente',
            url: `https://example.invalid/${MARQUEUR}/${numero}`,
            // `fingerprint` est unique et obligatoire : le dédoublonnage du
            // pipeline s'en sert. Un semis qui le répéterait n'insérerait
            // qu'une ligne, et le témoin mesurerait un catalogue vide.
            fingerprint: `${MARQUEUR}-${numero}`,
            city: s.ville,
            countryCode: s.pays,
            isActive: true,
          };
        }),
      ),
    });
    const jobs = await prisma.job.findMany({ where: { companyId: entreprise.id }, select: { id: true, externalId: true, url: true } });
    await prisma.jobSource.createMany({ data: jobs.map(job => ({ jobId: job.id, externalId: job.externalId,
      sourceKey: MARQUEUR, sourceTier: 'ATS_OFFICIAL', url: job.url })) });
  }, 120_000);

  afterAll(async () => {
    if (!actif) return;
    await nettoyer();
    await prisma.$disconnect();
  });

  async function nettoyer() {
    await prisma.job.deleteMany({ where: { externalId: { startsWith: MARQUEUR } } });
    await prisma.company.deleteMany({ where: { name: MARQUEUR } });
  }

  /**
   * ── L'ASSERTION DE PRÉMISSE ───────────────────────────────────────────
   *
   * Elle passe AVANT tout le reste, et elle est la seule qui garde les autres.
   * Elle affirme que la situation de départ REMPLIT la condition du défaut :
   * « Paris » existe bien sous plusieurs pays, et les trois villes orphelines
   * sont bien dans les trois états attendus (déductible, ambiguë, sans
   * occurrence).
   *
   * Sans elle, un semis qui ne créerait qu'un seul Paris ferait passer tous
   * les tests suivants au vert **sans jamais exercer le cloisonnement** : la
   * liste ne contiendrait qu'une ville française, et l'assertion « FR ne voit
   * que la France » serait vraie par accident. C'est exactement le faux
   * négatif rassurant qu'un témoin doit rendre impossible.
   */
  it('PRÉMISSE — le jeu d’essai exerce réellement chaque branche', async () => {
    const parPays = await prisma.job.groupBy({
      by: ['countryCode'],
      where: { externalId: { startsWith: MARQUEUR }, city: 'Paris' },
      _count: { _all: true },
    });
    // Le défaut EXISTE dans le semis : sans ça, rien à cloisonner.
    expect(parPays.length).toBeGreaterThan(1);
    expect(parPays.map((p) => p.countryCode).sort()).toEqual(['ES', 'FR', 'US']);

    /* Les trois états d'une ville sans pays sont bien tous représentés. */
    const paysConnus = async (ville: string) =>
      (
        await prisma.job.groupBy({
          by: ['countryCode'],
          where: { externalId: { startsWith: MARQUEUR }, city: ville, countryCode: { not: null } },
        })
      )
        .map((r) => r.countryCode)
        .sort();

    const orpheline = async (ville: string) =>
      prisma.job.count({ where: { externalId: { startsWith: MARQUEUR }, city: ville, countryCode: null } });

    expect(await orpheline('Levallois')).toBeGreaterThan(0);
    expect(await paysConnus('Levallois')).toEqual(['FR']); // UN seul → déductible
    expect(await orpheline('Bedford')).toBeGreaterThan(0);
    expect(await paysConnus('Bedford')).toEqual(['GB', 'US']); // DEUX → ambiguë
    expect(await orpheline('Panzurville')).toBeGreaterThan(0);
    expect(await paysConnus('Panzurville')).toEqual([]); // AUCUN → abstention
  });

  it('marché FR — « Paris » ne rend QUE la ville française', async () => {
    const villes = await suggestCities('Paris', 'FR');
    expect(villes).toContain('Paris');
    /*
     * Le cœur du défaut : la liste ne doit porter QU'UNE entrée « Paris ».
     * Aujourd'hui, sans cloisonnement, elle en porte une par pays et rien ne
     * les distingue à l'écran — le candidat ne peut pas choisir.
     */
    expect(villes.filter((v) => v.toLowerCase() === 'paris')).toHaveLength(1);
  });

  it('marché FR — une ville purement américaine est absente', async () => {
    expect(await suggestCities('Aus', 'FR')).not.toContain('Austin');
    /* Et le sens inverse, sinon on ne prouverait que l'absence de résultats. */
    expect(await suggestCities('Pan', 'FR')).toContain('Pantin');
  });

  it('marché US — les villes américaines, et elles seules', async () => {
    expect(await suggestCities('Aus', 'US')).toContain('Austin');
    expect(await suggestCities('Pan', 'US')).not.toContain('Pantin');
    /* « Paris » existe aux US : le marché américain doit bien le proposer. */
    expect(await suggestCities('Paris', 'US')).toContain('Paris');
  });

  it('ville DÉDUCTIBLE — un seul pays ailleurs, donc rattachée à ce marché', async () => {
    // 487 villes en production (41,7 % des orphelines) sont dans ce cas.
    expect(await suggestCities('Levallois', 'FR')).toContain('Levallois');
    // Et elle n'est PAS servie au marché dont elle ne relève pas.
    expect(await suggestCities('Levallois', 'US')).not.toContain('Levallois');
  });

  it('ville AMBIGUË — deux pays possibles, donc absente de tous les marchés', async () => {
    // 116 villes en production : Aberdeen (GB/SD), Bedford (CA/GB/US)…
    // Les offres AVEC pays restent servies à leur marché ; c'est l'ORPHELINE
    // qu'on refuse de rattacher. Ici Bedford existe en GB et US, donc les deux
    // marchés la voient — mais aucun ne récupère les 3 offres sans pays.
    const enGb = await prisma.job.count({
      where: { externalId: { startsWith: MARQUEUR }, city: 'Bedford', countryCode: 'GB' },
    });
    expect(enGb).toBe(1);
    // Aucun marché ne doit servir Bedford à un marché étranger aux deux pays.
    expect(await suggestCities('Bedford', 'FR')).not.toContain('Bedford');
  });

  it('ville SANS OCCURRENCE ailleurs — abstention, jamais de pays inventé', async () => {
    // 565 villes en production. On ne devine pas : elles restent hors marché.
    expect(await suggestCities('Panzurville', 'FR')).not.toContain('Panzurville');
    expect(await suggestCities('Panzurville', 'US')).not.toContain('Panzurville');
  });

  /**
   * ── LA DÉGRADATION SÛRE, l'invariant que rien ne doit casser ──────────
   *
   * Sans marché, et avec un marché inconnu du registre, le comportement est
   * celui d'AVANT le lot : le monde entier. Se tromper en masquant une ville
   * retire au candidat un résultat qui existait, sans message et sans recours.
   */
  it('SANS marché — comportement inchangé, le monde entier', async () => {
    const villes = await suggestCities('Pa');
    expect(villes).toContain('Paris');
    expect(villes).toContain('Pantin');
    // Les orphelines aussi : sans marché, rien n'est retiré.
    expect(await suggestCities('Panzurville')).toContain('Panzurville');
  });

  it('marché INCONNU du registre — aucune restriction, pas d’exception', async () => {
    // Comportement actuel à remplacer avec le contrat strict du lot recherche.
    for (const inconnu of ['ZZ', 'zzzzz', '<script>', '']) {
      expect(estCodeMarche(inconnu), 'la fixture doit rester inconnue du registre').toBe(false);
      const villes = await suggestCities('Pa', inconnu);
      expect(villes, `marché « ${inconnu} »`).toContain('Paris');
      expect(villes, `marché « ${inconnu} »`).toContain('Pantin');
    }
  });

  it.each([['CN', 'Panjin'], ['BE', 'Paal']] as const)(
    '%s — les suggestions locales sont présentes et les villes étrangères exclues',
    async (code, ville) => {
      expect(estCodeMarche(code), 'le marché doit être enregistré').toBe(true);
      const monde = await suggestCities('Pa');
      expect(monde).toContain('Paris');
      expect(monde).toContain(ville);
      expect(await suggestCities('Pa', code)).toEqual([ville]);
      expect(await suggestCities('Pa', 'FR')).not.toContain(ville);
    },
  );

  it('la frappe ne peut pas devenir un joker LIKE', async () => {
    /*
     * Sans échappement, « % » rend les huit plus grosses villes du catalogue
     * au lieu de rien : le panneau affiche des villes sans rapport avec la
     * frappe. Ce n'est pas une injection — la valeur reste un paramètre lié —
     * mais c'est un résultat faux, et il est visible par le candidat.
     */
    expect(await suggestCities('%%', 'FR')).toEqual([]);
    expect(await suggestCities('P%', 'FR')).toEqual([]);
    expect(await suggestCities('_a', 'FR')).toEqual([]);
  });
});

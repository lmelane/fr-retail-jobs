import { unstable_cache } from 'next/cache';
import { publicJobSql } from '@catwalks/db/availability';
import { CODES_MARCHE, CONTRAT_RECHERCHE_VERSION, MARCHES, filtresDuMarche, type FiltreMarche } from '@catwalks/db/marches';
import { prisma, Prisma } from '@catwalks/db';
import { DatabaseUnavailableError, perimetreServi, type PerimetreServi } from './jobs';
import { directPubliableSql } from './direct-offers';
import { PAYS_CONNUS } from './lieu';
import { resoudrePerimetre } from './perimetre';

/**
 * LE CONTRAT DES MARCHÉS, SERVI AU SITE (lot 6).
 *
 * Le site ne porte plus aucune liste de marchés, de périmètres, de facettes ni
 * de libellés : il lit celle-ci. La partie « registre » est statique et suit
 * `CONTRAT_RECHERCHE_VERSION` ; la partie « catalogue » compte les offres
 * publiables par périmètre et par pays hors marché, lue en direct et jamais
 * gravée (D-429 : la promesse du produit est un chiffre réel), mémorisée deux
 * minutes parce qu'elle sert chaque rendu du sélecteur.
 */
/*
 * Les facettes du marché portent leur TYPE D'INTERACTION : le site rend ce que le registre décide,
 * il ne refait aucune règle de seuil ni de cardinalité. Deux registres qui décident la même chose
 * finissent par diverger — c'est ce qui a rendu 6 212 offres inaccessibles le 15/09/2026.
 */
export type MarcheServi = PerimetreServi & { facettes: readonly FiltreMarche[]; offresPubliables: number };

export type ContratMarches = {
  version: number;
  marches: MarcheServi[];
  catalogue: {
    /** Toutes les offres publiables, monde entier — le compteur de la page d'accueil. */
    offresPubliables: number;
    /** Les pays servis sans marché mesuré et leurs offres publiables : le stock hors marchés reste atteignable. */
    autresPays: { code: string; offresPubliables: number }[];
    /** Offres publiables sans pays : servies par leur identifiant seulement, jamais injectées dans un marché. */
    sansPays: number;
    mesureA: string;
  };
};

/** Les deux origines comptent : une offre directe publiable vaut une offre agrégée publiable. */
async function compterParPays(): Promise<{ parPays: Map<string, number>; sansPays: number }> {
  const asOf = new Date();
  const rows = await prisma.$queryRaw<{ pays: string | null; n: number }[]>(Prisma.sql`
    SELECT pays, sum(n)::int AS n FROM (
      SELECT j."countryCode" AS pays, count(*) AS n FROM "Job" j WHERE ${publicJobSql(Prisma.sql`j`, asOf)} GROUP BY 1
      UNION ALL
      SELECT d."countryCode", count(*) FROM "DirectOffer" d WHERE ${directPubliableSql(Prisma.sql`d`, asOf)} GROUP BY 1
    ) t GROUP BY pays`);
  const parPays = new Map<string, number>();
  let sansPays = 0;
  for (const row of rows) {
    if (row.pays) parPays.set(row.pays, row.n);
    else sansPays += row.n;
  }
  return { parPays, sansPays };
}

async function contratMarches(): Promise<ContratMarches> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  let comptes: Awaited<ReturnType<typeof compterParPays>>;
  try {
    comptes = await compterParPays();
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
  const couverts = new Set<string>();
  const marches = CODES_MARCHE.map((code) => {
    const perimetre = resoudrePerimetre(code)!;
    for (const p of MARCHES[code].pays) couverts.add(p);
    return {
      ...perimetreServi(perimetre),
      facettes: filtresDuMarche(perimetre),
      offresPubliables: MARCHES[code].pays.reduce((n, p) => n + (comptes.parPays.get(p) ?? 0), 0),
    };
  });
  const autresPays = [...comptes.parPays.entries()]
    .filter(([code, n]) => !couverts.has(code) && PAYS_CONNUS.has(code) && n > 0)
    .map(([code, offresPubliables]) => ({ code, offresPubliables }))
    .sort((a, b) => b.offresPubliables - a.offresPubliables || a.code.localeCompare(b.code));
  return {
    version: CONTRAT_RECHERCHE_VERSION,
    marches,
    catalogue: {
      offresPubliables: [...comptes.parPays.values()].reduce((a, b) => a + b, 0) + comptes.sansPays,
      autresPays,
      sansPays: comptes.sansPays,
      mesureA: new Date().toISOString(),
    },
  };
}

/** Deux minutes : le sélecteur est sur chaque page du moteur, le catalogue bouge à l'heure. */
export const contratMarchesCached = unstable_cache(contratMarches, ['contrat-marches', String(CONTRAT_RECHERCHE_VERSION)], { revalidate: 120 });

export { contratMarches };

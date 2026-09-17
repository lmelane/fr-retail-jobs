/**
 * LA COLLISION CANADA / CALIFORNIE — combien d'offres `CA` sont américaines ?
 *
 * Lecture seule. D-435 a corrigé le défaut À L'INGESTION : un `CA` venant d'un
 * champ d'ÉTAT américain n'est plus pris pour le Canada. Mais un correctif
 * d'ingestion ne réécrit pas le stock : les offres déjà en base gardent leur
 * valeur fausse jusqu'à leur ré-attestation.
 *
 * Ce script mesure ce qui RESTE, parce que le registre des marchés s'apprête à
 * ouvrir `CA` côté site : si une part des 3 129 offres canadiennes est en
 * réalité californienne, le candidat qui choisit « Canada » reçoit des offres
 * de Los Angeles. On ne peut pas décider sans le chiffre.
 *
 * La sonde est la VILLE, pas la région : c'est la colonne la plus densément
 * remplie, et une ville californienne majeure sous `countryCode = 'CA'` est un
 * faux positif qui ne s'explique pas autrement (il n'existe pas de San
 * Francisco canadien de taille comparable).
 */
import { PrismaClient } from '@prisma/client';

/*
 * Villes CALIFORNIENNES sans homonyme canadien plausible. On ne teste PAS
 * « London » ou « Windsor » (réellement canadiennes), ni « Victoria » (C.-B.).
 * Une sonde qui produit des faux positifs surestimerait la contamination et
 * ferait rejeter un marché sain.
 */
const VILLES_CA_US = [
  'Los Angeles', 'San Francisco', 'San Diego', 'Sacramento', 'San Jose',
  'Beverly Hills', 'Santa Monica', 'Palo Alto', 'Costa Mesa', 'Glendale',
  'Pasadena', 'Long Beach', 'Anaheim', 'Irvine', 'Oakland', 'Fresno',
  'Santa Clara', 'Berkeley', 'Malibu', 'Palm Springs', 'Napa', 'Burbank',
];

const p = new PrismaClient();
try {
  const [tot] = await p.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM "Job" WHERE "isActive" AND "countryCode" = 'CA'`;
  const total = Number(tot.n);

  const suspectes = await p.$queryRaw<Array<{ city: string; n: bigint }>>`
    SELECT "city", count(*) AS n
      FROM "Job"
     WHERE "isActive" AND "countryCode" = 'CA' AND "city" = ANY(${VILLES_CA_US})
     GROUP BY "city"
     ORDER BY count(*) DESC`;

  const contaminees = suspectes.reduce((s, r) => s + Number(r.n), 0);

  /* Contre-épreuve : ces mêmes villes sous 'US' prouvent que la sonde marche. */
  const [temoinUs] = await p.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM "Job"
     WHERE "isActive" AND "countryCode" = 'US' AND "city" = ANY(${VILLES_CA_US})`;

  /* Le CANADA réel, pour montrer que le marché n'est pas qu'une illusion. */
  const villesCanada = await p.$queryRaw<Array<{ city: string; n: bigint }>>`
    SELECT "city", count(*) AS n FROM "Job"
     WHERE "isActive" AND "countryCode" = 'CA' AND "city" IS NOT NULL
     GROUP BY "city" ORDER BY count(*) DESC LIMIT 12`;

  console.log(JSON.stringify({
    totalCA: total,
    contaminees,
    partContaminee: contaminees / total,
    detailSuspectes: suspectes.map((r) => ({ city: r.city, n: Number(r.n) })),
    temoinMemesVillesSousUS: Number(temoinUs.n),
    topVillesCA: villesCanada.map((r) => ({ city: r.city, n: Number(r.n) })),
  }, null, 1));
} finally {
  await p.$disconnect();
}

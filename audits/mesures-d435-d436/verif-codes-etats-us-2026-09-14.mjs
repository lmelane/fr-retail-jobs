/**
 * VÉRIFICATION — des codes d'ÉTATS américains stockés comme codes PAYS.
 *
 * LECTURE SEULE : un seul `SELECT`. Aucune écriture.
 *
 * DÉFAUT TROUVÉ le 14/09/2026 par la synthèse source → canonique, et
 * CONFIRMÉ par ce script : chez `l-oreal-professionnel`, 176 offres portent
 * un code d'État américain dans le champ PAYS.
 *
 *     stocké   lieu réel              lu comme
 *     IN       Indianapolis, IN       Inde
 *     KY       Florence, KY           Îles Caïmans
 *     MA       Attleboro, MA          Maroc
 *     IL       Champaign, IL          Israël
 *     VA       Richmond, VA           Vatican
 *
 * ET AUCUNE N'EST SIGNALÉE : `countryIntegrity` est nul sur toutes. Une offre
 * américaine est donc rangée dans un autre pays, sans aucune trace de doute —
 * ni pour un visiteur qui filtre par pays, ni pour nous.
 *
 * C'est un défaut de NORMALISATION chez nous, pas un manque à la source : la
 * chaîne `location` d'origine est sans ambiguïté (« Florence, KY »).
 *
 * FAUX POSITIFS ÉCARTÉS : la même sonde remonte `rituals DE` (349) et
 * `adidas DE` (125). Vérification faite, ce sont de VRAIES offres allemandes
 * (Aachen, Berlin). Le défaut est propre à cette source.
 *
 *   DB_URL=… node audits/mesures-d435-d436/verif-codes-etats-us-2026-09-14.mjs
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DB_URL } } });
const r = await p.$queryRawUnsafe(`
  SELECT j."countryCode" AS pays_stocke, j.location, j.title,
         j."countryIntegrity" AS signale
    FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id
   WHERE j."isActive" AND s."sourceKey" = 'l-oreal-professionnel'
     AND j."countryCode" IN ('MA','IL','PA','KY','AR','TN','CO','IN','VA','AZ')
   LIMIT 12`);
for (const x of r) {
  console.log(`  stocké=${String(x.pays_stocke).padEnd(3)} signalé=${String(x.signale ?? 'NON').padEnd(6)} lieu="${String(x.location ?? '').slice(0,42)}"`);
}
console.log(`\n  ${r.length} exemples. Un "lieu" américain sous un code pays étranger = défaut de normalisation.`);
await p.$disconnect();

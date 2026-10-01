/**
 * D-500 (Q5) — LES OFFRES QUE LE TEXTE TROUVE ET QUE LE MÉTIER NE RETIENT PAS, en lecture seule sur la production.
 *
 * Pour une requête que la taxonomie comprend (« conseillère de vente ») et son métier : les offres publiables du marché
 * que retient la recherche par le texte et que `metier=` ne retient pas (ni le code, ni un métier lu dans l'intitulé),
 * avec leur intitulé natif, leur code, leurs métiers lus, et OÙ le texte les a trouvées (l'intitulé, poids A ; ou les
 * missions, poids C). Sortie : `resultats/q5-hors-metier-<metier>-<marche>.json` (toutes les offres) et `.txt`.
 * Client de mesure : `client-mesure.mts` (psql en lecture seule, aucun Prisma vers la production).
 *
 *   CATWALKS_DB_ACCESS=<accès> npx tsx audits/2026-10-01/d500-requete/q5-hors-metier.mts ["conseillère de vente"] [sales-advisor] [FR]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { executer, texte } from './client-mesure.mts';

const [q = 'conseillère de vente', metier = 'sales-advisor', code = 'FR'] = process.argv.slice(2);
const { MARCHES } = await import('@catwalks/db/marches');
const { publicJobSql } = await import('@catwalks/db/availability');
const { getSearchContext, SEARCH_VERSION } = await import('../../../apps/api/lib/search-index');
const { searchSql } = await import('../../../apps/api/lib/search-sql');
const marche = MARCHES[code as keyof typeof MARCHES];
const { model } = await getSearchContext();
const intention = model.intention(q, marche);
const { condition } = searchSql(intention, { metiersSansIndex: true });
const role = intention.clauses.find((c) => c.kind === 'role');
if (!role || role.keys[0] !== metier) throw new Error(`« ${q} » ne se lit pas comme le métier ${metier}`);
const titreSeul = role.phrases.map((p) => '(' + p.split(' ').map((w) => `'${w}':A`).join(' <-> ') + ')').join(' | ');
const pays = Prisma.join(marche.pays.map((p) => Prisma.sql`${p}`));
const asOf = new Date();
const sql = Prisma.sql`SELECT j.id, j.title, j."rawTitle", j."occupationCode", j."occupationStatus", j."titleRoles", j."jobFunction",
    s.vector @@ to_tsquery('simple', ${titreSeul}) AS "dansIntitule"
  FROM "Job" j JOIN "SearchDocument" s ON s.id = j.id AND s.version = ${SEARCH_VERSION} AND s.country IN (${pays})
  WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}) AND ${condition}
    AND NOT (j."occupationCode" IS NOT DISTINCT FROM ${metier} OR j."titleRoles" @> ARRAY[${metier}]::text[])
  ORDER BY j.id`;
const lignes = executer(texte(sql)).lignes as { id: string; title: string; rawTitle: string | null; occupationCode: string | null;
  occupationStatus: string; titleRoles: string[]; jobFunction: string | null; dansIntitule: boolean }[];
const sortie = join(new URL('.', import.meta.url).pathname, 'resultats', `q5-hors-metier-${metier}-${code}`);
writeFileSync(`${sortie}.json`, JSON.stringify({ q, metier, marche: code, mesureA: asOf.toISOString(), lignes }, null, 1));
const parIntitule = lignes.filter((l) => l.dansIntitule).length;
const lecture = [`# Q5 — « ${q} » ${code}, offres trouvées par le texte hors de metier=${metier} — ${asOf.toISOString()}`,
  `${lignes.length} offres ; trouvées par l'intitulé : ${parIntitule} ; par les missions seules : ${lignes.length - parIntitule}`,
  ...lignes.map((l) => `${l.dansIntitule ? 'INTITULÉ' : 'MISSIONS'} | ${l.title} | code ${l.occupationCode ?? '-'} (${l.occupationStatus}) | lus ${l.titleRoles.join('+') || '-'} | famille ${l.jobFunction ?? '-'}`)];
writeFileSync(`${sortie}.txt`, lecture.join('\n') + '\n');
console.log(lecture.slice(0, 3).join('\n'));
process.exit(0);

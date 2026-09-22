/**
 * CARTOGRAPHIE FINALE DES MARCHÉS — les 41, sur CORPUS_ANALYTIQUE_V1_POST_GEO (40 091).
 *
 * À distinguer de `CATALOGUE_CONSOLIDE_V1` (40 068), la baseline figée avant le lot géographique :
 * les +23 viennent des collectes live de ce lot, et une baseline freeze ne change pas de valeur.
 *
 * Le mapping vient du registre (`MARCHES[*].pays`), jamais d'une égalité `marketCode =
 * countryCode` : `GB` sert aussi l'Irlande, `DE` sert aussi l'Autriche.
 *
 * DEUX COLONNES QU'ON NE MÉLANGE JAMAIS :
 *   · les LOCALES PRODUIT — l'interface proposée au candidat, décidée par le registre ;
 *   · les LANGUES DES ANNONCES — ce que les sources ont réellement publié.
 * Un marché peut servir des annonces anglaises sous une interface néerlandaise.
 *
 * Et on ne confond pas REMPLI et PROUVÉ : `countryIntegrity` porte un verdict, seuls
 * `RAW_COUNTRY_CODE`, `RAW_COUNTRY` et `VERIFIED` prouvent le pays.
 */
import { PrismaClient } from '@prisma/client';
import { CODES_MARCHE_LOCALISES, MARCHES, MARCHES_ROUTABLES } from '../../../../../packages/db/marches.js';

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('DATABASE_URL requise.'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const lignes = await prisma.$queryRawUnsafe<Array<{
  pays: string | null; offres: bigint; prouvees: bigint; langues: string | null; sources: string | null;
}>>(`
  WITH publiables AS (
    SELECT j.id, j."countryCode", j."countryIntegrity", j.language FROM "Job" j
     WHERE j."isActive" AND j."mergedIntoId" IS NULL
       AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive"
                     AND (js."expiresAt" IS NULL OR js."expiresAt" > now())))
  SELECT p."countryCode" AS pays, count(*) AS offres,
         count(*) FILTER (WHERE p."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')) AS prouvees,
         string_agg(DISTINCT p.language, ',' ORDER BY p.language) AS langues,
         /* MEME PERIMETRE QUE LES OFFRES : isActive seul laisserait entrer un rattachement actif
          * mais EXPIRE, qui ne contribue a aucune offre publiable. Le compteur de sources dirait
          * alors une source de plus sur un marche que cette source ne sert plus. */
         (SELECT string_agg(DISTINCT js."sourceKey", ',') FROM "JobSource" js
           WHERE js."jobId" IN (SELECT id FROM publiables q WHERE q."countryCode" IS NOT DISTINCT FROM p."countryCode")
             AND js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > now())) AS sources
    FROM publiables p GROUP BY 1`);
await prisma.$disconnect();

const parPays = new Map(lignes.map(l => [l.pays ?? '(aucun)', l]));
const total = lignes.reduce((n, l) => n + Number(l.offres), 0);
const n = (v: bigint | undefined) => Number(v ?? 0);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const localises = new Set<string>(CODES_MARCHE_LOCALISES);

type Ligne = { code: string; membres: readonly string[]; offres: number; prouve: number; sansPreuve: number; sources: number; langues: string[] };
const marches: Ligne[] = [];
/* Les 12 marchés LOCALISÉS vivent dans `MARCHES`, les routables dans `MARCHES_ROUTABLES` : une
 * première version ne parcourait que la seconde et rendait les 12 à zéro offre. */
const codes = [...new Set<string>([...CODES_MARCHE_LOCALISES, ...MARCHES_ROUTABLES.map(r => r.code as string)])];
for (const code of codes) {
  const m = { code };
  const membres = MARCHES[m.code as keyof typeof MARCHES]?.pays ?? [m.code];
  const offres = membres.reduce((s: number, p: string) => s + n(parPays.get(p)?.offres), 0);
  const prouve = membres.reduce((s: number, p: string) => s + n(parPays.get(p)?.prouvees), 0);
  const sources = new Set(membres.flatMap((p: string) => (parPays.get(p)?.sources ?? '').split(',').filter(Boolean)));
  const langues = [...new Set(membres.flatMap((p: string) => (parPays.get(p)?.langues ?? '').split(',').filter(Boolean)))].sort();
  marches.push({ code: m.code, membres, offres, prouve, sansPreuve: offres - prouve, sources: sources.size, langues });
}
marches.sort((a, b) => b.offres - a.offres);

console.log(`# Cartographie finale des marchés — ${total} offres publiables uniques\n`);
console.log(`| Marché | Pays membres | Locales produit | Offres | Prouvé | % | Sans preuve | Sources | Langues annonces |`);
console.log(`|---|---|---|---:|---:|---:|---:|---:|---|`);
for (const m of marches) {
  const loc = localises.has(m.code) ? (MARCHES[m.code as keyof typeof MARCHES]?.locales ?? []).join(' ') : `*(${MARCHES_ROUTABLES.find(r => r.code === m.code)?.localeNative ?? '—'})*`;
  console.log(`| ${localises.has(m.code) ? `**${m.code}**` : m.code} | ${m.membres.join('+')} | ${loc} | ${m.offres} | ${m.prouve} | ${pct(m.prouve, m.offres)} | ${m.sansPreuve} | ${m.sources} | ${m.langues.join(',') || '—'} |`);
}

const volumeLocalise = marches.filter(m => localises.has(m.code)).reduce((s, m) => s + m.offres, 0);
const volumeRoutable = marches.filter(m => !localises.has(m.code)).reduce((s, m) => s + m.offres, 0);
console.log(`\n## Synthèse\n`);
console.log(`| Population | Marchés | Offres | % |`);
console.log(`|---|---:|---:|---:|`);
console.log(`| marchés LOCALISÉS (interface traduite) | ${localises.size} | ${volumeLocalise} | ${pct(volumeLocalise, total)} |`);
console.log(`| marchés ROUTABLES (interface en repli) | ${marches.length - localises.size} | ${volumeRoutable} | ${pct(volumeRoutable, total)} |`);

const connus = new Set<string>(codes.flatMap(c => (MARCHES[c as keyof typeof MARCHES]?.pays ?? [c]) as string[]));
const hors = lignes.filter(l => l.pays && !connus.has(l.pays)).sort((a, b) => n(b.offres) - n(a.offres));
const volumeHors = hors.reduce((s, l) => s + n(l.offres), 0);
const sansPays = n(parPays.get('(aucun)')?.offres);
console.log(`| pays HORS REGISTRE | ${hors.length} pays | ${volumeHors} | ${pct(volumeHors, total)} |`);
console.log(`| UNKNOWN (aucun marché attribuable) | — | ${sansPays} | ${pct(sansPays, total)} |`);
console.log(`| **TOTAL** | | **${volumeLocalise + volumeRoutable + volumeHors + sansPays}** | |`);

console.log(`\n## Pays hors registre\n`);
console.log(`| Pays | Offres | % prouvé |`);
console.log(`|---|---:|---:|`);
for (const l of hors) console.log(`| ${l.pays} | ${n(l.offres)} | ${pct(n(l.prouvees), n(l.offres))} |`);

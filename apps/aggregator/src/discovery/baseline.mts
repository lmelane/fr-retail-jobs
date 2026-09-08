import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
/**
 * Les cinq indicateurs AVANT que les correctifs du 2026-09-05 n'aient tourné
 * en prod. C'est la base de comparaison : sans elle, « c'est mieux » n'est
 * qu'une impression. Rejoué à l'identique après le premier ingest complet.
 */
const p = new PrismaClient();
const q = <T,>(s: string) => p.$queryRawUnsafe<T[]>(s);
const [row] = await q<any>(`
  SELECT
    count(*)::int AS actives,
    count(DISTINCT "countryCode")::int AS pays_distincts,
    count(*) FILTER (WHERE "countryCode" IN ('FR','France','fr','FRANCE'))::int AS france_toutes_formes,
    count(*) FILTER (WHERE "countryCode" = 'FR')::int AS france_iso,
    count(*) FILTER (WHERE city IS NULL)::int AS sans_ville,
    count(*) FILTER (WHERE city IS NULL AND location IS NOT NULL)::int AS ville_recuperable,
    count(*) FILTER (WHERE title IN ('Apply Now','Apply now','Postuler'))::int AS titre_bouton,
    count(*) FILTER (WHERE length(description) > 400 AND position(chr(10) in description) = 0)::int AS pave_sans_saut,
    count(*) FILTER (WHERE description LIKE '%<%')::int AS desc_avec_html
  FROM "Job" WHERE "isActive"`);
const [sect] = await q<any>(`SELECT count(j.id)::int AS other FROM "Job" j JOIN "Company" c ON c.id=j."companyId" WHERE j."isActive" AND c.sector='OTHER'`);
const [logo] = await q<any>(`SELECT count(*)::int AS noms_logo FROM "Company" WHERE name ~* '\\mlogo\\M'`);
const [src] = await q<any>(`SELECT count(*)::int AS sources FROM "Source" WHERE status='ACTIVE'`);
const base = { mesure: new Date().toISOString(), ...row, secteur_other: sect.other, ...logo, ...src };
console.log(JSON.stringify(base, null, 2));
// Chemin de sortie en argument : sans lui, la mesure du 06:26 (l'AVANT) a été écrasée par l'APRÈS.
writeFileSync(process.argv[2] ?? 'data/baseline.json', JSON.stringify(base, null, 2));
await p.$disconnect();

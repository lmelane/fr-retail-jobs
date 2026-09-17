/**
 * LE RAW PUBLIE-T-IL CE QUE NOS COLONNES N'ONT PAS ?
 *
 * Question du CEO le 15/09/2026 : « Tu es sûr ou pas ? Tu as check la source,
 * le RAW de base, l'extraction ? »
 *
 * Elle est fondée : j'ai mesuré nos COLONNES (salaire 0-8 %, études 0 %,
 * télétravail 2-21 %, géoloc 0-46 %) et conclu sur LES MARCHÉS. C'est le même
 * raisonnement qui m'a fait dire à tort que les US ne déclaraient pas
 * l'expérience — alors que 12 210 offres la portaient dans `raw`, jamais lues.
 *
 * Ce script ÉNUMÈRE les clés de `raw` sans liste préalable, puis filtre sur la
 * sémantique des 4 dimensions écartées. Aucune clé n'est devinée.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MOTIFS = {
  salaire: 'salar|pay|wage|compensation|remuneration|gehalt|stipendio|sueldo|salaire|honorai',
  etudes: 'educat|degree|diploma|qualification|studi|formation|abschluss|titulaci|scolarit',
  teletravail: 'remote|telework|hybrid|onsite|on_site|workplace|homeoffice|teletrav|smart.?work',
  geo: 'latitude|longitude|geo|coordinat|lat$|lng|postal|zip',
};

for (const [dim, motif] of Object.entries(MOTIFS)) {
  const r = await prisma.$queryRawUnsafe(`
    SELECT cle, count(*)::int AS n,
           count(DISTINCT j."countryCode")::int AS marches
    FROM "Job" j, LATERAL jsonb_object_keys(j.raw) AS cle
    WHERE j."isActive" = true AND j.raw IS NOT NULL
      AND cle ~* '${motif}'
    GROUP BY cle HAVING count(*) >= 200
    ORDER BY n DESC LIMIT 8
  `);
  console.log(`\n=== ${dim.toUpperCase()} — clés de raw (>= 200 offres) ===`);
  if (!r.length) { console.log('  AUCUNE — la source ne publie rien'); continue; }
  for (const x of r) console.log(`  ${String(x.n).padStart(6)} offres | ${x.marches} marchés | ${x.cle}`);
}
await prisma.$disconnect();

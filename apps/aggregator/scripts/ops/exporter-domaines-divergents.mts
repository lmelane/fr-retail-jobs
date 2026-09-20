/**
 * EXPORTER LES DOMAINES DIVERGENTS À TRANCHER — lecture seule, écrit un CSV.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/exporter-domaines-divergents.mts
 *
 * ── CE QUE C'EST ───────────────────────────────────────────────────────────────────────────────
 *
 * La campagne rend `DOMAINE_OFFICIEL_DIVERGENT` quand le portail d'une Maison est servi sous un
 * autre domaine que celui inscrit au registre. Elle a raison de ne pas trancher seule : accepter
 * n'importe quel domaine servi reviendrait à publier les offres d'une Maison sous le nom d'une
 * autre.
 *
 * Mesuré le 19/09/2026 : 8 cas, 4 631 offres bloquées, dont Foot Locker à lui seul 3 003.
 *
 * Le fichier produit reprend le format de la relecture du 19/09 (que le CEO a déjà traitée sur
 * 19 cas) : une colonne `decision` à remplir, avec trois valeurs possibles.
 *
 *   ACCEPTER   le domaine servi appartient bien à la Maison → il devient un domaine officiel
 *   REGISTRE   le domaine du registre reste seul valide     → rien n'est écrit
 *   RETIRER    le portail est celui d'une AUTRE entreprise  → la source passe en RETIRED
 *
 * Une case vide laisse la source intacte. `appliquer-domaines-divergents.mts` lit ce fichier.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const VERDICTS = 'backups/verdicts-campagne.json';
if (!existsSync(VERDICTS)) {
  console.error(`\n⚠ ${VERDICTS} absent — lancer d'abord :`);
  console.error('   python3 apps/aggregator/scripts/ops/recuperer-tous-verdicts.py 40\n');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });

type Verdict = { verdict: string; offres: string; raison: string; quand: string };
const verdicts = JSON.parse(readFileSync(VERDICTS, 'utf8')) as Record<string, Verdict>;

/* Le domaine servi est dans la raison, entre parenthèses : « (servi.com, registre : autre.fr) ». */
const DOMAINES = /\(([^,)]+),\s*registre\s*:\s*([^)]+)\)/;

const cas = Object.entries(verdicts)
  .filter(([, v]) => v.verdict === 'DOMAINE_OFFICIEL_DIVERGENT')
  .map(([cle, v]) => {
    const m = DOMAINES.exec(v.raison);
    return {
      cle,
      offres: Number(v.offres) || 0,
      servi: m?.[1]?.trim() ?? '',
      registre: m?.[2]?.trim() ?? '',
      raison: v.raison,
    };
  })
  .sort((a, b) => b.offres - a.offres);

const infos = await prisma.$queryRawUnsafe<Array<{ key: string; maison: string; kind: string; careersDomain: string | null }>>(
  `SELECT key, maison, kind, "careersDomain" FROM "Source" WHERE key = ANY($1::text[])`,
  cas.map((c) => c.cle));
const parCle = new Map(infos.map((i) => [i.key, i]));

const lignes = cas.map((c) => {
  const i = parCle.get(c.cle);
  return [
    c.cle,
    i?.maison ?? '',
    i?.kind ?? '',
    String(c.offres),
    c.servi,
    c.registre || (i?.careersDomain ?? ''),
    '', // decision, à remplir
    c.servi ? '' : c.raison.slice(0, 120), // note quand le domaine n'a pas pu être extrait
  ].map((x) => String(x).replace(/[;\n\r]/g, ' ')).join(';');
});

const chemin = 'catwalks-domaines-divergents.csv';
writeFileSync(chemin,
  'cle;maison;famille;offres_bloquees;domaine_servi;domaine_registre;decision;note\n' + lignes.join('\n') + '\n',
  'utf8');

const total = cas.reduce((n, c) => n + c.offres, 0);
console.log(`\n   ${cas.length} domaine(s) divergent(s) · ${total} offre(s) bloquée(s)\n`);
for (const c of cas)
  console.log(`   ${String(c.offres).padStart(5)}  ${c.cle.padEnd(24)} ${(c.servi || '—').padEnd(26)} registre : ${c.registre || '—'}`);
console.log(`\n   → ${chemin}\n`);

await prisma.$disconnect();

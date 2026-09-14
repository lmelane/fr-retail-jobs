/**
 * MESURE — ce que la politique des inconnus change dans la RECHERCHE RÉELLE.
 *
 * LECTURE SEULE : deux `count()`. Aucune écriture.
 *
 * ── POURQUOI CE SCRIPT APPELLE `whereClause` ──────────────────────────────
 *
 * Le CEO, le 14/09/2026 : « les 3 131 correspondent à ta mesure SQL actuelle ;
 * le gain utilisateur final doit être mesuré dans ce parcours ».
 *
 * Une mesure écrite à la main en SQL décrit ce que SON AUTEUR croit que
 * l'application fait. Ce script appelle donc la VRAIE fonction de construction
 * de requête, `whereClause`, celle que la page et l'API partagent — la même
 * qui alimente les résultats, les compteurs et la pagination.
 *
 *   DB_URL=… npx tsx scripts/mesure-inconnus-recherche-2026-09-14.mts
 */
import { PrismaClient } from '@prisma/client';
import { whereClause, type JobFilters } from '../apps/api/lib/jobs.js';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const fr = (n: number) => n.toLocaleString('fr-FR');

/** Les recherches mesurées : un marché, une ou deux facettes. */
const RECHERCHES: ReadonlyArray<{ nom: string; filtres: JobFilters }> = [
  { nom: 'France · CDI + temps partiel', filtres: { countries: ['FR'], employmentTerms: ['PERMANENT'], workTimes: ['PART_TIME'] } },
  { nom: 'France · CDI', filtres: { countries: ['FR'], employmentTerms: ['PERMANENT'] } },
  { nom: 'États-Unis · temps partiel', filtres: { countries: ['US'], workTimes: ['PART_TIME'] } },
  { nom: 'Allemagne · CDI', filtres: { countries: ['DE'], employmentTerms: ['PERMANENT'] } },
  { nom: 'Monde · stage', filtres: { programTypes: ['INTERNSHIP'] } },
];

console.log('\n  recherche'.padEnd(36) + 'avant'.padStart(9) + 'après'.padStart(10) + 'accessibles'.padStart(14));
console.log('  ' + '─'.repeat(66));

for (const { nom, filtres } of RECHERCHES) {
  const apres = await prisma.job.count({ where: whereClause(filtres) as never });

  /*
   * L'ANCIEN COMPORTEMENT, reconstitué à l'identique : `in` strict sur chaque
   * facette, ce que faisait `whereClause` avant ce correctif. C'est la seule
   * façon honnête de mesurer un écart — comparer deux états du MÊME parcours.
   */
  const avant = await prisma.job.count({
    where: {
      isActive: true,
      ...(filtres.countries?.length ? { countryCode: { in: filtres.countries } } : {}),
      ...(filtres.employmentTerms?.length ? { employmentTerm: { in: filtres.employmentTerms } } : {}),
      ...(filtres.workTimes?.length ? { workTime: { in: filtres.workTimes } } : {}),
      ...(filtres.programTypes?.length ? { programType: { in: filtres.programTypes } } : {}),
    },
  });

  console.log(
    '  ' + nom.padEnd(34) + fr(avant).padStart(9) + fr(apres).padStart(10) + ('+' + fr(apres - avant)).padStart(14),
  );
}

/*
 * TÉMOIN D'EXCLUSION — la contrepartie, sans laquelle le correctif serait un
 * simple élargissement. Une INCOMPATIBILITÉ CONNUE doit continuer d'exclure :
 * une offre explicitement à temps plein ne doit jamais remonter dans une
 * recherche « temps partiel ».
 */
console.log('\n  TÉMOIN D’EXCLUSION — l’incompatibilité connue exclut toujours');
console.log('  ' + '─'.repeat(66));
const wTempsPartiel = whereClause({ countries: ['FR'], workTimes: ['PART_TIME'] }) as never;
const tempsPleinRemonte = await prisma.job.count({
  where: { AND: [wTempsPartiel, { workTime: 'FULL_TIME' }] } as never,
});
console.log(`  offres « temps plein » remontées par « temps partiel » : ${fr(tempsPleinRemonte)}`);
console.log(tempsPleinRemonte === 0 ? '  ✓ aucune : les incompatibilités connues excluent bien.' : '  ✗ DÉFAUT : le filtre laisse passer une incompatibilité.');

/*
 * LA DISTINCTION QUE LE PRODUIT DOIT AFFICHER. Ces offres supplémentaires ne
 * sont pas « compatibles » : elles ne présentent aucune incompatibilité
 * connue, et leur correspondance reste NON CONFIRMÉE.
 */
console.log('\n  CE QUE CES OFFRES SONT, ET NE SONT PAS');
console.log('  ' + '─'.repeat(66));
const wFr = whereClause({ countries: ['FR'], employmentTerms: ['PERMANENT'], workTimes: ['PART_TIME'] }) as never;
const confirmees = await prisma.job.count({
  where: { AND: [wFr, { employmentTerm: { not: null } }, { workTime: { not: null } }] } as never,
});
const total = await prisma.job.count({ where: wFr });
console.log(`  correspondances CONFIRMÉES (les deux critères renseignés) : ${fr(confirmees)}`);
console.log(`  informations NON PRÉCISÉES (au moins un critère inconnu)  : ${fr(total - confirmees)}`);
console.log('\n  L’interface doit distinguer ces deux groupes : une inconnue');
console.log('  n’est jamais comptée comme une confirmation.\n');

await prisma.$disconnect();

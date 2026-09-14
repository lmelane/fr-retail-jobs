/**
 * VÉRIFICATION DE SENS — que signifie `contract_type` chez WTTJ et Hermès ?
 *
 * LECTURE SEULE : uniquement des `SELECT`. Aucune écriture.
 *
 * ── POURQUOI CE SCRIPT EXISTE ─────────────────────────────────────────────
 *
 * Le 14/09/2026, j'ai proposé d'implémenter `full_time → PERMANENT` sur la
 * foi de deux choses : un COMPTAGE (1 407 lignes portent cette valeur) et une
 * DOCUMENTATION HISTORIQUE de WelcomeKit associant le code `FULL_TIME` au
 * libellé français « CDI ».
 *
 * Le CEO a refusé : « un script de comptage mesure les occurrences ; il ne
 * démontre pas à lui seul le sens de full_time ». Il avait raison, et ce
 * script est ce qu'il fallait écrire AVANT de proposer quoi que ce soit.
 *
 * ── CE QU'IL A ÉTABLI, ET QUI A ANNULÉ LE LOT ─────────────────────────────
 *
 * 1. Le champ porte DÉJÀ du rythme : `part_time` existe comme valeur, et
 *    aucune valeur `permanent` n'existe. Il nomme quatre dimensions —
 *    rythme, durée, programme, statut juridique. C'est un fourre-tout
 *    « nature du poste », pas un champ de durée.
 *
 * 2. Le vrai champ de durée du flux est `has_contract_duration` +
 *    `contract_duration_minimum/maximum`, ORTHOGONAL à `contract_type`. Deux
 *    offres `full_time` portent une durée réelle — contradiction impossible
 *    si `full_time` signifiait « indéterminé ».
 *
 * 3. Par marché (mesuré par ce script) : la convention ne tient qu'en France,
 *    où 580 offres sur 856 disent CDI — mais 27 disent CDD. Hors de France
 *    elle s'effondre : GB 0 CDI et 2 titres à durée déterminée, IT 0 CDI et
 *    5 titres, ES 0 CDI et 5 titres, et zéro preuve d'aucune sorte en Asie.
 *
 * 4. Sur 433 offres qui changeraient, environ la moitié est hors de France,
 *    donc sur des marchés où la convention est réfutée ou non prouvée.
 *
 * ── LA LEÇON, À NE PAS PERDRE ─────────────────────────────────────────────
 *
 * Le verdict de confiance `SourceFieldTrust` juge ce couple sur 156
 * observations qui ne contiennent QUE `temporary` et `apprenticeship`, faute
 * de `full_time` produisant une durée. Injecter 1 112 observations ferait
 * basculer ce verdict, et le champ perdrait la main pour les valeurs
 * aujourd'hui fiables à 97 %. Le lot aurait été une RÉGRESSION.
 *
 *   DB_URL=… node scripts/verif-sens-contract-type-2026-09-14.mjs
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const SOURCES = `('wttj-sector', 'hermes')`;
const titre = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

/* ── 1. Le vocabulaire complet : quelles dimensions ce champ nomme-t-il ? ── */
titre('1. Vocabulaire de contract_type — offres DISTINCTES');

for (const l of await prisma.$queryRawUnsafe(`
  SELECT s.raw->>'contract_type' AS valeur, count(DISTINCT j.id)::int AS offres
    FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
   WHERE s."sourceKey" IN ${SOURCES} AND j."isActive"
     AND s.raw->>'contract_type' IS NOT NULL
   GROUP BY 1 ORDER BY 2 DESC`)) {
  console.log(`  ${String(l.valeur).padEnd(18)} ${String(l.offres).padStart(6)}`);
}
console.log(
  "\n  LECTURE : `part_time` existe → le champ porte du RYTHME.\n" +
    '  Aucune valeur `permanent` n\'existe → il ne porte pas de durée canonique.\n' +
    '  Quatre dimensions nommées → fourre-tout « nature du poste ».',
);

/* ── 2. Le vrai champ de durée est-il ailleurs ? ─────────────────────────── */
titre('2. contract_type × has_contract_duration — le champ de durée natif');

for (const l of await prisma.$queryRawUnsafe(`
  SELECT s.raw->>'contract_type'          AS valeur,
         s.raw->>'has_contract_duration'  AS a_une_duree,
         count(DISTINCT j.id)::int        AS offres
    FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
   WHERE s."sourceKey" IN ${SOURCES} AND j."isActive"
     AND s.raw->>'contract_type' IS NOT NULL
   GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`)) {
  console.log(
    `  ${String(l.valeur).padEnd(18)} duree=${String(l.a_une_duree).padEnd(7)} ${String(l.offres).padStart(6)}`,
  );
}
console.log(
  '\n  LECTURE : si `full_time` signifiait « indéterminé », aucune offre\n' +
    '  `full_time` ne pourrait porter `has_contract_duration = true`.',
);

/* ── 3. La preuve par le TEXTE, marché par marché ────────────────────────── */
titre('3. Offres full_time — ce que dit leur propre texte, par marché');

for (const l of await prisma.$queryRawUnsafe(`
  SELECT j."countryCode"                                                   AS pays,
         count(DISTINCT j.id)::int                                         AS offres,
         count(DISTINCT j.id) FILTER (WHERE j.title ILIKE '%CDI%'
                                        OR j.description ILIKE '%CDI%')::int    AS dit_cdi,
         count(DISTINCT j.id) FILTER (WHERE j.title ILIKE '%CDD%'
                                        OR j.description ILIKE '%CDD%')::int    AS dit_cdd,
         count(DISTINCT j.id) FILTER (WHERE j.title ILIKE '%FTC%'
                                        OR j.title ILIKE '%temporal%'
                                        OR j.title ILIKE '%temporary%'
                                        OR j.title ILIKE '%chiamata%')::int     AS titre_duree_determinee
    FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
   WHERE s."sourceKey" IN ${SOURCES} AND j."isActive"
     AND s.raw->>'contract_type' = 'full_time'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 14`)) {
  console.log(
    `  ${String(l.pays ?? '(nul)').padEnd(6)} ${String(l.offres).padStart(5)} offres` +
      `  CDI=${String(l.dit_cdi).padStart(4)}  CDD=${String(l.dit_cdd).padStart(3)}` +
      `  titre à durée déterminée=${String(l.titre_duree_determinee).padStart(3)}`,
  );
}

/* ── 4. Les TROIS décomptes, jamais confondus ────────────────────────────── */
titre('4. Les trois décomptes — exigence CEO du 14/09');

const [d] = await prisma.$queryRawUnsafe(`
  SELECT count(*)::int                        AS lignes_source,
         count(DISTINCT j.id)::int            AS offres_distinctes,
         count(DISTINCT j.id) FILTER (WHERE j."employmentTerm" IS NULL)::int AS changeraient
    FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
   WHERE s."sourceKey" IN ${SOURCES} AND j."isActive"
     AND s.raw->>'contract_type' = 'full_time'`);

console.log(`  lignes JobSource observées : ${String(d.lignes_source).padStart(6)}`);
console.log(`  OFFRES DISTINCTES          : ${String(d.offres_distinctes).padStart(6)}`);
console.log(`  offres qui CHANGERAIENT    : ${String(d.changeraient).padStart(6)}`);
console.log(
  '\n  Ne JAMAIS confondre ces trois nombres. Une offre servie par deux\n' +
    "  sources compte deux fois en lignes, une seule fois en offres. C'est\n" +
    "  l'erreur que j'ai commise en annonçant « 562 offres françaises ».",
);

await prisma.$disconnect();

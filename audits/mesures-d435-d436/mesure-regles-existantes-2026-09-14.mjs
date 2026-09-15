/**
 * MESURE — l'impact RÉEL de deux règles existantes, avant de les toucher.
 *
 * LECTURE SEULE : uniquement des agrégats `SELECT`. Aucune écriture.
 *
 * Le CEO, 14/09/2026 : « mesurer l'impact réel des règles existantes avant
 * correction », et « sans présumer qu'elle a déjà mal classé tout le
 * catalogue ». Ce script produit les chiffres, il ne corrige rien.
 *
 * LES DEUX RÈGLES EXAMINÉES
 *
 * 1. `ZERO HOUR|ZERO HEURE → TEMPORARY` (`normalize/employment.ts:145`).
 *    L'absence d'heures garanties ne démontre ni une durée limitée ni de
 *    l'intérim. La règle existe ; combien d'offres classe-t-elle réellement ?
 *
 * 2. Le seuil `< 35 h → PART_TIME` (`normalize/employment.ts:187-188`).
 *    C'est la durée légale FRANÇAISE, appliquée au monde entier. Le
 *    département du Travail américain ne définit pas le temps plein. Combien
 *    d'offres hors France ont un rythme DÉDUIT d'un horaire, et non déclaré ?
 *
 * Distinction tenue partout, exigée par le CEO : on compte des OFFRES
 * DISTINCTES (`count(distinct ...)`), jamais des lignes `JobSource`. Deux
 * sources servant la même offre ne la comptent qu'une fois.
 *
 *   DB_URL=… node audits/mesures-d435-d436/mesure-regles-existantes-2026-09-14.mjs
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const titre = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

/* ── 1. Zéro heure : que classe la règle aujourd'hui ? ───────────────────── */
titre('1. « zero hours » / « heures non garanties » — offres DISTINCTES');

const zero = await prisma.$queryRawUnsafe(`
  SELECT j."employmentTerm"                      AS terme,
         j."workTime"                            AS rythme,
         j."countryCode"                         AS pays,
         count(DISTINCT j.id)::int               AS offres
    FROM "Job" j
    JOIN "JobSource" s ON s."jobId" = j.id
   WHERE j."isActive"
     AND (s.raw::text ILIKE '%zero hour%'
       OR s.raw::text ILIKE '%zero-hour%'
       OR s.raw::text ILIKE '%non-guaranteed hour%'
       OR s.raw::text ILIKE '%zero heure%')
   GROUP BY 1, 2, 3
   ORDER BY 4 DESC
   LIMIT 20`);

if (zero.length === 0) console.log('  aucune offre ne porte ces mots');
for (const l of zero) {
  console.log(
    `  ${String(l.pays ?? '(nul)').padEnd(6)} terme=${String(l.terme ?? 'NULL').padEnd(11)}` +
      ` rythme=${String(l.rythme ?? 'NULL').padEnd(11)} ${String(l.offres).padStart(5)} offres`,
  );
}

/* ── 2. Le seuil de 35 h, hors de France ─────────────────────────────────── */
titre('2. Rythme DÉDUIT d\'un horaire chiffré — par pays');

/*
 * `workTimeEvidence` n'est pas persisté dans `Job` : on ne peut donc PAS
 * distinguer en base un rythme déclaré d'un rythme déduit. On approche donc
 * la population concernée : offres dont une charge utile porte un horaire
 * chiffré, sans mot de rythme explicite. C'est une BORNE SUPÉRIEURE, pas le
 * compte exact — et c'est dit, plutôt que présenté comme une mesure.
 */
const horaires = await prisma.$queryRawUnsafe(`
  SELECT j."countryCode"            AS pays,
         j."workTime"               AS rythme,
         count(DISTINCT j.id)::int  AS offres
    FROM "Job" j
    JOIN "JobSource" s ON s."jobId" = j.id
   WHERE j."isActive"
     AND s.raw::text ~ '[^0-9]([0-9]|[12][0-9]|3[0-9])\\s?[hH][^a-zA-Z]'
     AND s.raw::text !~* '(full[ _-]?time|part[ _-]?time|temps[ -]plein|temps[ -]partiel|vollzeit|teilzeit)'
   GROUP BY 1, 2
   ORDER BY 3 DESC
   LIMIT 20`);

if (horaires.length === 0) console.log('  aucune offre dans ce cas');
for (const l of horaires) {
  console.log(
    `  ${String(l.pays ?? '(nul)').padEnd(6)} rythme=${String(l.rythme ?? 'NULL').padEnd(11)}` +
      ` ${String(l.offres).padStart(5)} offres`,
  );
}

console.log(
  '\n  BORNE SUPÉRIEURE, pas un compte exact : `workTimeEvidence` (EXPLICIT vs\n' +
    '  INFERRED) n\'est pas persisté dans `Job`. On ne peut donc pas isoler en\n' +
    '  base les rythmes réellement DÉDUITS. Le seul moyen exact serait un rejeu\n' +
    '  en lecture du normaliseur sur les charges utiles.\n',
);

await prisma.$disconnect();

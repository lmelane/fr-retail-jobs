/**
 * LE MARCHÉ NE PUBLIE PAS, OU C'EST NOUS QUI NE LISONS PAS ?
 *
 * LECTURE SEULE : uniquement des `SELECT`. Aucune écriture.
 *
 * ── LA QUESTION ───────────────────────────────────────────────────────────
 *
 * Le tableau des facettes par marché mesurait le CANONIQUE. Or « Contrat
 * 19,2 % aux États-Unis » peut signifier deux choses opposées :
 *
 *   A. le marché américain ne publie pas de durée de contrat — c'est natif,
 *      et la facette doit disparaître sur ce marché ;
 *   B. nos connecteurs américains lisent mal ce que la source envoie — et
 *      alors nous graverions NOTRE défaut dans l'architecture du produit.
 *
 * Construire les facettes sans avoir tranché reviendrait à figer nos bugs.
 *
 * ── COMMENT ON TRANCHE ────────────────────────────────────────────────────
 *
 *     brut VIDE      + canonique vide  → le marché ne publie pas       (A)
 *     brut RENSEIGNÉ + canonique vide  → NOUS ne savons pas lire       (B)
 *
 * Le brut, ici, c'est la charge utile de la source (`JobSource.raw`), pas
 * `rawContract` — qui est déjà un tri opéré par nos adaptateurs.
 *
 *   DB_URL=… node scripts/brut-vs-canonique-2026-09-15.mjs
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const lire = (sql) => prisma.$queryRawUnsafe(sql);
const n = (v) => Number(v ?? 0);
const fr = (v) => n(v).toLocaleString('fr-FR');
const pc = (a, b) => (n(b) ? ((n(a) / n(b)) * 100).toFixed(1) : '0.0');

/**
 * Les clés de premier niveau où les sources déposent une DURÉE DE CONTRAT ou
 * un TEMPS DE TRAVAIL. Relevées dans les charges utiles réelles le 15/09/2026,
 * jamais devinées.
 *
 * Elles ne sont pas typées par dimension : `contract_type` contient aussi bien
 * `full_time` que `CDI`, et `employmentType` aussi bien `FULL_TIME` que
 * `permanent`. C'est précisément pourquoi on regarde la PRÉSENCE du champ, et
 * non sa valeur : la question est « la source a-t-elle parlé ? ».
 */
const CHAMPS_EMPLOI = [
  'contract_type', 'contract', 'contractFilter', 'employmentType', 'employment_type',
  'typeOfEmployment', 'efcustomTextAssignmentcat', 'efcustomTextWorkerSubtype',
];

const presenceSql = CHAMPS_EMPLOI.map((c) => `s.raw ? '${c}'`).join(' OR ');

console.log('\n  MARCHÉ NON PUBLIÉ, OU LECTURE MANQUÉE ?');
console.log('  Le brut est la charge utile de la source, pas un champ déjà trié.\n');

/* ── 1. CONTRAT / EMPLOI : brut présent vs canonique rempli ───────────── */
const lignes = await lire(`
  SELECT j."countryCode" AS pays,
         COUNT(DISTINCT j.id)::int AS offres,
         COUNT(DISTINCT j.id) FILTER (WHERE ${presenceSql})::int AS brut_present,
         COUNT(DISTINCT j.id) FILTER (WHERE j."employmentTerm" IS NOT NULL)::int AS canon_rempli,
         COUNT(DISTINCT j.id) FILTER (WHERE (${presenceSql}) AND j."employmentTerm" IS NULL)::int AS perdu
    FROM "Job" j
    LEFT JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
   WHERE j."isActive" AND j."countryCode" IS NOT NULL
   GROUP BY 1 HAVING COUNT(DISTINCT j.id) >= 500
   ORDER BY 2 DESC`);

console.log('  ── DURÉE DE CONTRAT ──');
console.log('  marché   offres   brut publié   canonique   PERDU PAR NOUS   verdict');
console.log('  ' + '─'.repeat(78));

for (const l of lignes) {
  const brut = pc(l.brut_present, l.offres);
  const canon = pc(l.canon_rempli, l.offres);
  const perdu = pc(l.perdu, l.offres);
  /*
   * Le verdict compare ce que la source a ENVOYÉ à ce que nous avons RETENU.
   * Un écart supérieur à 10 points désigne notre chaîne, pas le marché.
   */
  const ecart = n(brut) - n(canon);
  const verdict =
    n(l.brut_present) === 0 ? 'marché muet'
      : ecart > 10 ? `NOUS (${ecart.toFixed(0)} pts perdus)`
        : 'lecture correcte';
  console.log(
    '  ' + String(l.pays).padEnd(9) + fr(l.offres).padStart(7) +
    (brut + '%').padStart(13) + (canon + '%').padStart(12) +
    (perdu + '%').padStart(16) + '   ' + verdict,
  );
}

/* ── 2. LE VOCABULAIRE QU'ON NE SAIT PAS LIRE, PAR MARCHÉ ─────────────── */
console.log('\n\n  ── CE QUE LA SOURCE ENVOIE ET QUE NOUS PERDONS ──');
console.log('  Les valeurs brutes présentes quand le canonique reste vide.\n');

for (const pays of ['US', 'FR', 'GB', 'DE', 'IT', 'ES']) {
  const vals = await lire(`
    SELECT COALESCE(${CHAMPS_EMPLOI.map((c) => `s.raw->>'${c}'`).join(', ')}) AS valeur,
           COUNT(DISTINCT j.id)::int AS nb
      FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
     WHERE j."isActive" AND j."countryCode" = '${pays}'
       AND j."employmentTerm" IS NULL
       AND COALESCE(${CHAMPS_EMPLOI.map((c) => `s.raw->>'${c}'`).join(', ')}) IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC LIMIT 6`);
  if (!vals.length) { console.log(`  ${pays} — rien de perdu.`); continue; }
  const somme = vals.reduce((s, x) => s + n(x.nb), 0);
  console.log(`  ${pays} — ${fr(somme)} offres sur les 6 premières valeurs :`);
  for (const v of vals) console.log(`      « ${String(v.valeur).slice(0, 34)} »`.padEnd(46) + fr(v.nb).padStart(8));
  console.log();
}

/* ── 3. LE BIAIS DE SOURCE : un gros connecteur écrase-t-il un marché ? ── */
console.log('\n  ── LE 19,2 % AMÉRICAIN EST-IL HOMOGÈNE, OU TIRÉ PAR UNE SOURCE ? ──\n');
const sourcesUs = await lire(`
  SELECT s."sourceKey" AS src,
         COUNT(DISTINCT j.id)::int AS offres,
         COUNT(DISTINCT j.id) FILTER (WHERE j."employmentTerm" IS NOT NULL)::int AS avec_contrat,
         COUNT(DISTINCT j.id) FILTER (WHERE ${presenceSql})::int AS brut_present
    FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
   WHERE j."isActive" AND j."countryCode" = 'US'
   GROUP BY 1 HAVING COUNT(DISTINCT j.id) >= 400 ORDER BY 2 DESC LIMIT 12`);
console.log('  source                        offres   canonique   brut publié');
console.log('  ' + '─'.repeat(64));
for (const s of sourcesUs) {
  console.log(
    '  ' + String(s.src).slice(0, 28).padEnd(30) + fr(s.offres).padStart(7) +
    (pc(s.avec_contrat, s.offres) + '%').padStart(12) + (pc(s.brut_present, s.offres) + '%').padStart(14),
  );
}

/* ── 4. TEMPORARY À 0,1 % : absence réelle ou perte ? ─────────────────── */
console.log('\n\n  ── TEMPORARY À 0,1 % : LE MARCHÉ SE TAIT, OU NOUS PERDONS ? ──\n');
const temp = await lire(`
  SELECT COALESCE(${CHAMPS_EMPLOI.map((c) => `s.raw->>'${c}'`).join(', ')}) AS valeur,
         COUNT(DISTINCT j.id)::int AS nb,
         COUNT(DISTINCT j.id) FILTER (WHERE j."employmentTerm" = 'TEMPORARY')::int AS en_temporary,
         COUNT(DISTINCT j.id) FILTER (WHERE j."employmentTerm" IS NULL)::int AS sans_contrat
    FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
   WHERE j."isActive"
     AND COALESCE(${CHAMPS_EMPLOI.map((c) => `s.raw->>'${c}'`).join(', ')}) ~* 'tempor|interim|agency|zero|casual|non-guaranteed|leiharbeit'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
console.log('  valeur brute                        offres   →TEMPORARY   →sans contrat');
console.log('  ' + '─'.repeat(70));
for (const t of temp) {
  console.log(
    '  ' + String(t.valeur).slice(0, 32).padEnd(36) + fr(t.nb).padStart(7) +
    fr(t.en_temporary).padStart(12) + fr(t.sans_contrat).padStart(15),
  );
}

console.log('\n  ' + '─'.repeat(70));
console.log('  LECTURE SEULE — aucune donnée modifiée.\n');

await prisma.$disconnect();

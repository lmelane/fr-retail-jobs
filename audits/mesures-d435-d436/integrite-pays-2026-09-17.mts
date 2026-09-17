/**
 * D'OÙ VIENT LE PAYS D'UNE OFFRE, ET QUE VAUT-IL ? — mesure intégrale, lecture seule.
 *
 * ── LA QUESTION ───────────────────────────────────────────────────────────────────────────────
 *
 * `Job.countryCode` détermine le MARCHÉ d'une offre — c'est la seule colonne qui le fait, et
 * `Job.language` n'y intervient jamais. Mais un code ISO parfaitement normalisé peut provenir
 * d'une donnée initiale ambiguë : « Los Angeles, CA » devenu `CA`, c'est-à-dire le Canada.
 *
 * `countryIntegrity` (module `normalize/countryIntegrity.ts`) porte le verdict sur cette
 * provenance. Trois valeurs prouvent le pays — `RAW_COUNTRY_CODE`, `RAW_COUNTRY`, `VERIFIED` —
 * et `null` signifie « aucune preuve positive », ce qui n'est pas un échec mais l'état par défaut.
 *
 * Point non évident, et c'est le cœur du sujet : un code à deux lettres déclaré dans un CHAMP
 * PAYS ne prouve rien s'il est ambigu. `country: "Canada"` prouve ; `country: "CA"` ne prouve
 * pas, parce qu'il n'en dit pas plus que le suffixe « …, CA » d'un libellé de lieu. Trente-neuf
 * États américains et quatre provinces canadiennes portent un code qui est aussi un pays ISO.
 *
 * ── CE QUE CETTE SONDE RÉPOND, ET CE QU'ELLE NE PEUT PAS RÉPONDRE ─────────────────────────────
 *
 * Elle mesure ce qui est PERSISTÉ. Elle ne rejoue pas la résolution géographique : une offre sans
 * verdict peut l'être parce que sa provenance ne prouvait rien, ou parce qu'elle a été écrite
 * avant que la colonne ne soit alimentée. Les deux cas se ressemblent en base et cette sonde ne
 * les distingue pas — elle le dit plutôt que de laisser croire le contraire.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/mesures-d435-d436/integrite-pays-2026-09-17.mts
 */
import { PrismaClient } from '@prisma/client';

/** Les codes qui sont à la fois un pays ISO et une subdivision d'un pays fédéral. */
const AMBIGUS = ['AL', 'AR', 'CA', 'CO', 'CT', 'DE', 'GA', 'ID', 'IL', 'IN', 'KY', 'LA', 'MA', 'MD', 'ME',
  'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'VA', 'VT', 'WA', 'WI', 'WY', 'NL', 'PE', 'SK', 'NU'];

const db = new PrismaClient();
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—');

try {
  console.log(`\nINTÉGRITÉ DU PAYS — mesure du ${new Date().toISOString().slice(0, 10)}, LECTURE SEULE\n`);

  const [global] = await db.$queryRawUnsafe<Array<{ actives: number; avec: number; sans: number }>>(`
    SELECT count(*)::int AS actives,
           count("countryCode")::int AS avec,
           count(*) FILTER (WHERE "countryCode" IS NULL)::int AS sans
      FROM "Job" WHERE "isActive"`);
  console.log(`  ${global.actives.toLocaleString('fr-FR')} offres actives · avec pays ${global.avec.toLocaleString('fr-FR')} (${pct(global.avec, global.actives)}) · SANS pays ${global.sans.toLocaleString('fr-FR')} (${pct(global.sans, global.actives)})`);
  console.log('  Une offre sans pays n\'appartient à AUCUN marché : elle est invisible du moteur.\n');

  console.log('  RÉPARTITION DES VERDICTS DE PROVENANCE');
  const verdicts = await db.$queryRawUnsafe<Array<{ verdict: string | null; n: number }>>(`
    SELECT "countryIntegrity" AS verdict, count(*)::int AS n
      FROM "Job" WHERE "isActive" AND "countryCode" IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC`);
  for (const v of verdicts) {
    const prouve = v.verdict && ['RAW_COUNTRY_CODE', 'RAW_COUNTRY', 'VERIFIED'].includes(v.verdict);
    console.log(`    ${(v.verdict ?? '(aucun verdict)').padEnd(22)} ${String(v.n).padStart(7)}  ${pct(v.n, global.avec).padStart(7)}  ${prouve ? 'PROUVE le pays' : 'ne prouve rien'}`);
  }

  console.log('\n  LES CODES AMBIGUS — un code ISO qui est aussi une subdivision fédérale');
  const liste = AMBIGUS.map((c) => `'${c}'`).join(',');
  const parAmbigu = await db.$queryRawUnsafe<Array<{ pays: string; n: number; prouves: number; villes: string }>>(`
    SELECT "countryCode" AS pays, count(*)::int AS n,
           count(*) FILTER (WHERE "countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))::int AS prouves,
           string_agg(DISTINCT city, ', ' ORDER BY city) FILTER (WHERE city IS NOT NULL) AS villes
      FROM "Job" WHERE "isActive" AND "countryCode" IN (${liste})
     GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
  console.log('    code   offres   prouvées   villes (extrait)');
  for (const a of parAmbigu) {
    console.log(`    ${a.pays.padEnd(6)} ${String(a.n).padStart(6)} ${pct(a.prouves, a.n).padStart(10)}   ${(a.villes ?? '').slice(0, 74)}`);
  }

  console.log('\n  LE CAS CA — Canada ou Californie ?');
  const ca = await db.$queryRawUnsafe<Array<{ ville: string | null; region: string | null; n: number; prouves: number }>>(`
    SELECT city AS ville, "adminArea1" AS region, count(*)::int AS n,
           count(*) FILTER (WHERE "countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))::int AS prouves
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CA'
     GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 14`);
  console.log('    ville                     région              offres  prouvées');
  for (const c of ca) {
    console.log(`    ${(c.ville ?? '—').padEnd(25)} ${(c.region ?? '—').padEnd(19)} ${String(c.n).padStart(6)}  ${pct(c.prouves, c.n).padStart(7)}`);
  }

  console.log('\n  PAR SOURCE — qui fournit une preuve, qui n’en fournit pas');
  const parSource = await db.$queryRawUnsafe<Array<{ source: string; n: number; prouves: number; sansPays: number }>>(`
    SELECT s."sourceKey" AS source, count(*)::int AS n,
           count(*) FILTER (WHERE j."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))::int AS prouves,
           count(*) FILTER (WHERE j."countryCode" IS NULL)::int AS "sansPays"
      FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
     WHERE j."isActive"
     GROUP BY 1 HAVING count(*) >= 200
     ORDER BY (count(*) FILTER (WHERE j."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')))::float / count(*) ASC
     LIMIT 15`);
  console.log('    source                        offres   prouvées   sans pays');
  for (const s of parSource) {
    console.log(`    ${s.source.padEnd(28)} ${String(s.n).padStart(6)} ${pct(s.prouves, s.n).padStart(10)} ${String(s.sansPays).padStart(11)}`);
  }

  console.log('\n  IMPACT SUR LES 16 MARCHÉS — combien d’offres reposent sur un pays non prouvé');
  const marches = ['US', 'FR', 'GB', 'CA', 'DE', 'IT', 'ES', 'NL', 'AU', 'CN', 'CH', 'BE', 'IN', 'JP', 'KR', 'PT'];
  const parMarche = await db.$queryRawUnsafe<Array<{ pays: string; n: number; prouves: number }>>(`
    SELECT "countryCode" AS pays, count(*)::int AS n,
           count(*) FILTER (WHERE "countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))::int AS prouves
      FROM "Job" WHERE "isActive" AND "countryCode" IN (${marches.map((m) => `'${m}'`).join(',')})
     GROUP BY 1 ORDER BY 2 DESC`);
  console.log('    marché   offres   prouvées   non prouvées');
  for (const m of parMarche) {
    console.log(`    ${m.pays.padEnd(8)} ${String(m.n).padStart(6)} ${pct(m.prouves, m.n).padStart(10)} ${String(m.n - m.prouves).padStart(14)}`);
  }

  console.log('\n  ÉCHANTILLON — offres au pays NON prouvé sur un code ambigu');
  const echantillon = await db.$queryRawUnsafe<Array<{ pays: string; ville: string | null; region: string | null; lieu: string | null; titre: string; source: string }>>(`
    SELECT j."countryCode" AS pays, j.city AS ville, j."adminArea1" AS region, j.location AS lieu,
           left(j.title, 40) AS titre, s."sourceKey" AS source
      FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
     WHERE j."isActive" AND j."countryCode" IN (${liste}) AND j."countryIntegrity" IS NULL
     ORDER BY j.id LIMIT 12`);
  for (const e of echantillon) {
    console.log(`    [${e.pays}] ${(e.lieu ?? `${e.ville ?? '?'} / ${e.region ?? '?'}`).slice(0, 44).padEnd(45)} ${e.source.padEnd(20)} ${e.titre}`);
  }

  console.log('\n  ' + '─'.repeat(92));
  console.log('  Un verdict absent ne dit PAS que le pays est faux : il dit qu\'aucune preuve positive');
  console.log('  n\'a été persistée. Une offre écrite avant l\'alimentation de la colonne ressemble en base');
  console.log('  à une offre dont la provenance ne prouvait rien — cette sonde ne les distingue pas.');
  console.log('  LECTURE SEULE — aucune donnée modifiée.\n');
} finally {
  await db.$disconnect();
}

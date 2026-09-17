/**
 * COMBIEN D'OFFRES PORTENT UNE PREUVE DE PAYS DANS LEUR RAW, JAMAIS EXPLOITÉE ? — lecture seule.
 *
 * ── LA QUESTION, ET POURQUOI ELLE CHANGE TOUT ─────────────────────────────────────────────────
 *
 * 58 205 offres actives sur 78 543 n'ont AUCUN verdict de provenance (`countryIntegrity` nul), et
 * les colonnes projetées de ces offres sont souvent nues : ni région, ni code postal, ni
 * coordonnées. J'en avais conclu qu'il n'y avait « aucun signal secondaire ». C'était faux, et
 * c'est la lecture du RAW qui l'a montré.
 *
 * Un exemple mesuré le 2026-09-17, source Mango (Workday) :
 *
 *   "location": "Londonderry, Derry City, Northern Ireland, United Kingdom"
 *   "country":  { "descriptor": "United Kingdom" }
 *
 * Le pays y est déclaré EN TOUTES LETTRES — une preuve directe, qui n'a jamais été projetée. À
 * l'inverse, chez Everlane (Greenhouse), le RAW ne porte que `location.name = "Los Angeles, CA"`
 * et rien d'autre : là, l'information n'existe pas, et aucune extraction ne la fera apparaître.
 *
 * Cette sonde sépare les deux, sur TOUT le corpus. C'est ce qui dimensionne le chantier
 * géographique : ce qui se répare en relisant nos propres archives, et ce qui exige un
 * référentiel externe.
 *
 * ── CE QU'ELLE CHERCHE ────────────────────────────────────────────────────────────────────────
 *
 * Les chemins où les ATS déposent un pays. Ils sont relevés dans le RAW réel, jamais devinés : un
 * chemin inventé compterait zéro et laisserait croire que la preuve n'existe pas.
 *
 * Un NOM de pays (« United Kingdom », « Canada ») prouve ; un CODE nu à deux lettres ne prouve
 * rien de plus que le suffixe « …, CA » — c'est la règle de `normalize/countryIntegrity.ts`, et
 * cette sonde la respecte au lieu de la contourner.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/mesures-d435-d436/preuve-pays-dans-raw-2026-09-17.mts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—');

/*
 * Les chemins JSON où un pays peut se trouver, relevés sur le RAW réel des adaptateurs.
 * `->>` rend le texte ; un chemin absent rend NULL et ne compte pas.
 */
const CHEMINS = [
  [`raw->'detail'->'jobPostingInfo'->'country'->>'descriptor'`, 'workday.country.descriptor'],
  [`raw->'detail'->'jobPostingInfo'->>'location'`, 'workday.location'],
  [`raw->'country'->>'name'`, 'country.name'],
  [`raw->'country'->>'descriptor'`, 'country.descriptor'],
  [`raw->>'country'`, 'country (racine)'],
  [`raw->'location'->>'country'`, 'location.country'],
  [`raw->'location'->>'countryName'`, 'location.countryName'],
  [`raw->'address'->>'country'`, 'address.country'],
  [`raw->'address'->>'countryCode'`, 'address.countryCode'],
  [`raw->'job'->'location'->>'country'`, 'job.location.country'],
  [`raw->'primaryLocation'->>'country'`, 'primaryLocation.country'],
  [`raw->>'countryName'`, 'countryName'],
  [`raw->>'country_name'`, 'country_name'],
  [`raw->'location'->>'name'`, 'location.name'],
  [`raw->>'location'`, 'location (racine)'],
] as const;

try {
  console.log(`\nPREUVE DE PAYS DANS LE RAW — mesure du ${new Date().toISOString().slice(0, 10)}, LECTURE SEULE\n`);

  const [socle] = await db.$queryRawUnsafe<Array<{ actives: number; sansVerdict: number; avecRaw: number }>>(`
    SELECT count(*)::int AS actives,
           count(*) FILTER (WHERE j."countryIntegrity" IS NULL)::int AS "sansVerdict",
           count(*) FILTER (WHERE s.raw IS NOT NULL)::int AS "avecRaw"
      FROM "Job" j LEFT JOIN LATERAL (
        SELECT raw FROM "JobSource" WHERE "jobId" = j.id AND "isActive" ORDER BY id LIMIT 1) s ON true
     WHERE j."isActive"`);
  console.log(`  ${socle.actives.toLocaleString('fr-FR')} offres actives · sans verdict de provenance ${socle.sansVerdict.toLocaleString('fr-FR')} · avec RAW conservé ${socle.avecRaw.toLocaleString('fr-FR')}\n`);

  console.log('  CHEMINS OÙ UN PAYS EST PRÉSENT DANS LE RAW (offres SANS verdict)');
  console.log('    chemin                             présent   dont NOM de pays   exemple');
  console.log('    ' + '─'.repeat(96));

  for (const [expr, nom] of CHEMINS) {
    const [r] = await db.$queryRawUnsafe<Array<{ present: number; nomPays: number; exemple: string | null }>>(`
      SELECT count(*) FILTER (WHERE v IS NOT NULL AND v <> '')::int AS present,
             count(*) FILTER (WHERE v IS NOT NULL AND length(v) > 3)::int AS "nomPays",
             (array_agg(v) FILTER (WHERE v IS NOT NULL AND length(v) > 3))[1] AS exemple
        FROM (
          SELECT s.${expr} AS v
            FROM "Job" j JOIN LATERAL (
              SELECT raw FROM "JobSource" WHERE "jobId" = j.id AND "isActive" ORDER BY id LIMIT 1) s ON true
           WHERE j."isActive" AND j."countryIntegrity" IS NULL AND s.raw IS NOT NULL) t`);
    if (r.present === 0) continue;
    console.log(`    ${nom.padEnd(34)} ${String(r.present).padStart(7)} ${String(r.nomPays).padStart(18)}   ${(r.exemple ?? '').slice(0, 42)}`);
  }

  /*
   * LE CHIFFRE QUI DIMENSIONNE LE CHANTIER : combien d'offres sans verdict portent, quelque part
   * dans leur RAW, un NOM de pays exploitable. `length(v) > 3` écarte les codes à deux lettres,
   * qui ne prouvent rien (règle de `countryIntegrity.ts`).
   */
  const union = CHEMINS.map(([e]) => `s.${e}`).join(', ');
  const [couverture] = await db.$queryRawUnsafe<Array<{ total: number; recuperable: number }>>(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE length(coalesce(${union.replace(/, /g, ', ')})) > 3)::int AS recuperable
      FROM "Job" j JOIN LATERAL (
        SELECT raw FROM "JobSource" WHERE "jobId" = j.id AND "isActive" ORDER BY id LIMIT 1) s ON true
     WHERE j."isActive" AND j."countryIntegrity" IS NULL AND s.raw IS NOT NULL`);

  console.log(`\n  RÉCUPÉRABLE DEPUIS NOS PROPRES ARCHIVES`);
  console.log(`    ${couverture.recuperable.toLocaleString('fr-FR')} offres sur ${couverture.total.toLocaleString('fr-FR')} sans verdict portent un pays dans leur RAW (${pct(couverture.recuperable, couverture.total)})`);
  console.log(`    Les autres exigeront un référentiel externe, ou resteront ambiguës.`);

  console.log('\n  PAR SOURCE — qui a déposé une preuve que nous n’avons jamais lue');
  const parSource = await db.$queryRawUnsafe<Array<{ source: string; n: number; recuperable: number }>>(`
    SELECT s."sourceKey" AS source, count(*)::int AS n,
           count(*) FILTER (WHERE length(coalesce(${union})) > 3)::int AS recuperable
      FROM "Job" j JOIN LATERAL (
        SELECT "sourceKey", raw FROM "JobSource" WHERE "jobId" = j.id AND "isActive" ORDER BY id LIMIT 1) s ON true
     WHERE j."isActive" AND j."countryIntegrity" IS NULL AND s.raw IS NOT NULL
     GROUP BY 1 HAVING count(*) >= 200
     ORDER BY 3 DESC LIMIT 18`);
  console.log('    source                         sans verdict   récupérable');
  for (const s of parSource) {
    console.log(`    ${s.source.padEnd(30)} ${String(s.n).padStart(12)} ${pct(s.recuperable, s.n).padStart(13)}`);
  }

  console.log('\n  LE CAS CA — les offres canadiennes sans verdict portent-elles un pays dans leur RAW ?');
  const [ca] = await db.$queryRawUnsafe<Array<{ total: number; recuperable: number }>>(`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE length(coalesce(${union})) > 3)::int AS recuperable
      FROM "Job" j JOIN LATERAL (
        SELECT raw FROM "JobSource" WHERE "jobId" = j.id AND "isActive" ORDER BY id LIMIT 1) s ON true
     WHERE j."isActive" AND j."countryCode" = 'CA' AND j."countryIntegrity" IS NULL AND s.raw IS NOT NULL`);
  console.log(`    ${ca.recuperable.toLocaleString('fr-FR')} sur ${ca.total.toLocaleString('fr-FR')} (${pct(ca.recuperable, ca.total)})`);

  console.log('\n  ' + '─'.repeat(96));
  console.log('  Un pays PRÉSENT dans le RAW n’est pas encore un pays PROUVÉ : il faut le relire, le');
  console.log('  normaliser et confronter le verdict au reste. Ce compte dit ce qui est RÉCUPÉRABLE,');
  console.log('  pas ce qui est déjà juste. LECTURE SEULE — aucune donnée modifiée.\n');
} finally {
  await db.$disconnect();
}

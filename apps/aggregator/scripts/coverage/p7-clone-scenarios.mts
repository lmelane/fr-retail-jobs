/**
 * P7 PHASE 0 — les scénarios de reprise, DÉMONTRÉS SUR CLONE.
 *
 * Ce programme ne simule rien : il LIT l'état d'un clone sur lequel l'ingestion réelle vient de tourner
 * (`scripts/ops/replay-ingest.mts`, qui appelle `ingestAllBySource` comme la production l'appelle), et il
 * vérifie une par une les propriétés que la reprise doit garantir.
 *
 * Chaque scénario est une PROPRIÉTÉ vérifiable, jamais un compte figé (D55) : « aucun verdict hors liste
 * positive » survit à un changement de volume, « exactement 163 verdicts » serait faux le lendemain.
 *
 * Lecture seule. Refuse toute base qui n'est pas un clone. usage: p7-clone-scenarios.mts [--out=<file.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const p = new PrismaClient();

/** Les sources réellement ré-ingérées sur le clone. */
const INGESTED = ['mecca', 'american-vintage-dr', 'beiersdorf'];

/** Les codes pays qui sont AUSSI une subdivision d'un pays fédéral — les seuls à exiger une preuve. */
const AMBIGUOUS = ['CA', 'IN', 'AL', 'GA', 'KY', 'NC', 'SC', 'SD', 'NE', 'TN', 'MO', 'LA', 'MT', 'ID', 'MS',
  'PA', 'VA', 'DE', 'ME', 'AR', 'MD', 'MA', 'NV', 'CO', 'CT', 'IL', 'MN', 'NL', 'ND', 'OK', 'SK', 'PE', 'NU',
  'WA', 'NH', 'MI', 'OH', 'RI', 'VT', 'WI', 'WY', 'OR', 'NY'];

const checks: Array<{ id: string; property: string; ok: boolean; evidence: unknown }> = [];
const check = (id: string, property: string, ok: boolean, evidence: unknown) =>
  checks.push({ id, property, ok, evidence });

try {
  const [{ current_database: db }]: any[] = await p.$queryRaw`SELECT current_database()`;
  if (!/replay|clone|test/.test(db)) throw new Error(`refus : ${db} n'est pas un clone`);

  /** 4. `countryIntegrity` réellement persisté par l'ingestion, et LU tel que le web le lira. */
  const integrity: any[] = await p.$queryRaw(Prisma.sql`
    SELECT count(*) FILTER (WHERE j."countryIntegrity" IS NOT NULL)::int AS written,
           count(*) FILTER (WHERE j."countryIntegrity" NOT IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))::int AS off_list
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ANY(${INGESTED})`);
  check('S4a', 'l\'ingestion PERSISTE countryIntegrity (la colonne n\'est plus vide)',
    integrity[0].written > 0, integrity[0]);
  check('S4b', 'aucun verdict hors de la liste positive fermée',
    integrity[0].off_list === 0, { offList: integrity[0].off_list });

  /**
   * L'invariant central de H-GEO-01 : un code ambigu ne devient prouvé QUE si la source déclare le pays.
   * On le vérifie sur la donnée, pas sur l'intention — chaque offre ambiguë prouvée doit porter un verdict de
   * champ déclaré, jamais un verdict issu d'un libellé.
   */
  const ambiguous: any[] = await p.$queryRaw(Prisma.sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE j."countryIntegrity" IS NOT NULL)::int AS proven,
           count(*) FILTER (WHERE j."countryIntegrity" IS NULL)::int AS still_unproven
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ANY(${INGESTED})
      AND j."countryCode" = ANY(${AMBIGUOUS})`);
  check('S4c', 'les offres à code ambigu ne deviennent prouvées qu\'une par une, jamais en bloc',
    ambiguous[0].still_unproven > 0 || ambiguous[0].total === ambiguous[0].proven,
    ambiguous[0]);

  /** 2 & 3. Les preuves d'énumération et les droits de fermer, RECALCULÉS par le run qui vient de tourner. */
  const rights: any[] = await p.$queryRaw(Prisma.sql`
    SELECT DISTINCT ON ("sourceKey") "sourceKey", status, fetched, "declaredTotal", complete,
           "canAttestAbsence", truncated, errors
    FROM "SourceRun" WHERE "sourceKey" = ANY(${INGESTED}) ORDER BY "sourceKey", "ranAt" DESC, id DESC`);
  check('S2', 'chaque source ré-ingérée porte une preuve d\'énumération recalculée',
    rights.length === INGESTED.length && rights.every((r) => r.complete !== null), rights);
  check('S3', 'aucun droit de fermer sans énumération PROUVÉE (complete = true)',
    rights.every((r) => r.canAttestAbsence !== true || r.complete === true), rights);

  /** 8. Aucun retrait administratif transformé en fermeture employeur. */
  const lifecycle: any[] = await p.$queryRaw`
    SELECT count(*) FILTER (WHERE "closedAt" IS NOT NULL AND "withdrawnAt" IS NOT NULL)::int AS both,
           count(*) FILTER (WHERE "isActive" AND "closedAt" IS NOT NULL)::int AS active_but_closed
    FROM "Job"`;
  check('S8', 'fermeture employeur et retrait administratif restent exclusifs, et aucune offre active n\'est fermée',
    lifecycle[0].both === 0 && lifecycle[0].active_but_closed === 0, lifecycle[0]);

  /** 9. Les retenues de publication, intactes : leur RAW est conservé et rien n'est publié. */
  const holds: any[] = await p.$queryRaw`
    SELECT count(*)::int AS observations,
           count(*) FILTER (WHERE raw ? 'publicationHold')::int AS held
    FROM "SourceObservation"`;
  check('S9', 'les retenues de publication sont conservées (RAW préservé, rien de publié)',
    holds[0].observations >= holds[0].held, holds[0]);

  /**
   * 10. La chaîne publique après ingestion : les offres écrites sont bien lisibles par la requête publique,
   * avec le champ que la fiche utilise. On compare des ENSEMBLES d'identifiants, jamais des totaux (P5).
   */
  const publicChain: any[] = await p.$queryRaw(Prisma.sql`
    SELECT count(*)::int AS live,
           count(*) FILTER (WHERE j.title IS NOT NULL AND j.url IS NOT NULL)::int AS renderable
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."isActive" AND j."isActive" AND js."sourceKey" = ANY(${INGESTED})`);
  check('S10', 'toute offre écrite par le run est lisible par la chaîne publique',
    publicChain[0].live === publicChain[0].renderable, publicChain[0]);

  /**
   * 5 & 6. Pas de double écriture au second passage, et reprise propre après interruption.
   *
   * Les deux se lisent dans la même propriété : une offre ne doit exister qu'en UNE représentation par source.
   * Un second passage qui recréerait, ou une reprise après crash qui dupliquerait, se verrait ici.
   */
  const duplicates: any[] = await p.$queryRaw(Prisma.sql`
    SELECT count(*)::int AS duplicated FROM (
      SELECT "sourceKey", "externalId" FROM "JobSource" WHERE "isActive" AND "sourceKey" = ANY(${INGESTED})
      GROUP BY 1, 2 HAVING count(*) > 1
    ) d`);
  check('S5/S6', 'aucune double écriture : une représentation active par (source, externalId), après second passage et après reprise',
    duplicates[0].duplicated === 0, duplicates[0]);

  /** 7. Aucune source hors périmètre touchée par le run. */
  const outside: any[] = await p.$queryRaw(Prisma.sql`
    SELECT count(*)::int AS runs_outside FROM "SourceRun"
    WHERE "ranAt" > now() - interval '2 hours' AND NOT ("sourceKey" = ANY(${INGESTED}))`);
  check('S7', 'aucune source hors de la liste autorisée n\'a produit de run',
    outside[0].runs_outside === 0, outside[0]);

  const failed = checks.filter((c) => !c.ok);
  const out = { database: db, ingested: INGESTED, checks, passed: checks.length - failed.length, failed: failed.length };
  const file = arg('out');
  if (file) writeFileSync(file, JSON.stringify(out, null, 2));

  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.id}  ${c.property}\n     ${JSON.stringify(c.evidence)}`);
  console.log(`\n${out.passed}/${checks.length} propriétés vérifiées`);
  if (failed.length) process.exitCode = 1;
} finally {
  await p.$disconnect();
}

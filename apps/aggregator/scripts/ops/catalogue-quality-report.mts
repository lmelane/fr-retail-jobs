/**
 * Rapport qualité du catalogue (lot F4, livrable F8 n° 4) : des dénominateurs, jamais des ratios sur les seuls
 * survivants. Lecture seule sur la base catalogue désignée par DATABASE_URL (la stack locale par
 * `npm run stack:exec -- node --import tsx apps/aggregator/scripts/ops/catalogue-quality-report.mts`, ou une copie).
 *
 * Ce que le rapport compte, avec sa population :
 *  - sources : enregistrées, ACTIVE, avec au moins une admission d'ingestion, fraîcheur (dernière fin d'ingestion) ;
 *  - offres : lignes `Job` (publiées) actives / fermées / retirées / expirées, `JobSource` actives et en quarantaine,
 *    dernières fins d'ingestion (publiées, retenues, refusées à l'écriture, ignorées) et motifs de refus d'écriture
 *    (événements durables `job.write_failed` par nom d'erreur) ;
 *  - couverture des offres actives : description utile (≥ 200 caractères), pays, ville, code postal, date native,
 *    échéance déclarée, contrat, temps de travail, expérience, formation, salaire déclaré, langue ;
 *  - géographie : pays servis (avec leur volume), intégrité de pays, marchés de la stack ;
 *  - fraîcheur : âge de la date native et de la dernière observation des offres actives (quantiles) ;
 *  - doublons prouvés (`mergedIntoId`) et grappes (`clusterKey` partagé par plusieurs offres actives) ;
 *  - cas en revue : décisions de périmètre de publication, corrections récentes.
 *
 * usage: catalogue-quality-report.mts [--out=<rapport.json>] [--markdown=<rapport.md>] [--days=30]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const days = Number(arg('days') ?? 30);
const db = new PrismaClient({ log: [] });
const n = (value: unknown) => Number(value ?? 0);
type Row = Record<string, unknown>;
const one = async <T extends Row>(sql: TemplateStringsArray, ...values: unknown[]) => (await db.$queryRaw<T[]>(sql, ...values))[0];

try {
  const since = new Date(Date.now() - days * 86_400_000);
  const sources = await one<Row>`SELECT count(*)::int AS enregistrees, count(*) FILTER (WHERE status='ACTIVE')::int AS actives,
    count(*) FILTER (WHERE status='ACTIVE' AND EXISTS (SELECT 1 FROM "CaptureBatch" b JOIN "SourceIngestionAdmission" a ON a."batchId"=b.id WHERE b."sourceKey"="Source".key))::int AS actives_avec_admission,
    count(*) FILTER (WHERE status='ACTIVE' AND EXISTS (SELECT 1 FROM "CaptureBatch" b JOIN "SourceIngestionCompletion" c ON c."batchId"=b.id WHERE b."sourceKey"="Source".key AND c."completedAt" > ${since}))::int AS actives_ingerees_recemment
    FROM "Source"`;
  const completions = await db.$queryRaw<Row[]>`SELECT b."sourceKey" AS source, c."completedAt", c.published, c.held, c."writeFailed", c.skipped
    FROM "SourceIngestionCompletion" c JOIN "CaptureBatch" b ON b.id=c."batchId"
    WHERE c."completedAt" = (SELECT max(c2."completedAt") FROM "SourceIngestionCompletion" c2 JOIN "CaptureBatch" b2 ON b2.id=c2."batchId" WHERE b2."sourceKey"=b."sourceKey")`;
  const freshness = completions.map(c => (Date.now() - new Date(String(c.completedAt)).getTime()) / 3_600_000).sort((a, b) => a - b);
  const quantile = (values: number[], q: number) => values.length ? values[Math.min(values.length - 1, Math.floor(q * values.length))] : null;
  const writeFailures = await db.$queryRaw<Row[]>`SELECT coalesce(payload->'error'->>'name', 'inconnu') || coalesce(':' || (payload->'error'->>'proposedName'), '') AS motif, count(*)::int AS n,
    count(DISTINCT "sourceKey")::int AS sources FROM "PipelineEvent" WHERE event='job.write_failed' AND at > ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  const offers = await one<Row>`SELECT count(*)::int AS publiees, count(*) FILTER (WHERE "isActive")::int AS actives,
    count(*) FILTER (WHERE NOT "isActive" AND "withdrawnAt" IS NOT NULL)::int AS retirees, count(*) FILTER (WHERE NOT "isActive" AND "closedAt" IS NOT NULL AND "withdrawnAt" IS NULL)::int AS fermees,
    count(*) FILTER (WHERE "mergedIntoId" IS NOT NULL)::int AS fusionnees FROM "Job"`;
  const jobSources = await one<Row>`SELECT count(*)::int AS representations, count(*) FILTER (WHERE "isActive")::int AS actives, count(*) FILTER (WHERE "quarantinedAt" IS NOT NULL)::int AS en_quarantaine,
    count(*) FILTER (WHERE "captureBatchId" IS NOT NULL)::int AS avec_capture, count(*) FILTER (WHERE "expiresAt" IS NOT NULL)::int AS avec_echeance FROM "JobSource"`;
  const coverage = await one<Row>`SELECT count(*)::int AS actives,
    count(*) FILTER (WHERE description IS NOT NULL AND length(description) >= 200)::int AS description_utile,
    count(*) FILTER (WHERE "countryCode" IS NOT NULL)::int AS pays, count(*) FILTER (WHERE "countryIntegrity" IN ('RAW_COUNTRY_CODE', 'RAW_COUNTRY', 'VERIFIED'))::int AS pays_prouve,
    count(*) FILTER (WHERE city IS NOT NULL)::int AS ville, count(*) FILTER (WHERE "postalCode" IS NOT NULL)::int AS code_postal,
    count(*) FILTER (WHERE latitude IS NOT NULL)::int AS geocodees, count(*) FILTER (WHERE "postedAt" IS NOT NULL)::int AS date_native,
    count(*) FILTER (WHERE "validThrough" IS NOT NULL)::int AS echeance, count(*) FILTER (WHERE "employmentTerm" IS NOT NULL OR "rawContract" IS NOT NULL)::int AS contrat,
    count(*) FILTER (WHERE "workTime" IS NOT NULL)::int AS temps_de_travail, count(*) FILTER (WHERE "experienceYears" IS NOT NULL)::int AS experience,
    count(*) FILTER (WHERE "educationLevel" IS NOT NULL)::int AS formation, count(*) FILTER (WHERE "salaryMin" IS NOT NULL OR "salaryMax" IS NOT NULL)::int AS salaire,
    count(*) FILTER (WHERE language IS NOT NULL)::int AS langue, count(*) FILTER (WHERE "occupationReleaseId" IS NOT NULL)::int AS metier_classe
    FROM "Job" WHERE "isActive"`;
  const countries = await db.$queryRaw<Row[]>`SELECT coalesce("countryCode", '∅') AS pays, count(*)::int AS actives FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY 2 DESC`;
  const ages = await one<Row>`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now()-"postedAt")/86400) AS mediane_jours_date_native,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM now()-"postedAt")/86400) AS p90_jours_date_native,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now()-"lastSeenAt")/3600) AS mediane_heures_derniere_observation,
    max(extract(epoch FROM now()-"lastSeenAt")/3600) AS max_heures_derniere_observation FROM "Job" WHERE "isActive"`;
  const clusters = await one<Row>`SELECT count(*)::int AS grappes, sum(n)::int AS offres FROM (SELECT "clusterKey", count(*) AS n FROM "Job" WHERE "isActive" GROUP BY 1 HAVING count(*) > 1) g`;
  const review = await one<Row>`SELECT (SELECT count(*) FROM "PostingScopeDecision")::int AS decisions_perimetre, (SELECT count(*) FROM "DataCorrection" WHERE "createdAt" > ${since})::int AS corrections_recentes,
    (SELECT count(*) FROM "Job" j WHERE j."isActive" AND NOT EXISTS (SELECT 1 FROM "Company" c WHERE c.id=j."companyId" AND c."identityReviewId" IS NOT NULL))::int AS actives_sans_revue_employeur`;
  const perSource = await db.$queryRaw<Row[]>`SELECT js."sourceKey" AS source, count(*) FILTER (WHERE js."isActive")::int AS actives, count(*)::int AS representations,
    max(js."lastSeenAt") AS derniere_observation FROM "JobSource" js GROUP BY 1 ORDER BY 2 DESC`;
  const report = {
    generatedAt: new Date().toISOString(), windowDays: days,
    sources: { ...sources, fraicheurHeures: { sourcesAvecFin: freshness.length, mediane: quantile(freshness, 0.5), p90: quantile(freshness, 0.9), max: freshness.at(-1) ?? null } },
    dernieresFinsIngestion: completions.reduce<{ published: number; held: number; writeFailed: number; skipped: number }>((acc, c) => ({ published: acc.published + n(c.published), held: acc.held + n(c.held), writeFailed: acc.writeFailed + n(c.writeFailed), skipped: acc.skipped + n(c.skipped) }), { published: 0, held: 0, writeFailed: 0, skipped: 0 }),
    refusDEcriture: writeFailures, offres: offers, representations: jobSources,
    couvertureActives: Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, k === 'actives' ? n(v) : { n: n(v), part: n(coverage.actives) ? Math.round(1000 * n(v) / n(coverage.actives)) / 10 : null }])),
    pays: { servis: countries.length, detail: countries }, ages, doublons: { fusionnees: n(offers.fusionnees), grappesActives: clusters }, revue: review,
    parSource: perSource,
  };
  const json = JSON.stringify(report, (_k, v) => typeof v === 'bigint' ? Number(v) : v, 2) + '\n';
  if (arg('out')) writeFileSync(arg('out')!, json, { mode: 0o600 });
  if (arg('markdown')) {
    const c = report.couvertureActives as Record<string, { n: number; part: number | null } | number>;
    const pct = (key: string) => { const v = c[key]; return typeof v === 'object' ? `${v.n} (${v.part ?? '—'} %)` : String(v); };
    const md = [
      `# Rapport qualité du catalogue (${report.generatedAt.slice(0, 10)})`, '',
      `Base lue en lecture seule ; fenêtre ${days} jours pour la fraîcheur et les refus d'écriture. Chaque part est rapportée à sa population.`, '',
      '## Sources', '', `| Enregistrées | ACTIVE | ACTIVE avec admission | ACTIVE ingérées sur la fenêtre | Fraîcheur de la dernière fin d'ingestion (h) : médiane / p90 / max |`, '|---|---|---|---|---|',
      `| ${n(sources.enregistrees)} | ${n(sources.actives)} | ${n(sources.actives_avec_admission)} | ${n(sources.actives_ingerees_recemment)} | ${report.sources.fraicheurHeures.mediane?.toFixed(1) ?? '—'} / ${report.sources.fraicheurHeures.p90?.toFixed(1) ?? '—'} / ${report.sources.fraicheurHeures.max?.toFixed(1) ?? '—'} (${freshness.length} sources) |`, '',
      '## Offres', '', `| Publiées (\`Job\`) | Actives | Fermées | Retirées | Fusionnées (doublon prouvé) | Représentations (\`JobSource\`) | dont actives | en quarantaine | avec capture native |`, '|---|---|---|---|---|---|---|---|---|',
      `| ${n(offers.publiees)} | ${n(offers.actives)} | ${n(offers.fermees)} | ${n(offers.retirees)} | ${n(offers.fusionnees)} | ${n(jobSources.representations)} | ${n(jobSources.actives)} | ${n(jobSources.en_quarantaine)} | ${n(jobSources.avec_capture)} |`, '',
      `Dernières fins d'ingestion (une par source) : ${report.dernieresFinsIngestion.published} publiées, ${report.dernieresFinsIngestion.held} retenues, ${report.dernieresFinsIngestion.writeFailed} refusées à l'écriture, ${report.dernieresFinsIngestion.skipped} ignorées.`, '',
      '### Refus d\'écriture sur la fenêtre (événements durables)', '', '| Motif | Offres | Sources |', '|---|---|---|', ...writeFailures.map(r => `| ${r.motif} | ${n(r.n)} | ${n(r.sources)} |`), '',
      `## Couverture des ${n(coverage.actives)} offres actives`, '', '| Champ | Offres renseignées (part) |', '|---|---|',
      ...['description_utile', 'pays', 'pays_prouve', 'ville', 'code_postal', 'geocodees', 'date_native', 'echeance', 'contrat', 'temps_de_travail', 'experience', 'formation', 'salaire', 'langue', 'metier_classe'].map(k => `| ${k} | ${pct(k)} |`), '',
      `## Pays servis : ${countries.length}`, '', '| Pays | Offres actives |', '|---|---|', ...countries.slice(0, 40).map(r => `| ${r.pays} | ${n(r.actives)} |`), '',
      '## Fraîcheur des offres actives', '', `Date native : médiane ${Number(ages.mediane_jours_date_native ?? 0).toFixed(1)} j, p90 ${Number(ages.p90_jours_date_native ?? 0).toFixed(1)} j. Dernière observation : médiane ${Number(ages.mediane_heures_derniere_observation ?? 0).toFixed(1)} h, max ${Number(ages.max_heures_derniere_observation ?? 0).toFixed(1)} h.`, '',
      '## Doublons et grappes', '', `${n(offers.fusionnees)} offres fusionnées vers une canonique (doublons prouvés) ; ${n(clusters.grappes)} grappes de clé partagée regroupant ${n(clusters.offres)} offres actives (candidates, non prouvées).`, '',
      '## En revue', '', `${n(review.decisions_perimetre)} décisions de périmètre de publication ; ${n(review.corrections_recentes)} corrections sur la fenêtre ; ${n(review.actives_sans_revue_employeur)} offres actives dont la Maison n'a pas de revue d'identité d'employeur.`, '',
      '## Par source (représentations actives)', '', '| Source | Actives | Représentations | Dernière observation |', '|---|---|---|---|',
      ...perSource.map(r => `| ${r.source} | ${n(r.actives)} | ${n(r.representations)} | ${String(r.derniere_observation ?? '').slice(0, 16)} |`), '',
    ].join('\n');
    writeFileSync(arg('markdown')!, md);
  }
  console.log(json.slice(0, 4000));
} finally { await db.$disconnect(); }

/**
 * LE VERDICT COMPLET D'UNE INGESTION, par source — la chaîne entière, sans trou entre deux nombres.
 *
 * Le point qui a motivé cet outil : « 1 656 servies » et « 1 509 uniques » ne sont PAS le même fait. Phenom
 * repagine à chaque appel et resert des lignes déjà vues ; annoncer le total servi comme un nombre d'offres
 * serait faux de 147 lignes sur Skechers. Chaque colonne ci-dessous est donc une mesure distincte, lue là où
 * elle est réellement écrite :
 *
 *   annoncé      SourceRun.declaredTotal — ce que le publieur DIT avoir
 *   servies      SourceRun.fetched — les lignes rendues, doublons inter-pages COMPRIS
 *   uniques      PipelineEvent.source.enumeration_observed → enumeration.pageEvidence[].ids, dédupliqués
 *   acceptées    SourceRun.accepted — passées les portes d'identité et de périmètre
 *   persistées   JobSource de la source (toutes, actives ou non)
 *   nouvelles    JobSource dont le firstSeenAt tombe dans ce run
 *   ré-attestées JobSource dont le lastSeenAt tombe dans ce run sans y être nées
 *   tenues       PipelineEvent job.publication_held
 *   refusées     EmployerObservation REVIEW_REQUIRED
 *   err. écriture PipelineEvent job.write_failed
 *   publiées     JobSource actives dont le Job est actif — ce que le site peut montrer
 *
 * L'écart `servies − uniques` n'est PAS un défaut : c'est la mesure de l'instabilité du publieur, et c'est
 * précisément ce qui interdit de conclure une absence depuis ce run (P7).
 *
 * usage: db.py readonly npx tsx scripts/ops/p9-verdict.mts --keys=a,b [--run-id=<uuid>]
 */
import { PrismaClient } from '@prisma/client';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const KEYS = (arg('keys') ?? 'hugo-boss-phenom,skechers-phenom').split(',');
const RUN_ID = arg('run-id');
const p = new PrismaClient();

for (const key of KEYS) {
  const run = await p.sourceRun.findFirst({
    where: { sourceKey: key, ...(RUN_ID ? { runId: RUN_ID } : {}) },
    orderBy: { ranAt: 'desc' },
    select: { runId: true, ranAt: true, status: true, fetched: true, accepted: true, declaredTotal: true,
              errors: true, complete: true, truncated: true, canAttestAbsence: true,
              descriptionRate: true, urlRate: true },
  });
  if (!run) { console.log(JSON.stringify({ source: key, verdict: 'AUCUN_RUN' })); continue; }

  // L'ensemble OBSERVÉ, corrélé au runId — jamais déduit d'un lastSeenAt, qui est mutable (P8).
  const ev: any[] = await p.$queryRaw`
    SELECT e.payload FROM "PipelineEvent" e
    WHERE e.event='source.enumeration_observed' AND e."sourceKey"=${key}
      AND (${run.runId}::text IS NULL OR e."runId"=${run.runId})
    ORDER BY e.at DESC LIMIT 1`;
  const pages = ev[0]?.payload?.enumeration?.pageEvidence ?? [];
  const served = pages.flatMap((x: any) => x.ids ?? x.canonicalIds ?? []);
  const observed = new Set<string>(served);

  const ct = (e: string) => p.pipelineEvent.count({ where: { sourceKey: key, event: e, ...(run.runId ? { runId: run.runId } : {}) } });

  /**
   * LA FENÊTRE DU RUN, bornée par le run PRÉCÉDENT de la même source — pas par un recul arbitraire.
   * Une fenêtre trop large recompte comme « nouvelles » les lignes nées au passage d'avant : c'est ainsi
   * qu'on annoncerait deux fois les mêmes offres ajoutées. Le plancher est donc l'instant du run précédent,
   * et à défaut de précédent (première ingestion) il n'y a rien à recompter.
   */
  const prev = await p.sourceRun.findFirst({
    where: { sourceKey: key, ranAt: { lt: run.ranAt } }, orderBy: { ranAt: 'desc' }, select: { ranAt: true } });
  const win = { gte: prev?.ranAt ?? new Date(0) };

  const [persisted, published, born, reattested, held, writeFailed, refused] = await Promise.all([
    p.jobSource.count({ where: { sourceKey: key } }),
    p.jobSource.count({ where: { sourceKey: key, isActive: true, job: { isActive: true } } }),
    p.jobSource.count({ where: { sourceKey: key, firstSeenAt: win } }),
    p.jobSource.count({ where: { sourceKey: key, lastSeenAt: win, NOT: { firstSeenAt: win } } }),
    ct('job.publication_held'), ct('job.write_failed'),
    p.employerObservation.count({ where: { sourceKey: key, rule: 'REVIEW_REQUIRED', observedAt: win } }),
  ]);

  console.log(JSON.stringify({
    source: key, runId: run.runId, ranAt: run.ranAt, statut: run.status,
    annonce: run.declaredTotal, servies: run.fetched, uniquesObservees: observed.size,
    doublonsInterPages: served.length - observed.size,
    acceptees: run.accepted, persistees: persisted, nouvelles: born, reattestees: reattested,
    tenues: held, refuseesIdentite: refused, erreursEcriture: writeFailed, erreursRun: run.errors,
    publiquementVisibles: published,
    complete: run.complete, tronque: run.truncated, peutAttesterUneAbsence: run.canAttestAbsence,
    tauxDescription: run.descriptionRate, tauxUrl: run.urlRate,
  }, null, 1));
}
await p.$disconnect();

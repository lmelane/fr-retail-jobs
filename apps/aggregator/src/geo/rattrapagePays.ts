import { randomUUID } from 'node:crypto';
import { Prisma, type AtsType, type PrismaClient } from '@prisma/client';
import type { SourceTier } from '@catwalks/db/publications';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { deployedCommitHash } from '../capture/revision.js';
import { projectSourceFacts, readSourceFacts } from '../facts/index.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { recordDataCorrection } from '../lib/maintenancePlan.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { toCandidate } from '../pipeline/ingest.js';
import { changedEvents, toEventRow } from '../pipeline/jobEvents.js';
import { countryChainStatus, publicationCountry } from '../publication/content.js';
import { countryProofOf } from '../publication/countryProof.js';
import { recoverRetainedPublication } from '../publication/recovery.js';
import { chargerFrontieres } from './frontieres.js';
import type { CauseSansPays, MemoireMarches, MotifPays } from './paysParPreuve.js';

/** L'aperçu ne fait que lire : un client ou une transaction (READ ONLY pour la mesure de production). */
type Lecteur = Pick<Prisma.TransactionClient, '$queryRaw' | 'sourceFieldTrust'>;

/**
 * D-520, offres sans pays — LE RATTRAPAGE DU STOCK, en deux temps comme `qualify-sectors` et `registry-review`.
 *
 *  - Aperçu (`resoudre-pays --output=<fichier>`) : rien n'est écrit. Chaque offre active sans pays est relue depuis le RAW
 *    de sa publication canonique par le lecteur d'aujourd'hui (`recoverRetainedPublication`, le chemin des réparations
 *    relues), puis passe par la même chaîne et la même preuve qu'à l'ingestion (`publication/countryProof.ts`) : le stock
 *    reçoit exactement ce que la prochaine observation écrirait. Le fichier dit, pour chaque offre résolue, le pays, la
 *    subdivision et le motif ; pour chaque offre restante, sa cause.
 *  - Application (`resoudre-pays --apply --plan=<fichier relu>`) : l'aperçu est recalculé et la commande refuse, sans rien
 *    écrire, s'il diffère du fichier relu (REVIEWED_PLAN_MISMATCH). Elle n'écrit que le pays, sa provenance et la
 *    subdivision, sur l'offre ET sur la présentation de sa publication canonique (que la ré-attestation d'une autre
 *    publication recopie), et seulement si l'offre est toujours sans pays et la publication inchangée depuis l'aperçu. Une
 *    correction par offre au journal (`DataCorrection`), et l'événement CHANGED du pays. Les déclencheurs posent ensuite la
 *    ville et le point de proximité (D-496) et remettent l'offre en file d'indexation.
 *
 * Jamais pendant le RUN de 18 h. À appliquer APRÈS la livraison du code (sinon la première observation suivante, par
 * l'ancien code, effacerait le pays écrit).
 */
export const RATTRAPAGE_PAYS_KIND = 'rattrapage-pays/1';
export const RATTRAPAGE_PAYS_FINDING = 'D-520_OFFRE_SANS_PAYS';

/** `LECTURE_NATIVE` : le lecteur d'aujourd'hui lit un champ pays natif que l'ancien ignorait (bureau Greenhouse). */
export type MotifRattrapage = MotifPays | 'LECTURE_NATIVE';
/** `PUBLICATION_ILLISIBLE` : le RAW de la publication canonique ne se relit plus ; rien n'est déduit. */
export type CauseRattrapage = CauseSansPays | 'PUBLICATION_ILLISIBLE';

type Pays = { countryCode: string | null; countryIntegrity: string | null; adminArea1: string | null };
export type ResolutionPays = {
  jobId: string; sourceId: string; sourceKey: string; externalId: string; inputHash: string;
  lieu: string | null; ville: string | null; latitude: number | null; longitude: number | null;
  avant: Pays; apres: Pays & { countryCode: string }; motif: MotifRattrapage; marche: readonly string[];
};
export type RestantSansPays = { jobId: string; sourceKey: string; lieu: string | null; ville: string | null; cause: CauseRattrapage; detail?: string };
export type ApercuRattrapagePays = {
  kind: typeof RATTRAPAGE_PAYS_KIND; observedAt: string;
  resolutions: ResolutionPays[]; restants: RestantSansPays[];
  parMotif: Record<string, number>; parCause: Record<string, number>; empreinte: string;
};

type Ligne = {
  jobId: string; countryCode: string | null; countryIntegrity: string | null; adminArea1: string | null; city: string | null;
  sourceId: string; sourceKey: string; externalId: string; url: string; sourceTier: string; lastSeenAt: Date;
  raw: Prisma.JsonValue; presentation: Prisma.JsonValue; captureBatchId: string | null; captureOutputId: string | null;
  kind: string; config: Prisma.JsonValue; company: string;
};

const LIGNES_SQL = Prisma.sql`
  SELECT j."id" AS "jobId", j."countryCode", j."countryIntegrity", j."adminArea1", j."city",
         s."id" AS "sourceId", s."sourceKey", s."externalId", s."url", s."sourceTier", s."lastSeenAt", s."raw", s."presentation",
         s."captureBatchId", s."captureOutputId", src."kind", src."config", c."name" AS "company"
    FROM "Job" j
    JOIN "JobSource" s ON s."jobId" = j."id" AND s."sourceKey" = j."canonicalSourceKey" AND s."externalId" = j."canonicalExternalId"
    JOIN "Source" src ON src."key" = s."sourceKey"
    JOIN "Company" c ON c."id" = j."companyId"
   WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NULL
   ORDER BY j."id"`;

const compter = (valeurs: string[]) => Object.fromEntries([...valeurs.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));

/** Ce que la relecture fige : quelles offres, depuis quelle publication et quelle entrée, reçoivent quoi. */
export const empreinteRattrapage = (resolutions: readonly ResolutionPays[]) =>
  evidenceHash([...resolutions].map((r) => [r.jobId, r.sourceId, r.inputHash, r.apres.countryCode, r.apres.countryIntegrity, r.apres.adminArea1, r.motif])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

const inputHashOf = (presentation: Prisma.JsonValue) =>
  presentation && typeof presentation === 'object' && !Array.isArray(presentation) && typeof presentation.inputHash === 'string' ? presentation.inputHash : null;

/** Aperçu : rien n'est écrit ; le fichier rendu est celui qu'on relit, puis qu'on applique. */
export async function previewRattrapagePays(db: Lecteur, now = new Date()): Promise<ApercuRattrapagePays> {
  const lignes = await db.$queryRaw<Ligne[]>(LIGNES_SQL);
  const trustRows = await db.sourceFieldTrust.findMany({ select: { source: true, path: true, dimension: true, level: true } });
  const trust = new Map(trustRows.map((row) => [`${row.source} ${row.path} ${row.dimension}`, row.level]));
  const frontieres = chargerFrontieres(), marches: MemoireMarches = new Map();
  const resolutions: ResolutionPays[] = [], restants: RestantSansPays[] = [];
  for (const l of lignes) {
    const lieuStocke = { jobId: l.jobId, sourceKey: l.sourceKey, ville: l.city };
    const inputHash = inputHashOf(l.presentation);
    const recovered = recoverRetainedPublication(l.kind, l.raw, { externalId: l.externalId, url: l.url, observedAt: l.lastSeenAt,
      config: (l.config ?? {}) as Record<string, unknown> });
    if (recovered.status !== 'RECOVERABLE' || !inputHash) {
      restants.push({ ...lieuStocke, lieu: null, cause: 'PUBLICATION_ILLISIBLE', detail: recovered.status === 'RECOVERABLE' ? 'PRESENTATION_MISSING' : recovered.reason });
      continue;
    }
    const atsType = KIND_TO_ATS[l.kind] as AtsType;
    let candidate;
    try {
      const facts = readSourceFacts(atsType, l.raw);
      candidate = { ...toCandidate(recovered.job, { key: l.sourceKey, tier: l.sourceTier as SourceTier, company: l.company }, l.company, atsType, trust),
        captureBatchId: l.captureBatchId ?? undefined, captureOutputId: l.captureOutputId ?? undefined, ...projectSourceFacts(facts), sourceFacts: facts };
    } catch (error) {
      restants.push({ ...lieuStocke, lieu: recovered.job.location ?? null, cause: 'PUBLICATION_ILLISIBLE', detail: (error as Error).message.slice(0, 200) });
      continue;
    }
    const lieu = candidate.location ?? null;
    const status = countryChainStatus(candidate);
    const preuve = status === 'DECIDED' ? undefined : await countryProofOf(db, candidate, frontieres, marches);
    const apres = publicationCountry({ ...candidate, paysParPreuve: preuve });
    if (!apres.countryCode) {
      const cause: CauseRattrapage = preuve && preuve.pays === null ? preuve.cause : 'CONTRADICTION_DECLAREE';
      restants.push({ ...lieuStocke, lieu, cause });
      continue;
    }
    resolutions.push({ jobId: l.jobId, sourceId: l.sourceId, sourceKey: l.sourceKey, externalId: l.externalId, inputHash, lieu, ville: l.city,
      latitude: candidate.latitude ?? null, longitude: candidate.longitude ?? null,
      avant: { countryCode: l.countryCode, countryIntegrity: l.countryIntegrity, adminArea1: l.adminArea1 },
      apres: { ...apres, countryCode: apres.countryCode },
      motif: status === 'DECIDED' ? 'LECTURE_NATIVE' : preuve && preuve.pays ? preuve.motif : 'LECTURE_NATIVE',
      marche: preuve && preuve.pays ? preuve.marche : [] });
  }
  return { kind: RATTRAPAGE_PAYS_KIND, observedAt: now.toISOString(), resolutions, restants,
    parMotif: compter(resolutions.map((r) => r.motif)),
    parCause: compter(restants.map((r) => r.cause)), empreinte: empreinteRattrapage(resolutions) };
}

const LOT = 100;

/** N'applique QUE le fichier relu, et refuse sans rien écrire si l'aperçu recalculé en diffère. */
export async function applyRattrapagePays(db: PrismaClient, reviewed: ApercuRattrapagePays) {
  if (reviewed?.kind !== RATTRAPAGE_PAYS_KIND || !Array.isArray(reviewed.resolutions) || typeof reviewed.empreinte !== 'string') {
    throw new Error(`REVIEWED_PLAN_INVALID: a ${RATTRAPAGE_PAYS_KIND} preview file is required`);
  }
  if (empreinteRattrapage(reviewed.resolutions) !== reviewed.empreinte) throw new Error('REVIEWED_PLAN_INVALID: the file was edited after its preview');
  const now = await previewRattrapagePays(db);
  if (now.empreinte !== reviewed.empreinte) {
    throw new Error(`REVIEWED_PLAN_MISMATCH: the recomputed resolutions differ from the reviewed file (${now.resolutions.length} now, ${reviewed.resolutions.length} reviewed); preview again`);
  }
  const batchId = randomUUID(), commitHash = deployedCommitHash(), at = new Date();
  let applied = 0, skipped = 0;
  for (let i = 0; i < reviewed.resolutions.length; i += LOT) {
    const lot = reviewed.resolutions.slice(i, i + LOT);
    await db.$transaction(async (tx) => {
      // Le même verrou que l'ingestion de la source : aucune observation concurrente ne réécrit l'offre pendant le lot.
      for (const key of [...new Set(lot.map((r) => r.sourceKey))].sort()) await lockSourceWrites(tx, key);
      for (const r of lot) {
        const written = await tx.$executeRaw`
          UPDATE "JobSource" SET "presentation" = jsonb_set(jsonb_set(jsonb_set("presentation",
              '{values,countryCode}', to_jsonb(${r.apres.countryCode}::text)),
              '{values,countryIntegrity}', coalesce(to_jsonb(${r.apres.countryIntegrity}::text), 'null'::jsonb)),
              '{values,adminArea1}', coalesce(to_jsonb(${r.apres.adminArea1}::text), 'null'::jsonb))
           WHERE "id" = ${r.sourceId} AND "jobId" = ${r.jobId} AND "presentation"->>'inputHash' = ${r.inputHash}
             AND "presentation"->'values'->>'countryCode' IS NULL
             AND EXISTS (SELECT 1 FROM "Job" j WHERE j."id" = ${r.jobId} AND j."countryCode" IS NULL AND j."isActive" AND j."mergedIntoId" IS NULL
               AND j."canonicalSourceKey" = ${r.sourceKey} AND j."canonicalExternalId" = ${r.externalId})`;
        if (written !== 1) { skipped++; continue; }
        await tx.$executeRaw`UPDATE "Job" SET "countryCode" = ${r.apres.countryCode}, "countryIntegrity" = ${r.apres.countryIntegrity},
          "adminArea1" = ${r.apres.adminArea1} WHERE "id" = ${r.jobId}`;
        await tx.jobEvent.createMany({ data: changedEvents(r.jobId, [{ field: 'country', before: null, after: r.apres.countryCode }], at).map(toEventRow) });
        await recordDataCorrection(tx, { id: randomUUID(), batchId, planHash: reviewed.empreinte, commitHash, finding: RATTRAPAGE_PAYS_FINDING,
          entityType: 'Job', entityId: r.jobId, before: r.avant, after: r.apres,
          evidence: { motif: r.motif, sourceId: r.sourceId, inputHash: r.inputHash, lieu: r.lieu, ville: r.ville, point: [r.latitude, r.longitude], marche: r.marche } });
        applied++;
      }
    }, { timeout: 120_000, maxWait: 30_000 });
  }
  return { batchId, planHash: reviewed.empreinte, resolutions: reviewed.resolutions.length, applied, skipped };
}

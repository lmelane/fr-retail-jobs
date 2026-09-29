/**
 * REJOUER LE RÉSOLVEUR D'IDENTITÉ sur les offres refusées — lecture seule, transaction annulée.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/rejouer-identite.mts --sources=b-s-international,funky-buddha [--heures=48]
 *
 * Après une décision d'identité (alias relu, fusion, périmètre de portail), la preuve qu'elle débloque le RUN ne doit
 * pas attendre le RUN suivant : ce programme reprend, pour chaque source, les offres refusées (`job.write_failed`,
 * `EmployerIdentityReviewRequired`) sur la fenêtre, et appelle `resolveEmployer` — la fonction même de l'écriture
 * (`dedup/upsert.ts`) — avec le libellé et l'origine qu'elles portaient. Il rend, par source, le nombre d'offres
 * désormais résolues, leur règle et leur employeur, et les refus qui subsistent avec leur motif.
 *
 * Il ne rejoue que l'identité : le libellé natif et son origine sont repris de l'événement, pas recapturés. Une
 * offre dont l'employeur vient du registre (`SOURCE_CATALOGUE_LABEL`) n'a pas de libellé natif dans l'événement :
 * elle est rejouée avec l'origine de registre.
 *
 * La transaction est ouverte `READ ONLY` et annulée à la fin : `resolveEmployer` ne fait que lire.
 */
import { PrismaClient } from '@prisma/client';
import { resolveEmployer } from '../../src/identity/resolve.js';
import { EmployerIdentityReviewRequired } from '../../src/identity/errors.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const sources = (arg('sources') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const heures = Number(arg('heures') ?? 48);
if (!sources.length || !Number.isFinite(heures) || heures <= 0) {
  console.error('usage: rejouer-identite.mts --sources=<clé,clé> [--heures=48]');
  process.exit(2);
}

type Refus = { sourceKey: string; externalId: string; raw: string | null; motif: string | null; origin: string | null };
const prisma = new PrismaClient({ log: [] });
class Annulation extends Error {}
const bilan: Record<string, { refusesAvant: number; resolues: Record<string, number>; refusRestants: Record<string, number>; exemples: string[] }> = {};

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const refus = await tx.$queryRawUnsafe<Refus[]>(`
      SELECT DISTINCT ON (e."sourceKey", e.payload->'error'->>'externalId')
             e."sourceKey", e.payload->'error'->>'externalId' AS "externalId", e.payload->'error'->>'rawEmployerName' AS raw,
             e.payload->'error'->>'motif' AS motif, e.payload->>'employerLabelOrigin' AS origin
        FROM "PipelineEvent" e
       WHERE e.event = 'job.write_failed' AND e.payload->'error'->>'name' = 'EmployerIdentityReviewRequired'
         AND e."sourceKey" = ANY($1::text[]) AND e.at > now() - make_interval(hours => $2::int)
       ORDER BY e."sourceKey", e.payload->'error'->>'externalId', e.at DESC`, sources, heures);
    for (const r of refus) {
      const b = (bilan[r.sourceKey] ??= { refusesAvant: 0, resolues: {}, refusRestants: {}, exemples: [] });
      b.refusesAvant++;
      const portail = r.motif === 'PORTAL_OWNER_NOT_CERTIFIED';
      const candidat = {
        sourceKey: r.sourceKey, externalId: r.externalId, title: '', url: '', raw: null,
        company: r.raw ?? '', companyId: '',
        ...(portail ? { employerLabelOrigin: 'SOURCE_CATALOGUE_LABEL' } : { rawEmployerName: r.raw ?? '', employerLabelOrigin: r.origin ?? 'ADAPTER_COMPANY' }),
      };
      try {
        const res = await resolveEmployer(tx, candidat as never);
        const cle = `${res.rule} → ${res.company?.name ?? res.newName ?? '(nouvel employeur)'}`;
        b.resolues[cle] = (b.resolues[cle] ?? 0) + 1;
      } catch (error) {
        const motif = error instanceof EmployerIdentityReviewRequired ? error.motif : `ERREUR ${(error as Error).name}`;
        b.refusRestants[motif] = (b.refusRestants[motif] ?? 0) + 1;
        if (b.exemples.length < 3) b.exemples.push(`${r.externalId}: ${(error as Error).message.slice(0, 200)}`);
      }
    }
    throw new Annulation();
  }, { timeout: 120_000 });
} catch (error) {
  if (!(error instanceof Annulation)) throw error;
} finally {
  await prisma.$disconnect();
}
console.log(JSON.stringify({ fenetreHeures: heures, bilan }, null, 1));

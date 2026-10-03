/**
 * D-522 §6 — LES OFFRES ACTIVES QUE LES VARIANTES MESURÉES DE D-511 / D-512 RETIENDRAIENT — lecture seule.
 *
 *   CATWALKS_DB_ACCESS=… python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-10-03/stock-exceptions/workday-marques/mesure-vocabulaire.mts
 *
 * Préfiltre SQL large sur l'intitulé des représentations actives (`JobSource.isActive`), puis la règle de production
 * (`spontaneousApplicationProof`) avec le lieu, la ville, le pays et la Maison de l'offre. Une offre bascule quand la
 * preuve rendue porte l'un des deux libellés ajoutés. Rien n'est écrit.
 */
import { PrismaClient } from '@prisma/client';
import { spontaneousApplicationProof } from '../../../../apps/aggregator/src/pipeline/spontaneousApplication.js';

const NOUVEAUX = new Set(['send us your CV', 'banco de talentos']);
const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.$queryRawUnsafe<Array<{ sourceKey: string; title: string; location: string | null; city: string | null; country: string | null; company: string }>>(
    `SELECT s."sourceKey", s.title, j.location, j.city, j."countryCode" AS country, c.name AS company
       FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId" JOIN "Company" c ON c.id = j."companyId"
      WHERE s."isActive" AND s.title ~* '(send us your|inviaci il tuo|(banco|base|comunidad) de talento)'`);
  const bascule = rows.flatMap((r) => {
    const proof = spontaneousApplicationProof({ title: r.title, location: r.location ?? undefined, city: r.city ?? undefined, country: r.country ?? undefined, company: r.company });
    return proof && 'label' in proof && NOUVEAUX.has(proof.label) ? [{ ...r, preuve: proof }] : [];
  });
  const parSource: Record<string, number> = {};
  for (const b of bascule) parSource[b.sourceKey] = (parSource[b.sourceKey] ?? 0) + 1;
  console.log(JSON.stringify({ candidatesPrefiltre: rows.length, bascule: bascule.length, parSource,
    restentPubliees: rows.length - bascule.length,
    detail: bascule.map((b) => ({ source: b.sourceKey, titre: b.title, preuve: b.preuve })) }, null, 1));
} finally { await prisma.$disconnect(); }

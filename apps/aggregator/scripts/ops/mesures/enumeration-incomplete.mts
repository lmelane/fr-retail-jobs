/**
 * POURQUOI UNE ÉNUMÉRATION EST DÉCLARÉE INCOMPLÈTE — la raison exacte, pas le verdict.
 *
 * `ENUMERATION_INCOMPLETE` dit qu'on ne peut pas attester avoir vu toute l'offre. Deux causes
 * très différentes se cachent derrière ce même mot :
 *
 *   DÉFAUT DE NOTRE CODE   la source expose bien une continuation, notre adaptateur ne la suit
 *                          pas (ou perd de l'information en route) → correction ciblée.
 *   SOURCE NON EXHAUSTIVE  la source elle-même ne permet pas de prouver l'exhaustivité
 *                          (pas de total déclaré, pagination plafonnée…) → blocker final.
 *
 * Le seul moyen de trancher est de lire ce que la capture a RÉELLEMENT enregistré : le total
 * déclaré par la source, le nombre de pages parcourues, la cause de terminaison, les blocages
 * nommés par l'adaptateur, et la progression réelle page par page.
 */
import { PrismaClient } from '@prisma/client';
import { readExtractionManifest } from '../../../src/capture/manifest.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

for (const cle of process.argv.slice(2)) {
  const [b] = await p.$queryRawUnsafe<Array<{ id: string; sourceKind: string; extractedCount: number }>>(`
    SELECT b.id, b."sourceKind", o."extractedCount"
      FROM "CaptureBatch" b
      JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
     WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS'
     ORDER BY b."startedAt" DESC LIMIT 1`, cle);
  if (!b) { console.log(`\n── ${cle} : aucun lot EXTRACTED`); continue; }

  const manifest = await readExtractionManifest(p, b.id);
  const m = manifest.metadata as Record<string, any>;
  const e = (m.enumeration ?? {}) as Record<string, any>;

  console.log(`\n── ${cle} (${b.sourceKind})`);
  console.log(`   offres retenues      : ${b.extractedCount}`);
  console.log(`   complete / truncated : ${m.complete} / ${m.truncated}`);
  /* Le total DÉCLARÉ PAR LA SOURCE : c'est lui qui rend l'exhaustivité prouvable ou non. */
  console.log(`   total déclaré source : ${m.declaredTotal ?? e.declaredTotal ?? '(aucun)'}`);
  console.log(`   pages parcourues     : ${e.pages ?? '?'}`);
  console.log(`   lignes brutes vues   : ${e.rawCount ?? '?'}`);
  console.log(`   terminaison          : ${e.termination ?? '?'}`);
  console.log(`   blocages nommés      : ${JSON.stringify(e.blockers ?? [])}`);
  console.log(`   traversée complète   : ${e.enumerationTraversalComplete ?? '(non renseigné)'}`);
  console.log(`   absence exploitable  : ${e.canonicalAbsenceProofUsable ?? '(non renseigné)'}`);
  if (Array.isArray(e.scopes) && e.scopes.length) {
    console.log(`   périmètres :`);
    for (const s of e.scopes) {
      console.log(`     ${s.scope} — déclaré ${s.declaredTotal}, vus ${s.uniqueIds}, ${s.pages} page(s), complet ${s.complete}`);
    }
  }
  /*
   * La PROGRESSION page par page. Une continuation abandonnée se voit ici : la dernière page
   * rend encore des identifiants alors que le parcours s'arrête — signe que la suite existait.
   */
  if (Array.isArray(e.pageEvidence) && e.pageEvidence.length) {
    const pe = e.pageEvidence;
    console.log(`   preuves de page      : ${pe.length}`);
    for (const [i, page] of pe.slice(-3).entries()) {
      const rang = pe.length - Math.min(3, pe.length) + i;
      console.log(`     [${rang}] offset ${page.offset} · ${page.ids?.length ?? 0} id(s) · pagination ${JSON.stringify(page.pagination)}`);
    }
  }
  const rejets = (m.rejectedRows ?? []) as Array<{ reason: string }>;
  if (rejets.length) {
    const parMotif = new Map<string, number>();
    for (const r of rejets) parMotif.set(r.reason, (parMotif.get(r.reason) ?? 0) + 1);
    console.log(`   lignes rejetées      : ${rejets.length} — ${[...parMotif].map(([k, v]) => `${k}×${v}`).join(', ')}`);
    /* Un motif sans exemple ne se diagnostique pas : on montre une ligne réelle par motif. */
    for (const motif of parMotif.keys()) {
      const exemple = rejets.find(r => r.reason === motif);
      console.log(`     ${motif} → ${JSON.stringify(exemple).slice(0, 200)}`);
    }
  } else {
    console.log(`   lignes rejetées      : 0 (aucune ligne nommée par l'adaptateur)`);
  }
}

await p.$disconnect();

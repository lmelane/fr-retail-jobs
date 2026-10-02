/**
 * D-512 — PASSAGE À BLANC : les offres publiques qu'une collecte retirerait comme viviers sans poste, et les viviers
 * conservés parce qu'ils nomment un poste.
 *
 * Aucune connexion à une base. L'entrée est l'export en lecture seule `audits/2026-10-02/d512-viviers/export.sql` (un
 * sur-ensemble filtré par la base : tout intitulé qui contient talent, futur, interest, vivier ou bolsa). La sortie
 * applique la règle de la collecte, `spontaneousApplicationProof`, à l'intitulé brut (`rawTitle`, celui que l'adaptateur
 * rend, avant le nettoyage de l'écriture), et au type natif ; l'intitulé de la source et l'intitulé publié sont lus aussi,
 * et une divergence entre les trois est signalée.
 *
 *   npx tsx apps/aggregator/scripts/ops/mesures/d512-viviers-a-blanc.mts <viviers.jsonl> > a-blanc.json
 *
 * Limites : la règle s'applique à la sortie de l'adaptateur (intitulé, lieu, Maison), ici approchée par ce que la base a gardé ; le retrait n'a
 * lieu qu'à la prochaine collecte admise de la source (une source en pause ne retire rien).
 */
import { readFileSync } from 'node:fs';
import { spontaneousApplicationProof, talentPoolReading } from '../../../src/pipeline/spontaneousApplication.js';

type Row = { jobId: string; sourceKey: string; externalId: string; sourceStatus: string; sourceTitle: string | null; jobTitle: string;
  rawTitle: string | null; opportunityType: 'JOB_OPENING' | 'OPEN_APPLICATION' | null; url: string; company: string; availableSources: number;
  location: string | null; city: string | null; countryCode: string | null };

const path = process.argv[2];
if (!path) throw new Error('usage: d512-viviers-a-blanc.mts <viviers.jsonl>');
const rows: Row[] = readFileSync(path, 'utf8').split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));

const retires: Record<string, unknown>[] = [];
const conserves: Record<string, unknown>[] = [];
const spontanees: Record<string, unknown>[] = [];
const divergences: Record<string, unknown>[] = [];
for (const row of rows) {
  const opportunityType = row.opportunityType ?? undefined;
  const titles = [row.sourceTitle, row.rawTitle, row.jobTitle];
  // Le lieu et la Maison de l'offre, tels que la base les garde (approchent ceux que l'adaptateur rend).
  const context = { company: row.company, location: row.location ?? undefined, city: row.city ?? undefined, country: row.countryCode ?? undefined };
  const proofs = titles.map(title => title ? spontaneousApplicationProof({ title, opportunityType, ...context }) : null);
  if (new Set(proofs.map(p => p?.kind ?? null)).size > 1) divergences.push({ sourceKey: row.sourceKey, externalId: row.externalId, sourceTitle: row.sourceTitle, rawTitle: row.rawTitle, jobTitle: row.jobTitle, preuves: proofs.map(p => p?.kind ?? null) });
  // L'adaptateur rend l'intitulé AVANT le nettoyage de l'écriture : `rawTitle` (vide pour un historique sans brut).
  const proof = row.rawTitle ? proofs[1] : proofs[0] ?? proofs[2];
  const title = row.rawTitle ?? row.sourceTitle ?? row.jobTitle;
  const base = { sourceKey: row.sourceKey, sourceStatus: row.sourceStatus, externalId: row.externalId, jobId: row.jobId, company: row.company, title,
    lieu: row.location, autresSourcesDisponibles: row.availableSources - 1, url: row.url };
  if (proof?.kind === 'TALENT_POOL') { retires.push({ ...base, motif: proof.label, reste: proof.remainder }); continue; }
  if (proof) { spontanees.push({ ...base, preuve: proof.kind }); continue; }
  const reading = talentPoolReading(title, context);
  if (reading) conserves.push({ ...base, motif: reading.label, reste: reading.remainder });
}
const order = (a: any, b: any) => a.sourceKey.localeCompare(b.sourceKey) || a.title.localeCompare(b.title);
retires.sort(order); conserves.sort(order);
const count = (list: Record<string, unknown>[], key: string) => {
  const out: Record<string, number> = {};
  for (const item of list) out[String(item[key])] = (out[String(item[key])] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
};
console.log(JSON.stringify({
  publicationsLues: rows.length,
  retires: { publications: retires.length, offresDistinctes: new Set(retires.map(r => r.jobId)).size,
    dontSourceActive: retires.filter(r => r.sourceStatus === 'ACTIVE').length,
    portesAussiParUneAutreSource: retires.filter(r => (r.autresSourcesDisponibles as number) > 0).length,
    parMotif: count(retires, 'motif'), parSource: count(retires, 'sourceKey') },
  conserves: { publications: conserves.length, offresDistinctes: new Set(conserves.map(r => r.jobId)).size, parMotif: count(conserves, 'motif'), parSource: count(conserves, 'sourceKey') },
  candidaturesSpontaneesD511DansLExport: spontanees.length,
  divergences,
  listeRetires: retires,
  listeConserves: conserves,
}, null, 2));

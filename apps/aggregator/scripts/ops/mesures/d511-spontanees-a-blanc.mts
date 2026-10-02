/**
 * D-511 — PASSAGE À BLANC : les offres publiques qu'une collecte retirerait comme candidatures spontanées.
 *
 * Aucune connexion à une base. L'entrée est l'export en lecture seule des représentations publiques
 * (`audits/2026-10-02/d511-candidatures-spontanees/export.sql`, une ligne JSON par publication disponible) ; la sortie
 * applique la règle de la collecte, `spontaneousApplicationProof`, à l'intitulé de la source (celui que l'adaptateur
 * lit), à l'intitulé brut et à l'intitulé publié, et au type natif. Une divergence entre ces intitulés est signalée.
 *
 *   npx tsx apps/aggregator/scripts/ops/mesures/d511-spontanees-a-blanc.mts <publiques.jsonl> > a-blanc.json
 *
 * Limites : la règle s'applique à la sortie de l'adaptateur, ici approchée par ce que la base a gardé ; le retrait
 * n'a lieu qu'à la prochaine collecte admise de la source (une source en pause ne retire rien).
 */
import { readFileSync } from 'node:fs';
import { spontaneousApplicationProof } from '../../../src/pipeline/spontaneousApplication.js';

type Row = { jobId: string; sourceKey: string; externalId: string; sourceStatus: string; sourceTitle: string | null; jobTitle: string;
  rawTitle: string | null; opportunityType: 'JOB_OPENING' | 'OPEN_APPLICATION' | null; url: string; company: string; availableSources: number };

const path = process.argv[2];
if (!path) throw new Error('usage: d511-spontanees-a-blanc.mts <publiques.jsonl>');
const rows: Row[] = readFileSync(path, 'utf8').split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));

type Retenue = { sourceKey: string; sourceStatus: string; externalId: string; jobId: string; company: string; title: string;
  preuve: string; autresSourcesDisponibles: number; url: string };
const retenues: Retenue[] = [];
const divergences: Record<string, unknown>[] = [];
for (const row of rows) {
  const opportunityType = row.opportunityType ?? undefined;
  const proofs = [row.sourceTitle, row.rawTitle, row.jobTitle].map(title => title ? spontaneousApplicationProof({ title, opportunityType }) : null);
  const proof = proofs[0] ?? proofs[1];
  if (!proof && !proofs[2]) continue;
  if (new Set(proofs.map(p => !!p)).size > 1) divergences.push({ sourceKey: row.sourceKey, externalId: row.externalId, sourceTitle: row.sourceTitle, rawTitle: row.rawTitle, jobTitle: row.jobTitle });
  if (!proof) continue;
  retenues.push({ sourceKey: row.sourceKey, sourceStatus: row.sourceStatus, externalId: row.externalId, jobId: row.jobId, company: row.company,
    title: row.sourceTitle ?? row.jobTitle, preuve: proof.kind === 'NATIVE_FIELD' ? `${proof.path}=${proof.value}` : `libellé « ${proof.label} » (segment « ${proof.segment} »)`,
    autresSourcesDisponibles: row.availableSources - 1, url: row.url });
}
retenues.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey) || a.title.localeCompare(b.title));
const parSource: Record<string, { offres: number; statut: string }> = {};
for (const r of retenues) parSource[r.sourceKey] = { offres: (parSource[r.sourceKey]?.offres ?? 0) + 1, statut: r.sourceStatus };
/**
 * Les cas voisins, HORS de la règle et à arbitrer (D-511) : viviers et « opportunités futures ». Comptés ici pour que le
 * chiffre écrit se recompte ; leur classement « poste nommé ou non » se lit à la main dans `liste`.
 */
const VOISINS: Record<string, RegExp> = {
  'talent pool / community / network': /talent\s+(?:pool|community|network)/i,
  'future opportunities': /future\s+opportunit/i,
  'expression of interest / express interest': /express(?:ion)?\s+(?:of\s+)?interest/i,
  'register your interest': /register\s+your\s+interest/i,
  'vivier': /(?<!roger\s)\bvivier\b/i,
};
const voisins = rows.filter(row => !retenues.some(r => r.jobId === row.jobId))
  .flatMap(row => { const title = row.sourceTitle ?? row.jobTitle; const motif = Object.keys(VOISINS).find(k => VOISINS[k].test(title));
    return motif ? [{ sourceKey: row.sourceKey, sourceStatus: row.sourceStatus, motif, title, url: row.url }] : []; })
  .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey) || a.title.localeCompare(b.title));
const voisinsParMotif: Record<string, number> = {};
for (const v of voisins) voisinsParMotif[v.motif] = (voisinsParMotif[v.motif] ?? 0) + 1;

console.log(JSON.stringify({
  publicationsLues: rows.length,
  retenues: retenues.length,
  offresDistinctes: new Set(retenues.map(r => r.jobId)).size,
  dontSourceActive: retenues.filter(r => r.sourceStatus === 'ACTIVE').length,
  parSource, divergences, liste: retenues,
  voisinsHorsRegle: { total: voisins.length, parMotif: voisinsParMotif, liste: voisins },
}, null, 2));

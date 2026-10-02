/**
 * D-515 §3 — REJEU HORS LIGNE de la reconnaissance du contrat sur l'échantillon servi (1 offre sur 8, `echantillon.sql`),
 * avec le code d'une révision donnée de l'agrégateur. Aucune base n'est touchée.
 *
 *   npx tsx audits/2026-10-02/alertes-deux-temps/rejeu-contrat-marche.mts <racine du code> <echantillon.jsonl> <sortie.json>
 *
 * Même chemin que l'ingestion (`resolveCanonicalDimensions`), mêmes entrées que `r143-filtres-alertes/rejeu-contrat.mts`,
 * plus le décodage du format texte de COPY (les barres obliques inverses doublées) et l'origine de la décision de durée.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [racine, entree, sortie] = process.argv.slice(2);
const { resolveCanonicalDimensions } = await import(pathToFileURL(join(racine, 'apps/aggregator/src/trust/resolve.ts')).href);
const wttj = await import(pathToFileURL(join(racine, 'apps/aggregator/src/ats/adapters/wttj.ts')).href);
const contratWttj: ((v?: string) => string | undefined) | undefined = wttj.contratWttj;

type Ligne = { id: string; marche: string; fournisseur: string; sourceKey: string; title: string; description: string | null;
  contract: string | null; workingTime: string | null; raw: any; employmentTerm: string | null };
const resultats: Record<string, { marche: string; fournisseur: string; stocke: string | null; employmentTerm: string | null; origine: string;
  programType: string | null; engagementType: string | null; workTime: string | null }> = {};
for (const brut of readFileSync(entree, 'utf8').split('\n')) {
  if (!brut.trim()) continue;
  const l = JSON.parse(brut.replace(/\\\\/g, '\\')) as Ligne;
  const estWttj = l.fournisseur === 'wttj' || l.fournisseur === 'wttj-sector';
  const contract = estWttj && contratWttj && typeof l.raw?.contract_type === 'string' ? contratWttj(l.raw.contract_type) : l.contract;
  const r = resolveCanonicalDimensions({ sourceKey: l.sourceKey, title: l.title, description: l.description, contract, workingTime: l.workingTime, raw: l.raw });
  resultats[l.id] = { marche: l.marche, fournisseur: l.fournisseur, stocke: l.employmentTerm, employmentTerm: r.employmentTerm ?? null,
    origine: r.decisions?.employmentTerm?.origin ?? '?', programType: r.programType ?? null, engagementType: r.engagementType ?? null, workTime: r.workTime ?? null };
}
writeFileSync(sortie, JSON.stringify(resultats));
console.log(`${Object.keys(resultats).length} offres rejouées → ${sortie}`);

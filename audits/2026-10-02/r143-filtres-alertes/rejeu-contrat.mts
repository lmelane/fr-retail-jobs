/**
 * R-143 §6 — REJEU HORS LIGNE de la reconnaissance du contrat sur un échantillon d'offres servies (1 sur 8, extrait en
 * lecture seule par `echantillon.sql`), avec le code d'une révision donnée de l'agrégateur. Aucune base n'est touchée.
 *
 *   npx tsx audits/2026-10-02/r143-filtres-alertes/rejeu-contrat.mts <racine du code> <echantillon.jsonl> <sortie.json>
 *
 * La même fonction que l'ingestion (`resolveCanonicalDimensions`), les mêmes entrées : l'intitulé brut, la description
 * en texte, le contrat et le temps de travail de l'adaptateur, le RAW de la publication propriétaire. Pour WTTJ, le
 * contrat de l'adaptateur est relu depuis le RAW (`contratWttj`, quand la révision l'exporte). Table de confiance :
 * vide en production le 02/10 (0 verdict), donc la priorité par défaut.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [racine, entree, sortie] = process.argv.slice(2);
const { resolveCanonicalDimensions } = await import(pathToFileURL(join(racine, 'apps/aggregator/src/trust/resolve.ts')).href);
const wttj = await import(pathToFileURL(join(racine, 'apps/aggregator/src/ats/adapters/wttj.ts')).href);
const contratWttj: ((v?: string) => string | undefined) | undefined = wttj.contratWttj;

type Ligne = { id: string; marche: string; fournisseur: string; sourceKey: string; title: string; description: string | null;
  contract: string | null; workingTime: string | null; raw: any };
const resultats: Record<string, { marche: string; fournisseur: string; employmentTerm: string | null; programType: string | null; engagementType: string | null; workTime: string | null }> = {};
for (const brut of readFileSync(entree, 'utf8').split('\n')) {
  if (!brut.trim()) continue;
  const l = JSON.parse(brut) as Ligne;
  const estWttj = l.fournisseur === 'wttj' || l.fournisseur === 'wttj-sector';
  const contract = estWttj && contratWttj && typeof l.raw?.contract_type === 'string' ? contratWttj(l.raw.contract_type) : l.contract;
  const r = resolveCanonicalDimensions({ sourceKey: l.sourceKey, title: l.title, description: l.description, contract, workingTime: l.workingTime, raw: l.raw });
  resultats[l.id] = { marche: l.marche, fournisseur: l.fournisseur, employmentTerm: r.employmentTerm ?? null, programType: r.programType ?? null,
    engagementType: r.engagementType ?? null, workTime: r.workTime ?? null };
}
writeFileSync(sortie, JSON.stringify(resultats));
console.log(`${Object.keys(resultats).length} offres rejouées → ${sortie}`);

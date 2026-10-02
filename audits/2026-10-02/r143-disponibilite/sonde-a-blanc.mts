/**
 * R-143 §2 — la sonde des liens « Postuler » À BLANC : le code réel de la sonde (`readApplyPage`, `calibrate`, au plus
 * 2 requêtes par seconde, 10 s, identité du collecteur, périmètre d'accès revu de chaque source), sur un échantillon des
 * cibles exportées par `sonde-cibles.sql` (lecture seule de la production). Aucune écriture : ni base, ni retenue.
 *
 * Usage (racine d'un arbre de l'agrégateur) :
 *   npx tsx audits/2026-10-02/r143-disponibilite/sonde-a-blanc.mts <cibles.json> > audits/2026-10-02/r143-disponibilite/sonde-a-blanc.json
 * Échantillon déterministe : par source, les cibles les plus anciennes d'abord, au plus PAR_SOURCE.
 */
import { readFileSync } from 'node:fs';
import { calibrate, rateLimiter, readApplyPage, PROBE_MAX_REQUESTS_PER_SECOND, type ProbeReading } from '../../../apps/aggregator/src/pipeline/applyLinkProbe.ts';

const PAR_SOURCE = 12;
type Export = { cibles: { id: string; sourceKey: string; url: string; lastSeenAt: string }[]; temoins: Record<string, string>;
  acces: Record<string, { verdict: string; scopes: unknown }> };
const data = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Export;
const bySource = new Map<string, Export['cibles']>();
for (const cible of data.cibles) bySource.set(cible.sourceKey, [...(bySource.get(cible.sourceKey) ?? []), cible]);
const acquire = rateLimiter(PROBE_MAX_REQUESTS_PER_SECOND);
const lignes: unknown[] = [];
const compte: Record<string, number> = {};
for (const [sourceKey, cibles] of [...bySource].sort()) {
  const acces = data.acces[sourceKey];
  const scopes = acces?.verdict === 'ALLOWED' ? acces.scopes as Parameters<typeof readApplyPage>[1] : null;
  let temoin: ProbeReading | null | undefined;
  for (const cible of cibles.slice(0, PAR_SOURCE)) {
    const brute: ProbeReading = scopes ? await readApplyPage(cible.url, scopes, acquire) : { verdict: 'NON_CONCLUSIVE', reason: 'NO_ACCESS_DECISION' };
    if (brute.verdict === 'DEAD' && temoin === undefined) {
      const url = data.temoins[sourceKey];
      temoin = url && url !== cible.url && scopes ? await readApplyPage(url, scopes, acquire) : null;
    }
    const lecture = calibrate(brute, temoin ?? null);
    compte[lecture.verdict] = (compte[lecture.verdict] ?? 0) + 1;
    lignes.push({ sourceKey, url: cible.url, vue: cible.lastSeenAt, verdict: lecture.verdict, motif: lecture.reason, brut: brute.verdict, statut: brute.status ?? null,
      texte: brute.matched ?? null, temoin: brute.verdict === 'DEAD' ? temoin ?? null : undefined });
  }
}
console.log(JSON.stringify({ cibles: data.cibles.length, parSource: Object.fromEntries([...bySource].map(([k, v]) => [k, v.length])),
  sondees: lignes.length, verdicts: compte, lignes }, null, 1));

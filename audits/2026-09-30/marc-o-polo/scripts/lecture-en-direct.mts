/**
 * MARC O'POLO (D-485) — UNE LECTURE COMPLÈTE PAR LE LECTEUR DÉDIÉ, EN DIRECT, SANS BASE.
 *
 *   PIPELINE_PAUSED=0 npx tsx audits/2026-09-30/marc-o-polo/scripts/lecture-en-direct.mts --sortie=<dossier>
 *
 * Lance `fetchMarcOPoloJobs` sur le site réel avec la configuration relue (`registre-relu-marc-o-polo.csv`), par le
 * transport commun (identité CatwalksBot, cadence par hôte), fiches deux par deux. Aucune écriture en base, aucune
 * capture archivée : chaque réponse reçue est seulement copiée dans `<dossier>/reponses.json.gz` (adresse, statut, type,
 * corps) pour servir de fixture, et le résultat dans `<dossier>/resultat.json`. Rend le bilan de la lecture : offres,
 * preuve de fin de liste, témoin de la page publiée, taux de champs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fetchMarcOPoloJobs } from '../../../../apps/aggregator/src/ats/adapters/marcOPolo.js';
import { normalizeAdapterResult } from '../../../../apps/aggregator/src/ats/index.js';

const sortie = process.argv.find((a) => a.startsWith('--sortie='))?.slice(9);
if (!sortie) { console.error('usage: lecture-en-direct.mts --sortie=<dossier>'); process.exit(2); }
const config = { reader: 'marc-o-polo-vacancies', startUrl: 'https://company.marc-o-polo.com/en/career/start-creating-with-us/our-jobs',
  apiUrl: 'https://vhfco59ro6.execute-api.eu-central-1.amazonaws.com/production', detailConcurrency: 2 };

const reponses: Array<{ url: string; status: number; contentType: string | null; at: string; body: string }> = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await nativeFetch(input, init);
  const body = await response.clone().text();
  reponses.push({ url: String(input instanceof Request ? input.url : input), status: response.status, contentType: response.headers.get('content-type'), at: new Date().toISOString(), body });
  return response;
}) as typeof fetch;

const debut = Date.now();
const brut = await fetchMarcOPoloJobs(config);
const resultat = normalizeAdapterResult(brut);
const duree = Math.round((Date.now() - debut) / 1000);
mkdirSync(sortie, { recursive: true });
const archive = gzipSync(JSON.stringify(reponses));
writeFileSync(`${sortie}/reponses.json.gz`, archive);
writeFileSync(`${sortie}/resultat.json`, JSON.stringify(resultat, null, 1));
const taux = (f: (j: (typeof resultat.jobs)[number]) => unknown) => `${resultat.jobs.filter((j) => Boolean(f(j))).length}/${resultat.jobs.length}`;
const pays: Record<string, number> = {};
for (const job of resultat.jobs) pays[String(job.country)] = (pays[String(job.country)] ?? 0) + 1;
const rejets: Record<string, number> = {};
for (const row of resultat.rejectedRows ?? []) rejets[row.reason] = (rejets[row.reason] ?? 0) + 1;
console.log(JSON.stringify({
  duree_s: duree, requetes: reponses.length, statuts: [...new Set(reponses.map((r) => r.status))],
  offres: resultat.jobs.length, identifiantsUniques: new Set(resultat.jobs.map((j) => j.externalId)).size,
  complete: resultat.complete, verdict: resultat.enumerationVerdict, declaredTotal: resultat.declaredTotal,
  preuve: { termination: resultat.enumeration?.termination, issues: resultat.enumeration?.issues, rawCount: resultat.enumeration?.rawCount,
    publisherCounter: resultat.enumeration?.pageEvidence?.[0]?.publisherCounter, compteurs: resultat.enumeration?.pageEvidence?.[0]?.componentCounters },
  rejets, pays,
  taux: { description: taux((j) => j.description && j.description.length > 200), date: taux((j) => j.postedAt), pays: taux((j) => j.country),
    ville: taux((j) => j.city), contrat: taux((j) => j.contract), langue: taux((j) => j.language) },
  archive: { octets: archive.length, sha256: createHash('sha256').update(archive).digest('hex') },
}, null, 1));

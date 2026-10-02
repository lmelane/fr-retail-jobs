/**
 * D-485 / D-489 — COLLECTE LOCALE DE MARC O'POLO, lecture seule : le lecteur dédié de `development` (intégré le
 * 02/10/2026) exécuté contre le site réel, avec la configuration que le registre relu écrira
 * (`corriger-sources-relues.mts audits/2026-09-30/marc-o-polo/registre-relu-marc-o-polo.csv`, inspection du 02/10).
 * Aucune base, aucune écriture, aucune capture : le lecteur seul, hors collecte, à sa cadence de production.
 *
 *   npx tsx audits/2026-10-02/reouverture-rl-mop/scripts/collecte-locale-marc-o-polo.mts > sortie.json
 *
 * Ce qu'il rend : le nombre d'offres lues, la preuve d'énumération (méthode, fin, motifs bloquants), l'employeur
 * déclaré par les pages d'offre (D-489), le taux de descriptions, et un échantillon (titre, lieu, employeur).
 */
import { installLogger, OperationalLogger } from '../../../../apps/aggregator/src/observability/logger.js';
import { fetchMarcOPoloJobs } from '../../../../apps/aggregator/src/ats/adapters/marcOPolo.js';

const CONFIG = {
  startUrl: 'https://company.marc-o-polo.com/en/career/start-creating-with-us/our-jobs',
  reader: 'marc-o-polo-vacancies',
  apiUrl: 'https://vhfco59ro6.execute-api.eu-central-1.amazonaws.com/production',
};

const evenements: Record<string, unknown>[] = [];
installLogger(new OperationalLogger({ runId: `collecte-locale-mop-${Date.now()}`, write: async (line) => {
  const r = JSON.parse(line) as Record<string, unknown>;
  if (r.level === 'warn' || r.level === 'error') evenements.push({ level: r.level, event: r.event, message: r.message });
} }));

const debut = new Date();
const resultat = await fetchMarcOPoloJobs(CONFIG);
const fin = new Date();
const jobs = resultat.jobs;
const employeurs = new Map<string, number>();
for (const j of jobs) employeurs.set(String(j.company ?? '(aucun)'), (employeurs.get(String(j.company ?? '(aucun)')) ?? 0) + 1);
const avecDescription = jobs.filter((j) => (j.description ?? '').trim().length >= 200).length;
process.stdout.write(JSON.stringify({
  debut: debut.toISOString(),
  fin: fin.toISOString(),
  config: CONFIG,
  offresLues: jobs.length,
  declaredTotal: resultat.declaredTotal ?? null,
  truncated: resultat.truncated ?? false,
  enumeration: resultat.enumeration ?? null,
  employeurs: Object.fromEntries(employeurs),
  descriptions200: { avec: avecDescription, taux: jobs.length ? Math.round((avecDescription / jobs.length) * 1000) / 10 : null },
  rejets: (resultat.rejectedRows ?? []).length,
  echantillon: jobs.slice(0, 5).map((j) => ({ titre: j.title, lieu: j.location, pays: j.country, employeur: j.company, url: j.url })),
  avertissements: evenements.slice(0, 40),
}, null, 2) + '\n');

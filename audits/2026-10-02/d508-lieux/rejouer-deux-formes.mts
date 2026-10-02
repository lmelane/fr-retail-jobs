/**
 * D-508 §5 — UNE RECHERCHE « Paris (75) » SAISIE COMME LIEU ET UNE ALERTE DONT « Paris (75) » VIENT DU FILTRE `ville`
 * RENDENT-ELLES LES MÊMES OFFRES ? Rejoue les deux formes par le code de l'API du catalogue (`getJobs`, la route
 * `/api/jobs` ; `examinerAlerte`, la route `/api/alertes/examen`), avec le contrat de proximité du site et du backend
 * (`proximite`, `comprendre`), sur les données de PRODUCTION, en LECTURE SEULE.
 *
 * Pourquoi pas le serveur Next de l'API : son `instrumentation.ts` lance au démarrage la boucle d'index de recherche
 * (écritures de projection) et la purge des requêtes tapées (DELETE). Contre la base de production, c'est exclu. Les
 * fonctions appelées ici sont celles des routes, sans cette boucle.
 *
 * Garde : une seule connexion (`connection_limit=1`), remise en `TRANSACTION READ ONLY` avant CHAQUE appel puis vérifiée
 * (`transaction_read_only = on`), sinon arrêt. Remise à chaque fois : le pool de Prisma peut renouveler sa connexion
 * (constaté au premier rejeu complet, où la vérification seule a arrêté le script après Annecy).
 *
 * Lancer depuis la racine du dépôt :
 *   TSX_TSCONFIG_PATH=apps/api/tsconfig.json python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/d508-lieux/rejouer-deux-formes.mts
 * Écrit `rejeu-deux-formes.json` à côté de ce fichier.
 */
import { writeFileSync } from 'node:fs';

const url = new URL(process.env.DATABASE_URL ?? '');
url.searchParams.set('connection_limit', '1');
process.env.DATABASE_URL = url.toString();

const { prisma } = await import('@catwalks/db');
const { getJobs, examinerAlerte } = await import('../../../apps/api/lib/jobs');

const lectureSeule = async () => {
  await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const [r] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>('SHOW transaction_read_only');
  if (r?.transaction_read_only !== 'on') throw new Error('session non protégée en lecture seule : arrêt');
};

type Cas = { marche: string; lieu: string; locale?: string; q?: string; filtres?: Record<string, string[]> };
const CAS: Cas[] = [
  { marche: 'FR', lieu: 'Paris (75)' },
  { marche: 'FR', lieu: 'Paris (75)', q: 'vendeur' },
  { marche: 'FR', lieu: 'Lyon (69)' },
  { marche: 'FR', lieu: 'Annecy (74)' },
  { marche: 'FR', lieu: 'Paris 15e (75)' },
  { marche: 'FR', lieu: 'Bordeaux (33)', q: 'conseiller' },
  { marche: 'CH', lieu: 'Genève (GE)' },
  { marche: 'GB', lieu: 'London (ENG)' },
  { marche: 'US', lieu: 'New York (NY)' },
];
const PLAFOND_PAGES = 300;

async function toutesLesOffres(filtres: Parameters<typeof getJobs>[0]) {
  const ids: string[] = [];
  let apres: string | undefined, total = 0, lieu: unknown = null, refus: unknown = [], pages = 0;
  do {
    await lectureSeule();
    const r = await getJobs({ ...filtres, apres });
    if (pages === 0) { total = r.total; lieu = r.lieu; refus = r.filtresRefuses; }
    ids.push(...r.jobs.map((j) => String(j.id)));
    apres = r.suivant ?? undefined;
    pages += 1;
  } while (apres && pages < PLAFOND_PAGES);
  return { total, lieu, refus, ids, complet: !apres };
}

const sortie = [];
for (const c of CAS) {
  const commun = { marche: c.marche, locale: c.locale, q: c.q, proximite: true, comprendre: true };
  const autres = c.filtres ?? {};
  const parLieu = await toutesLesOffres({ ...commun, lieu: c.lieu, filtres: { ...autres } });
  const parVille = await toutesLesOffres({ ...commun, filtres: { ...autres, ville: [c.lieu] } });
  const entree = new Date(Date.now() - 7 * 86_400_000), publiee = new Date(Date.now() - 30 * 86_400_000);
  await lectureSeule();
  const examenLieu = await examinerAlerte({ ...commun, lieu: c.lieu, filtres: { ...autres } }, entree, publiee);
  await lectureSeule();
  const examenVille = await examinerAlerte({ ...commun, filtres: { ...autres, ville: [c.lieu] } }, entree, publiee);
  const a = new Set(parLieu.ids), b = new Set(parVille.ids);
  const ligne = {
    cas: c, lieuCompris: parLieu.lieu, refus: { lieu: parLieu.refus, ville: parVille.refus },
    totaux: { lieu: parLieu.total, ville: parVille.total }, lus: { lieu: parLieu.ids.length, ville: parVille.ids.length, complets: parLieu.complet && parVille.complet },
    memesOffres: a.size === b.size && [...a].every((id) => b.has(id)), memeOrdre: parLieu.ids.join() === parVille.ids.join(),
    seulementLieu: [...a].filter((id) => !b.has(id)).slice(0, 20), seulementVille: [...b].filter((id) => !a.has(id)).slice(0, 20),
    examen: { lieu: { total: examenLieu.total, nouvelles: examenLieu.nouvelles }, ville: { total: examenVille.total, nouvelles: examenVille.nouvelles },
      memesNouvelles: examenLieu.jobs.map((j) => j.id).join() === examenVille.jobs.map((j) => j.id).join() },
  };
  sortie.push(ligne);
  console.log(JSON.stringify({ cas: `${c.marche} ${c.q ? `${c.q} · ` : ''}${c.lieu}${c.filtres ? ` · ${JSON.stringify(c.filtres)}` : ''}`, totaux: ligne.totaux,
    memesOffres: ligne.memesOffres, memeOrdre: ligne.memeOrdre, examen: ligne.examen }));
}
writeFileSync(new URL('./rejeu-deux-formes.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), sortie }, null, 1));
await prisma.$disconnect();

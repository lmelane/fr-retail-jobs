/**
 * R-143 §8 — MESURE À BLANC DES ALERTES SUR LE CATALOGUE DE PRODUCTION, EN LECTURE SEULE (D-513, lecture D-492 du 02/10).
 *
 * Pour chaque alerte (critères seuls, sans personne) : l'examen d'AVANT (contrat 2 sans `nonPrecisees`, le SQL de
 * `development` avant R-143) et celui d'APRÈS (avec `nonPrecisees`), sur la même semaine de nouveautés ; puis chaque
 * offre qu'AVANT aurait envoyée est confrontée, critère par critère, à ses propres faits :
 *  - métier : son code ou un métier lu dans son intitulé ;
 *  - lieu : la distance de son point à la ville cherchée (au-delà de 100 km, hors de tout cercle de D-496), ou, sans
 *    point, le nom de sa ville ;
 *  - contrat / temps : la valeur lue À NOUVEAU par le normaliseur corrigé (`resolveCanonicalDimensions` de cette
 *    révision) sur ses preuves natives : une offre servie « CDI » que le code corrigé ne prouve plus CDI aurait violé la
 *    promesse.
 *
 * La session Prisma est ouverte avec `default_transaction_read_only=on` (vérifié avant la mesure) ; aucune écriture
 * n'est possible par ce chemin. Jamais entre 15:30 et 18:30 UTC.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
 *     'cd <agrégateur>/apps/api && npx tsx ../../audits/2026-10-02/r143-filtres-alertes/alertes-a-blanc.mts <alertes.json> <sortie.json>'
 */
import { readFileSync, writeFileSync } from 'node:fs';

const u = new URL(process.env.DATABASE_URL!);
u.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=60000');
process.env.DATABASE_URL = u.toString();
const { prisma } = await import('@catwalks/db');
const { examinerAlerte } = await import('../../../apps/api/lib/jobs');
const { planifierRecherche } = await import('../../../apps/api/lib/search-plan');
const { localiserPlan } = await import('../../../apps/api/lib/geo');
const { exigerPerimetre } = await import('../../../apps/api/lib/perimetre');
const { resolveCanonicalDimensions } = await import('../../../apps/aggregator/src/trust/resolve');

const [entree, sortie] = process.argv.slice(2);
const [{ ro }] = await prisma.$queryRawUnsafe<{ ro: string }[]>(`SELECT current_setting('transaction_read_only') ro`);
if (ro !== 'on') throw new Error('garde : la session n’est pas en lecture seule');

type Criteres = { marche: string; motCle: string; lieu: string; filtres: Record<string, string[]> };
const alertes = JSON.parse(readFileSync(entree, 'utf8')) as { criteres: Criteres; inscrits?: number; origine?: string }[];
// La dernière échéance (mardi 29/09, 07:30 Paris) : les nouveautés d'un vendredi.
const FILIGRANE = new Date('2026-09-29T05:30:00Z');
const PUBLIEE = new Date(Date.now() - 30 * 24 * 3600 * 1000);
const km = (a: [number, number], b: [number, number]) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const cle = (v: string | null | undefined) => (v ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const resultats = [];
for (const a of alertes) {
  const c = a.criteres;
  const filtres = { marche: c.marche, q: c.motCle || undefined, lieu: c.lieu || undefined, filtres: c.filtres, proximite: true, comprendre: true, fraicheur: true };
  let avant, apres;
  try {
    avant = await examinerAlerte(filtres, FILIGRANE, PUBLIEE);
    apres = await examinerAlerte({ ...filtres, nonPrecisees: true }, FILIGRANE, PUBLIEE);
  } catch (e) {
    resultats.push({ criteres: c, erreur: e instanceof Error ? e.message.slice(0, 120) : String(e) });
    continue;
  }
  const plan = await localiserPlan(planifierRecherche(exigerPerimetre(c.marche), { ...filtres }), undefined);
  const villes = [...(plan.proximite?.lieu ? [plan.proximite.lieu] : []), ...(plan.proximite?.villes?.resolues ?? [])];
  const ids = avant.jobs.map((j) => j.id).filter((id) => !id.startsWith('cw_'));
  const faits = await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, rawTitle: true, description: true,
    rawContract: true, rawWorkingTime: true, canonicalSourceKey: true, canonicalExternalId: true, occupationCode: true, titleRoles: true,
    city: true, geoLatitude: true, geoLongitude: true, employmentTerm: true, programType: true, engagementType: true, workTime: true } });
  const raws = new Map((await prisma.jobSource.findMany({ where: { jobId: { in: ids } }, select: { jobId: true, sourceKey: true, externalId: true, raw: true } }))
    .map((s) => [`${s.jobId} ${s.sourceKey} ${s.externalId}`, s.raw]));
  const violations: Record<string, string[]> = {};
  const noter = (critere: string, id: string) => (violations[critere] ??= []).push(id);
  const distances: number[] = [];
  for (const f of faits) {
    const metiers = c.filtres.metier ?? [];
    if (metiers.length && !metiers.some((m) => f.occupationCode === m || f.titleRoles.includes(m))) noter('metier', f.id);
    if (villes.length) {
      if (f.geoLatitude !== null && f.geoLongitude !== null) {
        const d = Math.min(...villes.map((v) => km([v.latitude, v.longitude], [f.geoLatitude!, f.geoLongitude!])));
        distances.push(d);
        if (d > 100) noter('lieu', f.id);
      } else if (!villes.some((v) => cle(v.nom) === cle(f.city))) noter('lieu', f.id);
    }
    const contrats = c.filtres.contrat ?? [], temps = c.filtres.temps ?? [];
    if (contrats.length || temps.length) {
      const r = resolveCanonicalDimensions({ sourceKey: f.canonicalSourceKey ?? '', title: f.rawTitle ?? f.title, description: f.description,
        contract: f.rawContract, workingTime: f.rawWorkingTime, raw: raws.get(`${f.id} ${f.canonicalSourceKey} ${f.canonicalExternalId}`) });
      const choix = [r.employmentTerm, r.programType, r.engagementType].filter(Boolean);
      if (contrats.length && !contrats.some((v) => choix.includes(v))) noter('contrat (relu par le code corrigé)', f.id);
      if (temps.length && !temps.includes(r.workTime ?? '')) noter('temps (relu par le code corrigé)', f.id);
    }
  }
  resultats.push({ criteres: c, inscrits: a.inscrits ?? 1, origine: a.origine ?? 'conversion',
    avant: { total: avant.total, nouvelles: avant.nouvelles, envoyees: ids.length }, apres: { total: apres.total, nouvelles: apres.nouvelles, envoyees: apres.jobs.length },
    memesOffres: JSON.stringify(avant.jobs.map((j) => j.id)) === JSON.stringify(apres.jobs.map((j) => j.id)),
    villesResolues: villes.map((v) => v.libelle), distanceMaxKm: distances.length ? Math.round(Math.max(...distances)) : null, violations });
}
writeFileSync(sortie, JSON.stringify(resultats, null, 1));
await prisma.$disconnect();
console.log(`${resultats.length} alertes examinées à blanc → ${sortie}`);

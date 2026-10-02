/**
 * D-515 §2 — MESURE À BLANC DES ALERTES EN DEUX TEMPS, SUR LE CATALOGUE DE PRODUCTION EN LECTURE SEULE.
 *
 * Pour chaque alerte (critères seuls, sans personne) : l'examen de CE code au contrat 2 (`nonPrecisees`), sur la semaine
 * de nouveautés qui suit l'échéance du mardi 29/09 ; combien d'offres CERTAINES (section 1) et combien d'INCOMPLÈTES
 * (section 2) par alerte ; puis chaque offre est confrontée, critère par critère, à ses propres faits :
 *  - métier : son code ou un métier lu dans son intitulé ;
 *  - lieu : la distance de son point au lieu cherché (au-delà de 100 km, hors de tout cercle de D-496), ou, sans point, le
 *    nom de sa ville ;
 *  - section 1 : le contrat et le temps de travail STOCKÉS respectent le filtre (ce que l'e-mail affirme) ;
 *  - section 2 : chaque dimension que l'offre dit ne pas préciser est bien VIDE (inconnue, jamais contraire), et chaque
 *    dimension filtrée qu'elle ne nomme pas respecte le filtre ;
 *  - aucune offre dans les deux sections.
 *
 * La session Prisma est ouverte avec `default_transaction_read_only=on` (vérifié avant la mesure). Jamais entre 15:30 et
 * 18:30 UTC.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
 *     'cd <worktree>/apps/api && npx tsx ../../audits/2026-10-02/alertes-deux-temps/alertes-a-blanc.mts <alertes.json> <sortie.json>'
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

const [entree, sortie] = process.argv.slice(2);
const [{ ro }] = await prisma.$queryRawUnsafe<{ ro: string }[]>(`SELECT current_setting('transaction_read_only') ro`);
if (ro !== 'on') throw new Error('garde : la session n’est pas en lecture seule');

type Criteres = { marche: string; motCle: string; lieu: string; filtres: Record<string, string[]> };
const alertes = JSON.parse(readFileSync(entree, 'utf8')) as { criteres: Criteres; inscrits?: number; origine?: string }[];
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
  const filtres = { marche: c.marche, q: c.motCle || undefined, lieu: c.lieu || undefined, filtres: c.filtres, proximite: true, comprendre: true,
    fraicheur: true, nonPrecisees: true };
  let e;
  try {
    e = await examinerAlerte(filtres, FILIGRANE, PUBLIEE);
  } catch (err) {
    resultats.push({ criteres: c, origine: a.origine ?? 'conversion', erreur: err instanceof Error ? err.message.slice(0, 160) : String(err) });
    continue;
  }
  const plan = await localiserPlan(planifierRecherche(exigerPerimetre(c.marche), { ...filtres }), undefined);
  const villes = [...(plan.proximite?.lieu ? [plan.proximite.lieu] : []), ...(plan.proximite?.villes?.resolues ?? [])];
  const certaines = e.jobs.map((j) => j.id).filter((id) => !id.startsWith('cw_'));
  const incompletes = (e.jobsIncompletes ?? []).filter((j) => !j.id.startsWith('cw_'));
  const dimsDe = new Map(incompletes.map((j) => [j.id, j.correspondance?.statut === 'NON_CONFIRMEE' ? j.correspondance.dimensions : []]));
  const ids = [...certaines, ...incompletes.map((j) => j.id)];
  const faits = await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, occupationCode: true, titleRoles: true, city: true,
    geoLatitude: true, geoLongitude: true, employmentTerm: true, programType: true, engagementType: true, workTime: true } });
  const violations: Record<string, string[]> = {};
  const noter = (critere: string, id: string) => (violations[critere] ??= []).push(id);
  const contrats = c.filtres.contrat ?? [], temps = c.filtres.temps ?? [];
  for (const f of faits) {
    const section = dimsDe.has(f.id) ? 2 : 1;
    const metiers = c.filtres.metier ?? [];
    if (metiers.length && !metiers.some((m) => f.occupationCode === m || f.titleRoles.includes(m))) noter(`s${section} métier`, f.id);
    if (villes.length) {
      if (f.geoLatitude !== null && f.geoLongitude !== null) {
        if (Math.min(...villes.map((v) => km([v.latitude, v.longitude], [f.geoLatitude!, f.geoLongitude!]))) > 100) noter(`s${section} lieu`, f.id);
      } else if (!villes.some((v) => cle(v.nom) === cle(f.city))) noter(`s${section} lieu`, f.id);
    }
    const choix = [f.employmentTerm, f.programType, ['FREELANCE', 'INDEPENDENT_CONTRACTOR'].includes(f.engagementType ?? '') ? f.engagementType : null].filter(Boolean);
    const dims = dimsDe.get(f.id) ?? [];
    if (contrats.length) {
      if (dims.includes('contrat')) { if (choix.length) noter('s2 contrat déclaré (inconnu attendu)', f.id); }
      else if (!contrats.some((v) => choix.includes(v))) noter(`s${section} contrat contraire ou absent`, f.id);
    }
    if (temps.length) {
      if (dims.includes('temps')) { if (f.workTime) noter('s2 temps déclaré (inconnu attendu)', f.id); }
      else if (!temps.includes(f.workTime ?? '')) noter(`s${section} temps contraire ou absent`, f.id);
    }
  }
  if (certaines.some((id) => dimsDe.has(id))) noter('offre dans les deux sections', certaines.find((id) => dimsDe.has(id))!);
  resultats.push({ criteres: c, inscrits: a.inscrits ?? 1, origine: a.origine ?? 'conversion', total: e.total,
    certaines: e.nouvelles, incompletes: e.incompletes ?? 0, certainesLues: certaines.length, incompletesLues: incompletes.length,
    dimensions: [...new Set(incompletes.flatMap((j) => dimsDe.get(j.id) ?? []))], villesResolues: villes.map((v) => v.libelle), violations });
}
writeFileSync(sortie, JSON.stringify(resultats, null, 1));
await prisma.$disconnect();
console.log(`${resultats.length} alertes examinées à blanc → ${sortie}`);

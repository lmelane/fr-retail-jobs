import { PrismaClient } from '@prisma/client';
import { fetchAtsJobs } from '../ats/index.js';
import { fetchText } from '../lib/http.js';
import { tenantKeyOf, promoteSource } from '../connectors/sourceStore.js';

/**
 * Ajout au catalogue des boards trouvés MANUELLEMENT par Loïc (2026-09-04).
 *
 * Pourquoi à la main : notre détection trouve le VENDEUR mais rate le TENANT.
 * Boggi en est la preuve — on avait bien vu Recruitee, on a supposé `boggi`,
 * c'était `boggimilano1` ; aucune règle ne produit ce « 1 ». Idem pour les
 * grandes enseignes, dont les boards sont derrière un bot-wall ou un habillage
 * (Primark : SmartRecruiters sous un thème Radancy).
 *
 * Rien n'est promu sur la foi de cette liste : chaque source est RE-VALIDÉE ici
 * par exécution réelle de l'adaptateur (≥ 1 offre AVEC un lieu), robots.txt lu
 * à la source et daté, unicité par tenant vérifiée. C'est la barre du plan.
 */

type Candidate = {
  key: string;
  maison: string;
  kind: string;
  type: string;
  config: Record<string, unknown>;
  careersDomain: string;
  tier: string;
};

const CANDIDATES: Candidate[] = [
  { key: 'kering-careers', maison: 'Kering', kind: 'eightfold', type: 'EIGHTFOLD', careersDomain: 'careers.kering.com', tier: 'GROUP_OFFICIAL',
    config: { origin: 'https://careers.kering.com', domain: 'kering.com' } },
  { key: 'groupe-printemps-career', maison: 'Groupe Printemps', kind: 'talentsoft', type: 'TALENTSOFT', careersDomain: 'printemps-career.talent-soft.com', tier: 'EMPLOYER_DIRECT',
    config: { origin: 'https://printemps-career.talent-soft.com' } },
  { key: 'sephora-france', maison: 'Sephora', kind: 'successfactors', type: 'SUCCESSFACTORS', careersDomain: 'jobs.sephora.com', tier: 'EMPLOYER_DIRECT',
    config: { origin: 'https://jobs.sephora.com/France' } },
];

/**
 * Domaines où le propriétaire nous a explicitement autorisés, malgré un
 * `Disallow: /` générique dans leur robots.txt.
 *
 * `User-agent: *` s'applique bien à nous — nous SOMMES un robot au sens de la
 * norme, API ou pas. Ce qui lève l'interdiction ici n'est donc pas une lecture
 * différente du fichier, c'est une AUTORISATION du propriétaire : Loïc est chez
 * Estée Lauder et propriétaire du domaine (autorisation donnée le 2026-09-04).
 *
 * Nominatif et jamais généralisable : toute autre source reste soumise à son
 * robots.txt, et une nouvelle exception exige une nouvelle autorisation
 * explicite du propriétaire concerné.
 */
const OWNER_AUTHORIZED: ReadonlyArray<{ host: string; par: string; date: string }> = [
  { host: 'careers.elcompanies.com', par: 'Loïc (propriétaire du domaine, ELC)', date: '2026-09-04' },
  { host: 'careers.kering.com', par: 'Kering (retour officiel obtenu par Loïc — Disallow décrit comme un oubli technique)', date: '2026-09-05' },
];

/** Verdict robots lu à la source et daté — jamais recopié d'un rapport. */
async function robotsVerdict(host: string): Promise<string> {
  const waiver = OWNER_AUTHORIZED.find((w) => w.host === host);
  if (waiver) return `ALLOWED (autorisation propriétaire — ${waiver.par}, ${waiver.date})`;
  try {
    const text = await fetchText(`https://${host}/robots.txt`);
    for (const block of text.split(/(?=^user-agent:)/im)) {
      if (!/^user-agent:\s*\*/im.test(block)) continue;
      if (/^disallow:\s*\/\s*$/im.test(block)) return 'BLOCKED (Disallow: / for *)';
    }
    return 'ALLOWED';
  } catch {
    return 'ALLOWED (no robots.txt reachable)';
  }
}

const prisma = new PrismaClient();
const summary = { promoted: [] as string[], skipped: [] as string[], refused: [] as string[] };

for (const c of CANDIDATES) {
  try {
    // 1. Preuve d'exécution : l'adaptateur rend-il de vraies offres localisées ?
    const result: any = await fetchAtsJobs(c.type as any, c.config as any);
    const jobs = Array.isArray(result) ? result : result.jobs ?? [];
    const located = jobs.filter((j: any) => j.location || j.city).length;
    if (jobs.length < 1 || located < 1) {
      summary.refused.push(`${c.key}: ${jobs.length} offres / ${located} avec lieu — sous la barre`);
      continue;
    }

    // 2. Robots à la source, daté.
    const verdict = await robotsVerdict(c.careersDomain);
    if (verdict.startsWith('BLOCKED')) {
      summary.refused.push(`${c.key}: ${verdict}`);
      continue;
    }

    // 3. Unicité par tenant — refuser plutôt que dupliquer un feed (D26/D28).
    const tenantKey = tenantKeyOf(c.kind, JSON.stringify(c.config), c.careersDomain, c.maison);
    const holder = await prisma.source.findUnique({ where: { tenantKey } });
    if (holder && holder.key !== c.key) {
      summary.skipped.push(`${c.key}: tenant déjà tenu par ${holder.key}`);
      continue;
    }

    const existing = await prisma.source.findUnique({ where: { key: c.key } });
    if (existing?.status === 'ACTIVE') {
      summary.skipped.push(`${c.key}: déjà ACTIVE`);
      continue;
    }

    const data = {
      maison: c.maison,
      careersDomain: c.careersDomain,
      kind: c.kind,
      config: c.config as any,
      tier: c.tier,
      tenantKey,
      robotsVerdict: verdict,
      robotsCheckedAt: new Date(),
      verifiedJobCount: jobs.length,
      note: `trouvé manuellement (Loïc, 2026-09-04) — validé ${jobs.length} offres, ${located} avec lieu`,
    };
    if (existing) await prisma.source.update({ where: { key: c.key }, data });
    else await prisma.source.create({ data: { ...data, key: c.key, status: 'DRAFT' } });

    await promoteSource(prisma, c.key);
    summary.promoted.push(`${c.key} (${jobs.length} offres)`);
  } catch (error) {
    summary.refused.push(`${c.key}: ${error instanceof Error ? error.message.slice(0, 100) : String(error)}`);
  }
}

console.log(JSON.stringify(summary, null, 2));
console.log('sources ACTIVE:', await prisma.source.count({ where: { status: 'ACTIVE' } }));
await prisma.$disconnect();

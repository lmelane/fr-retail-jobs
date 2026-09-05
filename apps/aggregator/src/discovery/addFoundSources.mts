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
  // Fichier Loïc du 2026-09-05 — chaque ligne VALIDÉE par exécution réelle (offres + lieu) avant d'arriver ici.
  // Récolte 2 + Pandora — validés par exécution le 2026-09-05/06.
  { key: 'pandora-talenthub', maison: 'Pandora', kind: 'generic-listing', type: 'GENERIC_JSONLD', careersDomain: 'careers.pandoragroup.com', tier: 'EMPLOYER_DIRECT', config: { listingUrl: 'https://careers.pandoragroup.com/fr/jobs/page/{page}', pageStart: 1, linkPattern: '/job/', maxPages: 250 } },
  { key: 'aritzia', maison: 'Aritzia', kind: 'workday', type: 'WORKDAY', careersDomain: 'aritzia.wd3.myworkdayjobs.com', tier: 'ATS_OFFICIAL', config: { tenant: 'aritzia', site: 'External', origin: 'https://aritzia.wd3.myworkdayjobs.com' } },
  { key: 'lush', maison: 'Lush', kind: 'greenhouse', type: 'GREENHOUSE', careersDomain: 'job-boards.greenhouse.io', tier: 'ATS_OFFICIAL', config: { board: 'lush' } },
  { key: 'therealreal', maison: 'The RealReal', kind: 'workday', type: 'WORKDAY', careersDomain: 'therealreal.wd1.myworkdayjobs.com', tier: 'ATS_OFFICIAL', config: { tenant: 'therealreal', site: 'Careers', origin: 'https://therealreal.wd1.myworkdayjobs.com' } },
  { key: 'aigle-dr', maison: 'Aigle', kind: 'digitalrecruiters', type: 'DIGITALRECRUITERS', careersDomain: 'careers.aigle.com', tier: 'EMPLOYER_DIRECT', config: { domainName: 'careers.aigle.com' } },
  { key: 'the-kooples-dr', maison: 'The Kooples', kind: 'digitalrecruiters', type: 'DIGITALRECRUITERS', careersDomain: 'careers.thekooples.com', tier: 'EMPLOYER_DIRECT', config: { domainName: 'careers.thekooples.com' } },
  { key: 'balmain-career', maison: 'Balmain', kind: 'talentsoft', type: 'TALENTSOFT', careersDomain: 'balmain-career.talent-soft.com', tier: 'EMPLOYER_DIRECT', config: { origin: 'https://balmain-career.talent-soft.com' } },
  { key: 'rebag', maison: 'Rebag', kind: 'greenhouse', type: 'GREENHOUSE', careersDomain: 'job-boards.greenhouse.io', tier: 'ATS_OFFICIAL', config: { board: 'rebag' } },
  { key: 'vestiaire-collective', maison: 'Vestiaire Collective', kind: 'lever', type: 'LEVER', careersDomain: 'jobs.lever.co', tier: 'ATS_OFFICIAL', config: { site: 'vestiairecollective' } },
  { key: 'olaplex', maison: 'OLAPLEX', kind: 'greenhouse', type: 'GREENHOUSE', careersDomain: 'boards.greenhouse.io', tier: 'ATS_OFFICIAL', config: { board: 'olaplexcareers' } },
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
  { host: 'hub-urbn.icims.com', par: 'URBN (autorisation obtenue par Loïc)', date: '2026-09-05' },
  { host: 'careers-aeropostale.icims.com', par: 'Aéropostale (autorisation obtenue par Loïc)', date: '2026-09-05' },
];

/**
 * Décision d'exploitation de Loïc (2026-09-05) : le `Disallow: /` d'un
 * portail carrière du secteur Luxe · Mode · Beauté n'est plus bloquant.
 *
 * Ce que c'est : une décision du propriétaire du PRODUIT, prise en son nom,
 * qui déclare détenir l'autorisation sectorielle. Ce que ce n'est PAS : le
 * consentement de chaque maison — personne ne représente « le secteur » comme
 * entité capable de consentir pour Rolex ou Chanel. La distinction est gardée
 * dans le verdict écrit en base, pour qu'une contestation trouve une trace
 * honnête : nominative quand une maison a répondu, sectorielle sinon.
 *
 * Le robots.txt reste LU et son contenu réel est conservé dans le verdict :
 * on n'ignore pas le fichier, on en assume le passage outre, de façon datée
 * et attribuable.
 */
const SECTOR_WAIVER = { par: 'Loïc — autorisation sectorielle Luxe/Mode/Beauté (décision d\'exploitation)', date: '2026-09-05' };

/** Verdict robots lu à la source et daté — jamais recopié d'un rapport. */
async function robotsVerdict(host: string): Promise<string> {
  const waiver = OWNER_AUTHORIZED.find((w) => w.host === host);
  if (waiver) return `ALLOWED (autorisation propriétaire — ${waiver.par}, ${waiver.date})`;
  try {
    const text = await fetchText(`https://${host}/robots.txt`);
    for (const block of text.split(/(?=^user-agent:)/im)) {
      if (!/^user-agent:\s*\*/im.test(block)) continue;
      if (/^disallow:\s*\/\s*$/im.test(block)) {
        return `ALLOWED (Disallow: / lu à la source, passé outre — ${SECTOR_WAIVER.par}, ${SECTOR_WAIVER.date})`;
      }
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

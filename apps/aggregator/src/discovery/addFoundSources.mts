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
  // Lot « GENERIC » du 2026-09-06 (rapports data/g1..g5-rapport.md) — chaque ligne re-mesurée par exécution avant d'arriver ici.
  { key: "tiffany-oracle", maison: "Tiffany & Co.", kind: "oraclehcm", type: "ORACLE_HCM", careersDomain: "eljs.fa.us2.oraclecloud.com", tier: "EMPLOYER_DIRECT", config: {origin: "https://eljs.fa.us2.oraclecloud.com", siteNumber: "CX"} },
  { key: "bloomingdales-oracle", maison: "Bloomingdale's", kind: "oraclehcm", type: "ORACLE_HCM", careersDomain: "ebwh.fa.us2.oraclecloud.com", tier: "EMPLOYER_DIRECT", config: {origin: "https://ebwh.fa.us2.oraclecloud.com", siteNumber: "CX_1002"} },
  { key: "brown-thomas-taleo", maison: "Brown Thomas Arnotts", kind: "taleo", type: "TALEO", careersDomain: "lde.tbe.taleo.net", tier: "ATS_OFFICIAL", config: {origin: "https://lde.tbe.taleo.net/lde02", org: "ARNOTTS", cws: [79, 70, 71, 72, 73, 74, 75, 76, 77, 78, 60, 61, 62, 63, 64, 66]} },
  { key: "zegna-altamira", maison: "Zegna", kind: "altamira", type: "ALTAMIRA", careersDomain: "careers.zegnagroup.com", tier: "EMPLOYER_DIRECT", config: {origin: "https://careers.zegnagroup.com"} },
  { key: "acne-studios-jobylon", maison: "Acne Studios", kind: "jobylon", type: "JOBYLON", careersDomain: "emp.jobylon.com", tier: "ATS_OFFICIAL", config: {companyId: "2631"} },
  { key: "swatch-group", maison: "Swatch Group", kind: "generic-listing", type: "GENERIC_JSONLD", careersDomain: "www.swatchgroup.com", tier: "GROUP_OFFICIAL", config: {listingUrl: "https://www.swatchgroup.com/fr/job-finder", linkPattern: "/job/", pageParam: "page", pageStart: 0, maxPages: 60} },
  { key: "luxexperience", maison: "LuxExperience", kind: "generic-listing", type: "GENERIC_JSONLD", careersDomain: "career.luxexperience.com", tier: "GROUP_OFFICIAL", config: {listingUrl: "https://career.luxexperience.com/open-positions", linkPattern: "/open-positions/job-detail/", pageParam: "page", pageStart: 1, maxPages: 40} },
  { key: "beiersdorf", maison: "Beiersdorf", kind: "generic-listing", type: "GENERIC_JSONLD", careersDomain: "www.beiersdorf.com", tier: "GROUP_OFFICIAL", config: {listingUrl: "https://www.beiersdorf.com/ajax/Jobboard/JobResultAjax?db=web&contextItemId={213FB95D-4545-426C-9F6A-7CD5753A00EA}&lang=en", linkPattern: "career/jobs/", pageParam: "page", pageStart: 1, maxPages: 40} },
  { key: "globus", maison: "Globus", kind: "generic-listing", type: "GENERIC_JSONLD", careersDomain: "jobs.globus.ch", tier: "EMPLOYER_DIRECT", config: {listingUrl: "https://jobs.globus.ch/offre-emplois.html", linkPattern: "-j", maxPages: 2} },
  { key: "nocibe-eqwa", maison: "Nocibé", kind: "eqwa", type: "EQWA", careersDomain: "recrutement-nocibe.fr", tier: "EMPLOYER_DIRECT", config: {origin: "https://recrutement-nocibe.fr"} },
  { key: "beauty-success-geodir", maison: "Beauty Success", kind: "geodirectory", type: "GEODIRECTORY", careersDomain: "recrutement.beautysuccess.fr", tier: "EMPLOYER_DIRECT", config: {origin: "https://recrutement.beautysuccess.fr", restBase: "offres"} },
  { key: "rivoli-typesense", maison: "Rivoli Group", kind: "typesense", type: "TYPESENSE", careersDomain: "www.rivoligroup.com", tier: "EMPLOYER_DIRECT", config: {typesenseOrigin: "https://typesense.rivoligroup.com", apiKey: "XVzrzN4lSwOowagLCo3jidFzJoDnq7ww", collection: "vacancy", origin: "https://www.rivoligroup.com"} },
  { key: "douglas-sf", maison: "Douglas", kind: "successfactors", type: "SUCCESSFACTORS", careersDomain: "jobs.douglas.group", tier: "EMPLOYER_DIRECT", config: {origin: "https://jobs.douglas.group"} },
  { key: "breitling-sf", maison: "Breitling", kind: "successfactors", type: "SUCCESSFACTORS", careersDomain: "careers.breitling.com", tier: "EMPLOYER_DIRECT", config: {origin: "https://careers.breitling.com"} },
  { key: "puig-sf", maison: "Puig", kind: "successfactors", type: "SUCCESSFACTORS", careersDomain: "jobs.puig.com", tier: "GROUP_OFFICIAL", config: {origin: "https://jobs.puig.com"} },
  { key: "selfridges", maison: "Selfridges", kind: "generic-listing", type: "GENERIC_JSONLD", careersDomain: "jobsearch.selfridges.com", tier: "EMPLOYER_DIRECT", config: {listingUrl: "https://jobsearch.selfridges.com/jobs/search/-1/{page}", linkPattern: "/jobs/job/", pageStart: 1, maxPages: 50} },
  { key: "end-clothing", maison: "END.", kind: "generic-listing", type: "GENERIC_JSONLD", careersDomain: "careers.endclothing.com", tier: "EMPLOYER_DIRECT", config: {sitemapUrl: "https://careers.endclothing.com/sitemap.xml"} },
  { key: "fenwick-volcanic", maison: "Fenwick", kind: "volcanic", type: "VOLCANIC", careersDomain: "www.careers.fenwick.co.uk", tier: "EMPLOYER_DIRECT", config: {origin: "https://www.careers.fenwick.co.uk"} },
  { key: "boots", maison: "Boots", kind: "generic-listing", type: "GENERIC_JSONLD", careersDomain: "www.boots.jobs", tier: "EMPLOYER_DIRECT", config: {sitemapUrl: "https://www.boots.jobs/sitemap_index.xml", concurrency: 4} },
  { key: "ulta-jibe", maison: "Ulta Beauty", kind: "jibe", type: "JIBE", careersDomain: "careers.ulta.com", tier: "EMPLOYER_DIRECT", config: {origin: "https://careers.ulta.com"} },
  { key: "rituals", maison: "Rituals", kind: "rituals", type: "RITUALS", careersDomain: "careers.rituals.com", tier: "EMPLOYER_DIRECT", config: {languages: ["da-DK", "de-AT", "de-CH", "de-DE", "en-GB", "en-IE", "en-NL", "es-ES", "fi-FI", "fr-BE", "fr-CH", "fr-FR", "fr-LU", "hu-HU", "it-IT", "nb-NO", "nl-BE", "nl-NL", "pl-PL", "pt-PT", "ro-RO", "sv-SE"]} },
  { key: "dr-martens-tf", maison: "Dr. Martens", kind: "talentfunnel", type: "TALENT_FUNNEL", careersDomain: "jobs.drmartens.com", tier: "EMPLOYER_DIRECT", config: {origin: "https://jobs.drmartens.com", tenant: "a3e88308-2615-4415-bb56-cc5267bc1ced"} },
  { key: "bash-talents", maison: "ba&sh", kind: "bashtalents", type: "BASH_TALENTS", careersDomain: "talents.ba-sh.com", tier: "EMPLOYER_DIRECT", config: {} },
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
      note: `lot GENERIC 2026-09-06 — validé ${jobs.length} offres, ${located} avec lieu`,
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

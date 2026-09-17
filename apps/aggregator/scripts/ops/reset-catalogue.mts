/**
 * LE RESET DU CATALOGUE — supprimer le corpus, garder de quoi collecter.
 *
 *   # inspection, n'écrit RIEN :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/reset-catalogue.mts
 *
 *   # exécution réelle, exige le mot de passe explicite :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/reset-catalogue.mts --ecrire OUI-JE-SUPPRIME-LE-CATALOGUE
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QU'IL SUPPRIME, ET CE QU'IL GARDE — LA LIGNE EST UNE DÉCISION, PAS UNE COMMODITÉ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Décision du CEO (17/09/2026) : « je veux revenir à la donnée primaire, pas préserver l'ancien
 * catalogue ni ses enrichissements ». L'agrégateur n'est pas ouvert aux utilisateurs ; son
 * catalogue peut être supprimé et reconstruit par une collecte neuve avec captures natives.
 *
 * SUPPRIMÉ — le corpus et TOUT ce qui en est dérivé :
 *   Job, JobSource, SourceObservation, JobEvent, OccupationObservation, MarketSnapshot,
 *   SourceRun, PipelineRun, PipelineEvent, PostingScopeDecision, PublicationIdentityDecision,
 *   SourceFieldTrust(+Observation), GeoCache, DirectFeedCursor, et les DataCorrection portant
 *   sur une offre.
 *
 * Trois de ces suppressions méritent leur justification, parce qu'elles coûtent :
 *   · `GeoCache` (1 950 lignes) — ce sont des appels d'API de géocodage déjà payés. Le CEO a
 *     tranché : « supprime les géocodages mis en cache ». Les garder réinjecterait nos anciennes
 *     affectations géographiques dans un corpus qu'on veut justement pouvoir auditer à neuf.
 *   · `SourceFieldTrust` (114) — c'est un APPRENTISSAGE dérivé des offres (taux d'accord et de
 *     contradiction par champ). Il décrit l'ancien corpus, pas la source.
 *   · `DataCorrection` où `entityType` vaut Job, JobSource ou PostingMerge (20 337 sur 20 652) —
 *     nos anciennes interprétations. Les 254 autres (Source, Company, CompanyAlias,
 *     OccupationState) sont de la CONFIGURATION et restent.
 *
 * CONSERVÉ — le socle de collecte, et lui seul :
 *   Source (437 ACTIVE + 92 RETIRED + 7 PAUSED), SourceRevision, SourceIdentityReview,
 *   SourceAccessDecision, SourceAccessArchive, Company, CompanyAlias, EmployerIdentityReview,
 *   SectorConcept, SectorReview, OccupationState, OccupationRelease, MaintenancePlan,
 *   DataCorrection de configuration.
 *
 * Pourquoi garder `Source` : sans elle, `loadActiveSources` lève « Source table is empty » et il
 * n'y a plus RIEN à collecter. C'est « où collecter, comment collecter, pourquoi la source est
 * admise » — précisément ce que le CEO a demandé de préserver.
 *
 * Pourquoi garder `Company` : `Job.companyId` est NOT NULL et l'ingestion résout la Maison par
 * son identité. Les 53 revues d'identité d'employeur sont un travail manuel non reconstructible.
 * `EmployerObservation` (75 051) est en revanche dérivé des offres — il part.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  L'ORDRE, ET POURQUOI IL N'EST PAS NÉGOCIABLE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Les clés étrangères sont presque toutes en RESTRICT (relevé le 17/09) : supprimer un parent
 * avant ses enfants échoue. L'ordre ci-dessous descend des feuilles vers les racines, et chaque
 * étape est vérifiée. Une seule transaction : un reset à moitié fait laisserait une base dans un
 * état qu'aucun code ne sait lire.
 *
 * `OccupationObservation` référence `Job` en RESTRICT — c'est pour cela qu'il part AVANT `Job`,
 * et non par choix éditorial.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QU'IL NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Il ne touche AUCUNE autre base Catwalks. Il vérifie d'ailleurs, avant toute écriture, que la
 * base cible porte bien la signature de l'agrégateur (Job/JobSource/Source présentes, et AUCUNE
 * table candidat) — l'incident du 23/08/2026 est venu d'une commande lancée sur la mauvaise base.
 *
 * Il ne lance aucune collecte, n'active aucun CRON, ne déploie rien.
 */
import { PrismaClient } from '@prisma/client';

const MOT_DE_PASSE = 'OUI-JE-SUPPRIME-LE-CATALOGUE';
const ECRIRE = process.argv.includes('--ecrire') && process.argv.includes(MOT_DE_PASSE);

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/**
 * L'ordre de suppression, des feuilles vers les racines.
 *
 * Chaque entrée porte sa raison : sans elle, un lecteur futur ne peut pas distinguer « dérivé des
 * offres, donc à supprimer » de « configuration, supprimée par erreur ».
 */
const PURGE: ReadonlyArray<{ table: string; raison: string; ou?: string }> = [
  // ── Dérivés d'offres, feuilles d'abord ──────────────────────────────────────────────────────
  { table: 'JobEvent', raison: "journal d'événements des offres" },
  { table: 'OccupationObservation', raison: 'classification métier observée — référence Job en RESTRICT' },
  { table: 'MarketSnapshot', raison: 'instantanés de marché calculés sur le catalogue' },
  { table: 'PostingScopeDecision', raison: "décisions de périmètre d'annonce, dérivées des offres" },
  { table: 'PublicationIdentityDecision', raison: "décisions d'identité de publication" },
  { table: 'SourceFieldTrustObservation', raison: 'observations de confiance par champ, dérivées du corpus' },
  { table: 'SourceFieldTrust', raison: "apprentissage de confiance par champ — décrit l'ancien corpus" },
  { table: 'EmployerObservation', raison: "observations d'employeur dérivées des offres" },
  { table: 'DirectOfferEvent', raison: "événements des offres directes" },
  { table: 'DirectOffer', raison: 'offres directes du catalogue' },
  { table: 'DirectFeedCursor', raison: "curseur de reprise — un « déjà traité » bloquerait la nouvelle collecte" },
  { table: 'GeoCache', raison: 'géocodages mis en cache — décision CEO : ne pas réinjecter nos affectations' },
  {
    table: 'DataCorrection',
    raison: 'corrections portant sur une OFFRE ; celles de configuration (Source, Company, CompanyAlias, OccupationState) restent',
    ou: `"entityType" IN ('Job','JobSource','PostingMerge')`,
  },

  // ── Le corpus lui-même ──────────────────────────────────────────────────────────────────────
  { table: 'JobSource', raison: 'publications du catalogue' },
  { table: 'Job', raison: 'offres du catalogue' },
  { table: 'SourceObservation', raison: "sorties d'adaptateur historisées de l'ancien corpus" },

  // ── États de reprise et journaux d'exécution ────────────────────────────────────────────────
  { table: 'SourceRun', raison: "exécutions par source — un état de reprise empêcherait de repeupler" },
  { table: 'PipelineEvent', raison: "journal du pipeline de l'ancien corpus" },
  { table: 'PipelineRun', raison: 'exécutions du pipeline' },

  // ── Capture : déjà vides, purgées par sécurité pour repartir d'un état net ───────────────────
  { table: 'SourceIngestionCompletion', raison: "achèvements d'ingestion de l'ancien corpus" },
  { table: 'SourceIngestionAdmission', raison: "admissions d'ingestion de l'ancien corpus" },
  { table: 'CaptureOutcome', raison: 'résultats de capture' },
  { table: 'SourceExtraction', raison: "sorties d'extraction" },
  { table: 'RawCapture', raison: 'tentatives de capture' },
  { table: 'RawBlobArchive', raison: 'localisations distantes des blobs' },
  { table: 'RawBlobBody', raison: 'corps compressés des blobs' },
  { table: 'RawBlob', raison: 'identités de blobs' },
  { table: 'CaptureBatch', raison: 'lots de capture' },
];

/** Les tables qui DOIVENT survivre, et dont on vérifie le compte avant/après. */
const SOCLE = [
  'Source', 'SourceRevision', 'SourceIdentityReview', 'SourceAccessDecision', 'SourceAccessArchive',
  'Company', 'CompanyAlias', 'EmployerIdentityReview', 'SectorConcept', 'SectorReview',
  'OccupationState', 'OccupationRelease', 'MaintenancePlan',
] as const;

async function compter(table: string): Promise<number> {
  try {
    const [r] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${table}"`);
    return r.n;
  } catch {
    return -1; // table absente du schéma : signalée, jamais silencieuse
  }
}

async function main(): Promise<number> {
  /*
   * GARDE D'IDENTITÉ DE BASE — avant toute écriture, et pas après.
   *
   * L'incident du 23/08/2026 a vidé la base de production parce qu'une commande a reçu la mauvaise
   * URL. Ici, on refuse d'écrire si la base ne porte pas la signature de l'agrégateur : ses tables
   * de catalogue présentes, ET aucune table du backend candidat.
   */
  const [ident] = await prisma.$queryRawUnsafe<Array<{ base: string }>>('SELECT current_database() AS base');
  const tables = await prisma.$queryRawUnsafe<Array<{ n: string }>>(
    `SELECT table_name AS n FROM information_schema.tables WHERE table_schema='public'`,
  );
  const noms = new Set(tables.map((t) => t.n));
  const signature = ['Job', 'JobSource', 'Source', 'Company'].every((t) => noms.has(t));
  const etranger = ['User', 'Candidate', 'Application'].filter((t) => noms.has(t));

  console.log(`\nBASE CIBLE : ${ident.base} · ${noms.size} tables`);
  if (!signature || etranger.length) {
    console.error(
      `REFUS : cette base ne porte pas la signature de l'agrégateur.` +
        (etranger.length ? ` Tables étrangères détectées : ${etranger.join(', ')}.` : '') +
        ` Aucune écriture.`,
    );
    return 2;
  }
  console.log(`   signature agrégateur vérifiée (aucune table candidat).`);

  console.log(`\nÀ SUPPRIMER :`);
  let total = 0;
  for (const e of PURGE) {
    const n = await compter(e.table);
    if (n < 0) { console.log(`   ${e.table.padEnd(30)} table absente du schéma`); continue; }
    const cible = e.ou
      ? (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${e.table}" WHERE ${e.ou}`))[0].n
      : n;
    total += cible;
    console.log(`   ${e.table.padEnd(30)} ${String(cible).padStart(8)}${e.ou ? ` / ${n} (filtré)` : ''}   ${e.raison}`);
  }
  console.log(`   ${''.padEnd(30)} ${String(total).padStart(8)}   TOTAL`);

  console.log(`\nÀ CONSERVER (socle de collecte) :`);
  const avant: Record<string, number> = {};
  for (const t of SOCLE) {
    avant[t] = await compter(t);
    if (avant[t] > 0) console.log(`   ${t.padEnd(30)} ${String(avant[t]).padStart(8)}`);
  }

  if (!ECRIRE) {
    console.log(`\nINSPECTION SEULEMENT — rien n'a été supprimé.`);
    console.log(`Pour exécuter : --ecrire ${MOT_DE_PASSE}`);
    return 0;
  }

  /*
   * UNE SEULE TRANSACTION. Un reset à moitié fait — les offres parties, leurs publications
   * restées — laisserait une base qu'aucun code ne sait lire et que rien ne signale.
   */
  console.log(`\nSUPPRESSION EN COURS...`);
  await prisma.$transaction(
    async (tx) => {
      for (const e of PURGE) {
        if ((await compter(e.table)) < 0) continue;
        const sql = e.ou ? `DELETE FROM "${e.table}" WHERE ${e.ou}` : `DELETE FROM "${e.table}"`;
        const n = await tx.$executeRawUnsafe(sql);
        console.log(`   ${e.table.padEnd(30)} ${String(n).padStart(8)} supprimées`);
      }
    },
    { maxWait: 60_000, timeout: 1_800_000 },
  );

  /*
   * VÉRIFICATION APRÈS COUP — le socle a-t-il survécu ?
   *
   * Une suppression en cascade non anticipée emporterait le registre des sources sans rien dire,
   * et la collecte suivante échouerait sur « Source table is empty » sans qu'on sache pourquoi.
   */
  console.log(`\nVÉRIFICATION DU SOCLE :`);
  let intact = true;
  for (const t of SOCLE) {
    const apres = await compter(t);
    const ok = apres === avant[t];
    if (!ok) intact = false;
    if (avant[t] > 0 || !ok) console.log(`   ${t.padEnd(30)} ${String(avant[t]).padStart(7)} → ${String(apres).padStart(7)}  ${ok ? 'intact' : '⚠ MODIFIÉ'}`);
  }

  const restants = await compter('Job');
  const pubs = await compter('JobSource');
  console.log(`\nCATALOGUE : Job ${restants} · JobSource ${pubs}`);
  console.log(intact && restants === 0 && pubs === 0
    ? `\n✔ RESET COMPLET — le socle de collecte est intact, le catalogue est vide.`
    : `\n⚠ ÉTAT INATTENDU — vérifier avant toute collecte.`);

  return intact && restants === 0 ? 0 : 1;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

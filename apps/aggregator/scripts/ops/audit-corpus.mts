/**
 * CONSTITUTION DU CORPUS DE RÉFÉRENCE — un INSTANTANÉ cohérent, daté et rejouable.
 *
 *   AUDIT_DATABASE_URL='postgresql://catwalks_audit:...' \
 *     npx tsx apps/aggregator/scripts/ops/audit-corpus.mts
 *
 * ── POURQUOI UNE TRANSACTION, ET NON UN HORODATAGE ─────────────────────────────────────────────
 *
 * La première version notait `now()` au départ et lisait table après table. Ça ne fige RIEN : une
 * ligne modifiée pendant l'export est lue dans son état NOUVEAU, et une ligne déjà exportée dans
 * son état ANCIEN. Le corpus mélange alors deux états du monde, et ses liens peuvent pointer vers
 * des lignes qui n'ont jamais coexisté. Un horodatage, une borne d'identifiants ou un filtre sur
 * `createdAt` ne corrigent aucun de ces cas : ils ne disent rien des MODIFICATIONS.
 *
 * La seule garantie réelle est une transaction `REPEATABLE READ` : toutes les requêtes y voient le
 * MÊME instantané, pris à la première d'entre elles. `now()` y est également figé, ce qui rend le
 * calcul d'expiration (`publiable`) cohérent avec les lignes lues — un `now()` qui avancerait
 * pendant l'export ferait expirer des publications en cours de lecture.
 *
 * ── COMPLÉTUDE : TOUT OU RIEN ──────────────────────────────────────────────────────────────────
 *
 * Le manifeste est écrit EN DERNIER, et un export interrompu n'en produit aucun. Un corpus sans
 * `manifeste.json` est incomplet par construction : aucune analyse ne doit l'utiliser.
 *
 * ── CE QU'IL EXPORTE, ET POURQUOI ──────────────────────────────────────────────────────────────
 *
 *   Source ──< CaptureBatch ──< RawCapture ──> RawBlob (métadonnées)
 *                    │              └──< SourceExtraction ──< JobSource ──> Job ──> Company
 *                    └── CaptureOutcome
 *
 * `CaptureBatch.sourceKey` relie les captures à leur source SANS passer par `JobSource` : c'est ce
 * qui rend visible une source qui a capturé des données mais n'a jamais rien publié. Se fier à
 * `JobSource.jobId IS NULL` manquerait ce cas — une telle source n'a AUCUNE ligne `JobSource`.
 *
 * Les CORPS (`RawBlobBody.gzip`) ne sont pas exportés : ce sont des `Bytes` gzip, plusieurs Go.
 * Leurs métadonnées (hash, tailles) le sont, ce qui rend chaque corps récupérable à la demande par
 * son hash, sans dupliquer le volume.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { createWriteStream, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { ouvrirAccesAudit } from './audit-acces.ts';

/*
 * LE CONTRÔLE D'ACCÈS N'EST PAS CONTOURNABLE EN LANÇANT CE SCRIPT DIRECTEMENT : il est exécuté
 * ICI, à l'ouverture, et `ouvrirAccesAudit` refuse de rendre un client si les huit contrôles ne
 * passent pas. Refuser le seul nom « postgres » ne prouvait rien — un autre compte peut être
 * superutilisateur, hériter d'un rôle, ou écrire via PUBLIC.
 */
const { prisma, profil } = await ouvrirAccesAudit();
console.log(`\n═══ CORPUS DE RÉFÉRENCE ═══\n  rôle : ${profil.role} (privilèges vérifiés)\n`);

const revision = execSync('git rev-parse --short HEAD').toString().trim();
const branche = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

/** Une table à exporter : son nom de fichier et la requête qui la lit, ordonnée par clé stable. */
type Table = { nom: string; sql: string; cle: string };

const TABLES: Table[] = [
  // LE RÉFÉRENTIEL — toutes les sources, y compris celles qui ne publient rien.
  { nom: 'sources', cle: 'id', sql:
    `SELECT t.id, t.key, t.maison, t.kind::text AS kind, t.status::text AS status, t.tier,
            t."tenantKey", t."portalScope"::text AS "portalScope", t."careersDomain",
            t."lastRunAt", t."lastRunStatus", t."lastRunJobs", t."createdAt", t."updatedAt"
       FROM "Source" t` },

  // LES LOTS DE COLLECTE — le pivot qui relie les captures à leur source SANS JobSource.
  { nom: 'lots-collecte', cle: 'id', sql:
    `SELECT t.id, t."sourceKey", t.purpose::text AS purpose, t."runId", t."configHash",
            t."readerRevision", t."sourceKind", t."formatVersion", t."startedAt",
            t."sourceRevisionId", t."accessDecisionId"
       FROM "CaptureBatch" t` },

  // LE VERDICT DE CHAQUE LOT — `extractedCount` est PAR LOT, jamais par offre.
  { nom: 'resultats-collecte', cle: 'batchId', sql:
    `SELECT t."batchId", t.status, t."extractedCount", t."outputHash", t."manifestHash",
            t."transportCoverage", t.failure, t."completedAt"
       FROM "CaptureOutcome" t` },

  // LES CAPTURES NATIVES — sans les corps (Bytes gzip, plusieurs Go), avec leurs hash.
  { nom: 'captures', cle: 'id', sql:
    `SELECT t.id, t."batchId", t.sequence, t."requestHash", t."requestUrl", t.method, t.format,
            t.status, t.complete, t.failure, t."blobHash", t."requestDataHash", t."capturedAt"
       FROM "RawCapture" t` },

  // LES MÉTADONNÉES DES CORPS — rendent chaque corps récupérable par son hash, sans le dupliquer.
  { nom: 'corps-metadonnees', cle: 'hash', sql:
    `SELECT t.hash, t."byteLength", t."gzipHash", t."gzipLength", t."createdAt",
            (b.hash IS NOT NULL) AS corps_en_base, (a.hash IS NOT NULL) AS corps_archive
       FROM "RawBlob" t
       LEFT JOIN "RawBlobBody" b ON b.hash = t.hash
       LEFT JOIN "RawBlobArchive" a ON a.hash = t.hash` },

  // LES SORTIES D'ADAPTATEUR — une par offre et par lot.
  { nom: 'extractions', cle: 'id', sql:
    `SELECT t.id, t."batchId", t.ordinal, t."externalId", t."outputHash", t."capturedAt"
       FROM "SourceExtraction" t` },

  // LES PUBLICATIONS, avec leur RAW natif. `jobId` nullable conservé tel quel.
  { nom: 'publications', cle: 'id', sql:
    `SELECT t.id, t."sourceKey", t."externalId", t."jobId", t."captureBatchId", t."captureOutputId",
            t."isActive", t."expiresAt", t."sourceTier", t.url, t.title, t.raw,
            t."quarantinedAt", t."quarantineReason", t."firstSeenAt", t."lastSeenAt"
       FROM "JobSource" t` },

  // LES OFFRES CANONIQUES — avec LES DEUX prédicats de population, calculés dans l'instantané.
  { nom: 'offres', cle: 'id', sql:
    `SELECT t.id, t.source::text AS source, t."companyId", t.title,
            t."countryCode", t.city, t."adminArea1", t.latitude, t.longitude,
            t."isActive", t."mergedIntoId",
            (t."isActive" AND t."mergedIntoId" IS NULL AND EXISTS (
               SELECT 1 FROM "JobSource" s WHERE s."jobId" = t.id AND s."isActive"
                 AND (s."expiresAt" IS NULL OR s."expiresAt" > now()))) AS publiable,
            t."workplaceType", t."employmentTerm", t."workTime", t."programType", t."isSeasonal",
            t."experienceYears", t.seniority, t."salaryMin", t."salaryMax", t."salaryCurrency",
            t."salaryPeriod", t.department, t."jobFunction", t."occupationCode", t.language,
            t."educationLevel", t."workSchedule", t."rawSchedule", t."engagementType",
            t."rawContract", t."rawWorkingTime", t."countryIntegrity", t."opportunityType",
            t."createdAt", t."updatedAt"
       FROM "Job" t` },

  // LES MAISONS — `sectorCodes` porte le SECTEUR, distinct du métier et de la famille de métier.
  { nom: 'maisons', cle: 'id', sql:
    `SELECT t.id, t.name, t."canonicalKey", t.sector::text AS sector, t."sectorCodes",
            t."parentGroup", t."parentGroupId", t."atsType"::text AS "atsType",
            t."createdAt", t."updatedAt"
       FROM "Company" t` },

  // LES OFFRES DIRECTES — le catalogue public en comprend deux origines.
  { nom: 'offres-directes', cle: 'id', sql:
    `SELECT t.id, t.slug, t.title, t.company, t.eligible, t."validThrough", t."countryCode",
            t.city, t."workplaceType", t."employmentTerm", t."workTime", t."programType",
            t."engagementType", t."sectorCodes", t."occupationLabel", t.language,
            t."salaryMin", t."salaryMax", t."salaryCurrency", t."salaryPeriod",
            t."postedAt", t."receivedAt", t."updatedAt"
       FROM "DirectOffer" t` },
];

const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dossier = `backups/corpus-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const compte: Record<string, number> = {};
let instantane = '';
let horlogeInstantane = '';

try {
  /*
   * L'INSTANTANÉ. Tout l'export vit dans UNE transaction REPEATABLE READ : chaque requête y voit
   * le même état, et `now()` y est figé. Le délai est large parce qu'un export complet est long —
   * mais il reste borné : une transaction qui traîne indéfiniment gênerait le nettoyage du
   * serveur (`VACUUM`), et c'est une nuisance qu'un audit n'a pas le droit de causer.
   */
  await prisma.$transaction(async (tx) => {
    const [{ txid, maintenant }] = await tx.$queryRawUnsafe<Array<{ txid: string; maintenant: Date }>>(
      'SELECT txid_current()::text AS txid, now() AS maintenant');
    instantane = txid;
    horlogeInstantane = maintenant.toISOString();
    console.log(`  instantané : transaction ${txid}, horloge figée à ${horlogeInstantane}\n`);

    for (const table of TABLES) {
      const chemin = `${dossier}/${table.nom}.jsonl`;
      const flux = createWriteStream(chemin, { encoding: 'utf8' });
      let curseur: string | null = null;
      let total = 0;

      /*
       * Pagination par CURSEUR sur clé stable, jamais OFFSET. Dans l'instantané, l'ordre est
       * stable et aucune ligne n'apparaît ni ne disparaît — le curseur garantit en plus qu'aucune
       * page n'est relue si la requête est redécoupée.
       */
      for (;;) {
        const page: Record<string, unknown>[] = await tx.$queryRawUnsafe(
          `${table.sql} ${curseur ? `WHERE t."${table.cle}" > $1` : ''}` +
          ` ORDER BY t."${table.cle}" LIMIT 2000`,
          ...(curseur ? [curseur] : []),
        );
        if (!page.length) break;
        for (const ligne of page) flux.write(`${JSON.stringify(ligne, remplacant)}\n`);
        curseur = String(page[page.length - 1][table.cle]);
        total += page.length;
      }
      await new Promise<void>((r) => flux.end(r));
      compte[table.nom] = total;
      console.log(`  ✓ ${table.nom.padEnd(22)} ${total}`);
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 3_600_000, maxWait: 30_000 });
} catch (e) {
  /*
   * UN EXPORT INTERROMPU N'EST JAMAIS DÉCLARÉ COMPLET. Le dossier est supprimé : un corpus
   * partiel laissé sur le disque finirait par être analysé comme s'il était entier, et l'écart
   * serait indétectable — les fichiers ont la même forme, seuls les volumes diffèrent.
   */
  rmSync(dossier, { recursive: true, force: true });
  console.error(`\n✗ EXPORT INTERROMPU — le dossier ${dossier} a été supprimé.`);
  console.error(`  Aucun corpus partiel n'est conservé : il serait indistinguable d'un corpus complet.`);
  console.error(`  Cause : ${String(e)}`);
  await prisma.$disconnect();
  process.exit(1);
}

/** `BigInt` et `Decimal` ne sont pas sérialisables en JSON : on les rend en texte, sans perte. */
function remplacant(_cle: string, valeur: unknown): unknown {
  if (typeof valeur === 'bigint') return valeur.toString();
  if (valeur && typeof valeur === 'object' && 'toFixed' in valeur && typeof (valeur as { toFixed: unknown }).toFixed === 'function')
    return String(valeur);
  return valeur;
}

/*
 * LE MANIFESTE EST ÉCRIT EN DERNIER. Sa présence EST la preuve de complétude : un corpus sans
 * manifeste a été interrompu, et aucune analyse ne doit l'utiliser.
 */
const [{ version }] = await prisma.$queryRawUnsafe<Array<{ version: string }>>('SELECT version()');
writeFileSync(`${dossier}/manifeste.json`, `${JSON.stringify({
  complet: true,
  instantane: { transaction: instantane, horlogeFigee: horlogeInstantane, isolation: 'REPEATABLE READ' },
  role: profil.role,                         // jamais l'URL ni le mot de passe
  serveur: version.split(' ').slice(0, 2).join(' '),
  codeLocal: { branche, revision },
  codeDeploye: process.env.AUDIT_REVISION_DEPLOYEE ?? 'NON RENSEIGNÉ',
  compte,
  avertissements: [
    'Les corps des captures (RawBlobBody.gzip) ne sont PAS dans ce corpus : seules leurs ' +
    'métadonnées le sont. Un corps se récupère par son hash, à la demande.',
    'Le code LOCAL n\'est pas celui qui a canonisé ces données : elles l\'ont été par le code ' +
    'DÉPLOYÉ au moment de leur collecte. Toute comparaison avant/après doit distinguer les deux.',
    'CaptureOutcome.extractedCount est PAR LOT, jamais par offre : le sommer compte chaque offre ' +
    'autant de fois qu\'elle a été recollectée.',
  ],
}, null, 2)}\n`, 'utf8');

console.log(`\n  ✓ manifeste.json — corpus COMPLET`);
console.log(`  code déployé : ${process.env.AUDIT_REVISION_DEPLOYEE ?? 'NON RENSEIGNÉ (poser AUDIT_REVISION_DEPLOYEE)'}`);
console.log(`\n═══ ${dossier} ═══\n`);

await prisma.$disconnect();

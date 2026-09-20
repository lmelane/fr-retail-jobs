/**
 * CONSTITUTION DU CORPUS DE RÉFÉRENCE — une copie datée, cohérente et rejouable.
 *
 *   AUDIT_DATABASE_URL='postgresql://catwalks_audit:...' \
 *     npx tsx apps/aggregator/scripts/ops/audit-corpus.mts
 *
 * ── POURQUOI UN CORPUS PLUTÔT QUE DES LECTURES RÉPÉTÉES ────────────────────────────────────────
 *
 * Chaque rejeu d'analyse sur la production coûte des lectures, ne rend pas deux fois le même
 * résultat (le catalogue bouge), et rend les comparaisons avant/après impossibles à interpréter :
 * on ne sait jamais si un écart vient du correctif ou du corpus. Un corpus daté fige la
 * population, et toute analyse ultérieure porte alors sur les MÊMES données.
 *
 * ── CE QU'IL CONSERVE, ET POURQUOI ─────────────────────────────────────────────────────────────
 *
 * La chaîne complète, avec ses liens — un RAW sans sa source ni son offre ne permet de mesurer
 * aucune canonisation :
 *
 *   Source ──< JobSource (publication, `jobId` NULLABLE) ──> Job (offre canonique)
 *                    │
 *                    └── `raw` : la charge utile native de l'offre
 *
 * `JobSource.jobId` étant nullable, les publications SANS offre canonique sont conservées : c'est
 * exactement la population « RAW présent, aucune offre publiée » à instruire.
 *
 * ── CE QU'IL NE FAIT PAS ───────────────────────────────────────────────────────────────────────
 *
 * Aucune écriture en production. Aucun identifiant n'est écrit dans le corpus ni dans les
 * rapports : `AUDIT_DATABASE_URL` reste dans l'environnement, jamais dans un fichier du dépôt.
 * Le corpus lui-même est écrit hors dépôt (`backups/`, ignoré par git) parce qu'il contient des
 * données d'offres.
 */
import { PrismaClient } from '@prisma/client';
import { createWriteStream, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const url = process.env.AUDIT_DATABASE_URL;
if (!url) {
  console.error('AUDIT_DATABASE_URL absente. Ce script ne se rabat sur aucun autre accès.');
  process.exit(2);
}
if (/(^|:\/\/)postgres:/.test(url)) {
  console.error('GARDE-FOU : le rôle `postgres` est refusé. Le compte d\'audit est exigé.');
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...p);

/* Le corpus est identifié par l'INSTANT DE DÉBUT, figé une fois : toutes les tables sont lues
 * avec la même borne, sinon les liens entre elles seraient incohérents. */
const [{ now }] = await q<{ now: Date }>('SELECT now() AS now');
const horodatage = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dossier = `backups/corpus-${horodatage}`;
mkdirSync(dossier, { recursive: true });

/** La révision du code qui LIT le corpus — à ne pas confondre avec celle qui a produit les données. */
const revisionLocale = execSync('git rev-parse --short HEAD').toString().trim();
const brancheLocale = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

console.log(`\n═══ CORPUS DE RÉFÉRENCE ═══\n  instant : ${now.toISOString()}\n  dossier : ${dossier}`);
console.log(`  code local : ${brancheLocale} @ ${revisionLocale}\n`);

/**
 * Écrit une table en JSONL par pages, sans jamais charger l'ensemble en mémoire.
 * Le curseur porte sur une colonne stable et unique, jamais sur OFFSET : un OFFSET sur une table
 * qui bouge saute ou duplique des lignes.
 */
async function exporter(nom: string, sql: string, cle = 'id'): Promise<number> {
  const flux = createWriteStream(`${dossier}/${nom}.jsonl`, { encoding: 'utf8' });
  let curseur: string | null = null;
  let total = 0;
  for (;;) {
    const page: Record<string, unknown>[] = await q(
      `${sql} ${curseur ? `AND t."${cle}" > $1` : ''} ORDER BY t."${cle}" LIMIT 2000`,
      ...(curseur ? [curseur] : []),
    );
    if (!page.length) break;
    for (const ligne of page) flux.write(`${JSON.stringify(ligne)}\n`);
    curseur = String(page[page.length - 1][cle]);
    total += page.length;
    if (total % 20000 === 0) console.log(`    … ${nom} : ${total}`);
  }
  await new Promise<void>((r) => flux.end(r));
  console.log(`  ✓ ${nom.padEnd(16)} ${total}`);
  return total;
}

const compte: Record<string, number> = {};

// Les sources : le référentiel, y compris celles qui ne publient rien.
compte.sources = await exporter('sources',
  `SELECT t.id, t.key, t.kind::text AS kind, t.status::text AS status, t.company, t."countryCode",
          t."createdAt", t."updatedAt"
     FROM "Source" t WHERE true`);

/* Les publications AVEC leur RAW. `jobId` nullable est conservé tel quel : une publication sans
 * offre canonique est le cas le plus intéressant à instruire, pas une anomalie à filtrer. */
compte.publications = await exporter('publications',
  `SELECT t.id, t."sourceKey", t."externalId", t."jobId", t."isActive", t."expiresAt",
          t."sourceTier"::text AS "sourceTier", t.url, t.raw, t."createdAt", t."updatedAt"
     FROM "JobSource" t WHERE true`);

/* Les offres canoniques, avec LES DEUX prédicats de population : `isActive` (le modèle) et
 * `publiable` (ce que le produit expose). Les calculer ici évite de les redériver à chaque
 * analyse, et rend l'écart mesurable sans relire la production. */
compte.offres = await exporter('offres',
  `SELECT t.id, t.source::text AS source, t."countryCode", t.city, t."adminArea1",
          t."isActive", t."mergedIntoId",
          (t."isActive" AND t."mergedIntoId" IS NULL AND EXISTS (
             SELECT 1 FROM "JobSource" s WHERE s."jobId" = t.id AND s."isActive"
               AND (s."expiresAt" IS NULL OR s."expiresAt" > now()))) AS publiable,
          t."workplaceType"::text AS "workplaceType", t."employmentTerm"::text AS "employmentTerm",
          t."workTime"::text AS "workTime", t."programType"::text AS "programType",
          t."isSeasonal", t."experienceYears", t.seniority::text AS seniority,
          t."salaryMin", t."salaryMax", t.department, t."jobFunction", t.language,
          t."educationLevel"::text AS "educationLevel", t."workSchedule"::text AS "workSchedule",
          t."engagementType"::text AS "engagementType",
          t.title, t."companyId", t."createdAt", t."updatedAt"
     FROM "Job" t WHERE true`);

/* Le manifeste : ce qui rend le corpus rejouable et comparable. Sans lui, un corpus est un tas
 * de fichiers dont on ne sait ni quand ni contre quel code il a été produit. */
const [{ version }] = await q<{ version: string }>('SELECT version()');
const [{ role }] = await q<{ role: string }>('SELECT current_user AS role');
const manifeste = {
  instant: now.toISOString(),
  dossier,
  role,                       // le rôle d'audit — jamais l'URL ni le mot de passe
  serveur: version.split(' ').slice(0, 2).join(' '),
  codeLocal: { branche: brancheLocale, revision: revisionLocale },
  codeDeploye: process.env.AUDIT_REVISION_DEPLOYEE ?? 'NON RENSEIGNÉ',
  compte,
  avertissement:
    'Le code LOCAL n\'est pas celui qui a produit ces données. Les offres ont été canonisées par ' +
    'le code DÉPLOYÉ au moment de leur collecte : toute comparaison avant/après doit porter sur ' +
    'les mêmes données, en distinguant les deux révisions.',
};
const { writeFileSync } = await import('node:fs');
writeFileSync(`${dossier}/manifeste.json`, `${JSON.stringify(manifeste, null, 2)}\n`, 'utf8');

console.log(`\n  ✓ manifeste.json`);
console.log(`\n  Code déployé : ${manifeste.codeDeploye}`);
if (manifeste.codeDeploye === 'NON RENSEIGNÉ')
  console.log('    (renseigner AUDIT_REVISION_DEPLOYEE pour tracer la comparaison avant/après)');
console.log(`\n═══ CORPUS CONSTITUÉ ═══\n`);

await prisma.$disconnect();

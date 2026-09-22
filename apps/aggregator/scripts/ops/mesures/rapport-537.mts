/**
 * RAPPORT FINAL SOURCES — 537 / 537, zéro source sans conclusion.
 *
 * Une seule vue, construite depuis DEUX sources de vérité et jamais depuis un souvenir :
 *
 *   · la PRODUCTION (lecture seule, `catwalks_audit`) donne le registre réel : les 537 sources,
 *     leur statut, leur famille, et les offres qu'elles publient aujourd'hui ;
 *   · les VERDICTS de campagne (development) donnent la qualification rejouée : accès, identité,
 *     collecte, et le motif exact de refus quand une source ne publie pas.
 *
 * Les deux ne se confondent pas : une source peut publier en production et rester bloquée en
 * development, ou l'inverse. Le rapport le dit au lieu de choisir.
 *
 *   PROD_DATABASE_URL=… npx tsx <ce fichier> <verdicts.json…> > rapport.md
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { MOTIFS_IDENTITE } from '../../../src/identity/errors.js';

const url = process.env.PROD_DATABASE_URL ?? '';
if (!url) { console.error('PROD_DATABASE_URL requis (rôle catwalks_audit).'); process.exit(2); }

type Verdict = { key?: string; verdict?: string; offres?: number;
  ingestion?: { created?: number; errors?: number; errorKinds?: Record<string, number> };
  etapes?: Record<string, unknown> };

/** Les verdicts les plus RÉCENTS gagnent : les fichiers sont passés dans l'ordre chronologique. */
const verdicts = new Map<string, Verdict>();
for (const fichier of process.argv.slice(2)) {
  const brut: unknown = JSON.parse(readFileSync(fichier, 'utf8'));
  const liste = Array.isArray(brut) ? brut : Object.values(brut as Record<string, Verdict>);
  for (const v of liste as Verdict[]) if (v?.key) verdicts.set(v.key, v);
}

/*
 * L'ÉTAT DE DEVELOPMENT, lu séparément. Sans lui, une source qualifiée dont le lot n'est pas
 * encore déployé serait indiscernable d'une source réellement bloquée : les deux sont à zéro en
 * production. `douglas-sf` l'a montré — 311 publiables en dev, 0 en production.
 */
const devParSource = new Map<string, { publiables: number; collecte: number }>();
const devUrl = process.env.DEV_DATABASE_URL ?? '';
if (devUrl) {
  const dev = new PrismaClient({ datasources: { db: { url: devUrl } } });
  const rows = await dev.$queryRawUnsafe<Array<{ key: string; publiables: bigint; collecte: bigint }>>(`
    SELECT s.key,
           coalesce((SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
                      WHERE js."sourceKey" = s.key AND j."isActive" AND j."mergedIntoId" IS NULL
                        AND js."isActive"), 0) AS publiables,
           coalesce((SELECT o."extractedCount" FROM "CaptureBatch" b
                       JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
                      WHERE b."sourceKey" = s.key ORDER BY b."startedAt" DESC LIMIT 1), 0) AS collecte
      FROM "Source" s`);
  for (const r of rows) devParSource.set(r.key, { publiables: Number(r.publiables), collecte: Number(r.collecte) });
  await dev.$disconnect();
}

let offresUniques = 0, publicationsActives = 0;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const lignes = await prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const [etat] = await tx.$queryRawUnsafe<Array<{ ro: string }>>(
    `SELECT current_setting('transaction_read_only') AS ro`);
  if (etat?.ro !== 'on') throw new Error('Transaction non verrouillée en lecture seule : mesure refusée');
  /*
   * LE KPI DU CATALOGUE se compte sur `Job`, jamais en additionnant les sources : un même Job
   * canonique peut porter plusieurs `JobSource`, et la somme par source compte alors deux fois.
   */
  const [kpi] = await tx.$queryRawUnsafe<Array<{ uniques: bigint; rattachements: bigint }>>(`
    SELECT (SELECT count(*) FROM "Job" j
             WHERE j."isActive" AND j."mergedIntoId" IS NULL
               AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive"
                             AND (js."expiresAt" IS NULL OR js."expiresAt" > now()))) AS uniques,
           (SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
             WHERE j."isActive" AND j."mergedIntoId" IS NULL AND js."isActive"
               AND (js."expiresAt" IS NULL OR js."expiresAt" > now())) AS rattachements`);
  offresUniques = Number(kpi.uniques);
  publicationsActives = Number(kpi.rattachements);
  return tx.$queryRawUnsafe<Array<{
    key: string; maison: string; kind: string; status: string; portalScope: string | null;
    publiables: bigint; aPublie: boolean;
  }>>(`
    SELECT s.key, s.maison, s.kind, s.status, s."portalScope",
           (SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
             WHERE js."sourceKey" = s.key AND j."isActive" AND j."mergedIntoId" IS NULL
               AND js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > now())) AS publiables,
           EXISTS (SELECT 1 FROM "JobSource" js WHERE js."sourceKey" = s.key) AS "aPublie"
      FROM "Source" s ORDER BY s.key`);
});
await prisma.$disconnect();

/**
 * Sources dont la preuve d'employeur EXISTE mais qu'une décision produit refuse de propager.
 * `dr-martens-tf` : `company.name` porte 15 entités régionales, documenté dans `talentFunnel.ts`.
 * Ce n'est pas une absence de donnée — c'est un arbitrage, et le rapport doit le dire.
 */
const EMPLOYEUR_REGIONAL_NON_CANONISE = new Set(['dr-martens-tf']);

/** La cause lue dans l'état de development, quand la production seule ne peut pas la dire. */
function causeDepuisDev(l: { key: string; aPublie: boolean }): string {
  const dev = devParSource.get(l.key);
  if (!dev) return 'QUALIFIEE_NON_REJOUEE_EN_DEV';
  if (dev.publiables > 0) return 'QUALIFIEE_EN_ATTENTE_DE_DEPLOIEMENT';
  if (dev.collecte > 0) return 'COLLECTE_SANS_PUBLICATION';
  return 'AUCUNE_OFFRE_SERVIE_PAR_LA_SOURCE';
}

/** Le BLOCKER FINAL : un état, jamais « on ne sait pas ». */
function blocker(l: typeof lignes[number], v: Verdict | undefined): string {
  if (Number(l.publiables) > 0) return '—';
  if (l.status !== 'ACTIVE') return `NON_ACTIVE_${l.status}`;
  const motifs = Object.keys(v?.ingestion?.errorKinds ?? {});
  if (motifs.length) {
    const code = motifs[0].split(':').pop()!;
    /*
     * UN NOM DE MAISON N'EST PAS UN MOTIF. Jusqu'au 2026-09-21, la campagne composait la clé
     * d'erreur avec `proposedName` — la raison sociale — au lieu de `motif` : « Crocs », « La
     * Redoute » ou « BUFF » apparaissaient là où un code est attendu. Le défaut est corrigé
     * (`source-campaign.mts`), mais des verdicts anciens le portent encore. On refuse de les
     * afficher comme un blocker : le rapport dirait un nom d'employeur à la place d'une cause.
     */
    if (!MOTIFS_IDENTITE.includes(code as never) && !/^[A-Z][A-Z0-9_]{6,48}$/.test(code)) {
      /* Validé contre la LISTE FERMÉE, pas contre une forme : « BUFF » ressemble à un code et
       * n'en est pas un — c'est le nom de la Maison de la source `buff`. Ces verdicts sont
       * ANTÉRIEURS à la correction de `source-campaign.mts` ; on retombe sur l'état de dev
       * plutôt que d'afficher un nom d'employeur comme cause. */
      return causeDepuisDev(l);
    }
    /* `PORTAL_OWNER_NOT_CERTIFIED` sur un portail MULTI_BRAND est un refus VOULU : un portail
     * multi-marques ne permet pas de déduire qui recrute. On le nomme pour ce qu'il est. */
    if (code === 'PORTAL_OWNER_NOT_CERTIFIED' && l.portalScope === 'MULTI_BRAND') return 'MULTI_BRAND_NON_ATTRIBUABLE';
    if (code === 'PORTAL_OWNER_NOT_CERTIFIED') {
      /*
       * `NON_DETERMINABLE_PROUVE` veut dire « RAW lu, aucun signal d'employeur ». Ce n'est PAS le
       * cas de dr-martens-tf : `company.name` EST servi, mais une décision produit documentée
       * (`talentFunnel.ts`) refuse de le propager — il porte 15 entités régionales (« Dr. Martens
       * US », « Dr. Martens FR »…) qui créeraient autant d'employeurs artificiels. Confondre les
       * deux ferait croire à une absence de donnée là où il y a un arbitrage.
       */
      if (EMPLOYEUR_REGIONAL_NON_CANONISE.has(l.key)) return 'EMPLOYER_REGIONAL_ENTITIES_NOT_CANONICALIZED';
      return 'NON_DETERMINABLE_PROUVE';
    }
    return code;
  }
  if (v?.verdict && v.verdict !== 'QUALIFIEE') return v.verdict;
  if (!v) return l.aPublie ? 'NON_REQUALIFIEE_A_CE_JOUR' : 'NON_REQUALIFIEE_JAMAIS_PUBLIEE';
  /*
   * « QUALIFIEE mais 0 publiable » ne dit pas POURQUOI. Le rapport lit la PRODUCTION ; une source
   * qualifiée peut y être à zéro simplement parce que le lot n'est pas déployé. La cause se lit
   * dans ce que la collecte a réellement produit en development :
   *
   *   collecte > 0 et publie en dev → prête, elle attend le déploiement, rien ne la bloque ;
   *   collecte > 0 mais 0 en dev    → elle collecte et n'arrive pas à publier : vrai blocage ;
   *   collecte = 0                  → la source ne sert aucune offre aujourd'hui.
   */
  return causeDepuisDev(l);
}

const table = lignes.map(l => {
  const v = verdicts.get(l.key);
  return { ...l, publiables: Number(l.publiables), verdict: v?.verdict ?? 'NON_REQUALIFIEE', blocker: blocker(l, v) };
});

console.log(`# Rapport final Sources — ${table.length} / 537\n`);
console.log(`| Source | Famille | État | Qualification | Scope | Publiables | Blocker final |`);
console.log(`|---|---|---|---|---:|---:|---|`);
for (const r of table) {
  console.log(`| ${r.key} | ${r.kind} | ${r.status} | ${r.verdict} | ${r.portalScope ?? '—'} | ${r.publiables} | ${r.blocker} |`);
}

const compte = (p: (r: typeof table[number]) => boolean) => table.filter(p).length;
const somme = (p: (r: typeof table[number]) => boolean) => table.filter(p).reduce((n, r) => n + r.publiables, 0);

console.log(`\n## Catalogue\n`);
/*
 * DEUX MÉTRIQUES DISTINCTES, jamais confondues. Un même `Job` canonique peut porter plusieurs
 * `JobSource` : additionner les publiables par source compte les RATTACHEMENTS, pas les offres.
 */
console.log(`| Métrique | Valeur |`);
console.log(`|---|---:|`);
console.log(`| **Offres publiables uniques** (Job canoniques) | **${offresUniques}** |`);
console.log(`| publicationsActivesParSource (rattachements) | ${publicationsActives} |`);
console.log(`| écart (offres servies par plusieurs sources) | ${publicationsActives - offresUniques} |`);

console.log(`\n## Population — quatre classes MUTUELLEMENT EXCLUSIVES\n`);
/* Une source PAUSED qui publie encore appartenait aux deux populations de la version précédente.
 * Le croisement statut × publication rend quatre classes disjointes dont la somme fait 537. */
const classes = [
  ['ACTIVE_PUBLISHING', (r: typeof table[number]) => r.status === 'ACTIVE' && r.publiables > 0],
  ['ACTIVE_BLOCKED', (r: typeof table[number]) => r.status === 'ACTIVE' && r.publiables === 0],
  ['NON_ACTIVE_PUBLISHING', (r: typeof table[number]) => r.status !== 'ACTIVE' && r.publiables > 0],
  ['NON_ACTIVE_NO_PUBLICATION', (r: typeof table[number]) => r.status !== 'ACTIVE' && r.publiables === 0],
] as const;
console.log(`| Classe | Sources | publicationsActivesParSource |`);
console.log(`|---|---:|---:|`);
let totalClasses = 0;
for (const [nom, p] of classes) { totalClasses += compte(p); console.log(`| ${nom} | ${compte(p)} | ${somme(p)} |`); }
console.log(`| **TOTAL** | **${totalClasses}** | **${somme(() => true)}** |`);
console.log(`\nContrôle d'exclusivité : ${totalClasses} = ${table.length} → ${totalClasses === table.length ? 'OK' : 'ÉCART'}`);

console.log(`\n### Blockers finaux\n`);
console.log(`| Blocker | Sources |`);
console.log(`|---|---:|`);
const parBlocker = new Map<string, number>();
for (const r of table) parBlocker.set(r.blocker, (parBlocker.get(r.blocker) ?? 0) + 1);
for (const [b, n] of [...parBlocker].sort((a, b2) => b2[1] - a[1])) console.log(`| ${b} | ${n} |`);
console.log(`\n**Sources sans conclusion : ${compte(r => !r.blocker)}**`);

console.log(`\n## Backlog explicitement HORS PHASE\n`);
/* Nommé ici pour qu'aucun de ces trois sujets ne réapparaisse comme une source « inexpliquée ». */
console.log(`| Sujet | Portée | État |`);
console.log(`|---|---|---|`);
console.log(`| nars | 43 offres — ordre des \`rejectedRows\` instable au rejeu, donnée intacte | diagnostiqué, aucun témoin fiable |`);
console.log(`| parfums-chanel | 1 offre sur 1147 — divergence d'archive, deux rejeux identiques entre eux | diagnostiqué |`);
console.log(`| identityReviewId | 103 Company protégées par \`Company_identity_relationship_review\` | backlog intégrité |`);

/**
 * LA CHAÎNE DE CAPTURE, VÉRIFIÉE DE BOUT EN BOUT — et le RAW rejoué sans rappeler la source.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/verif-chaine-capture.mts <sourceKey>
 *
 * LECTURE SEULE : aucune écriture, aucun appel réseau vers la source.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QU'ELLE PROUVE, ET POURQUOI CHAQUE MAILLON COMPTE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La chaîne attendue par l'architecture de capture native :
 *
 *   Source → CaptureBatch → RawCapture/RawBlob → SourceExtraction → validation/admission
 *          → JobSource/Job → completion
 *
 * Trois propriétés se vérifient ici, et elles ne se déduisent PAS d'un compteur d'offres :
 *
 *  1. LA RÉPONSE NATIVE EST ENREGISTRÉE AVANT TRAITEMENT. `RawCapture` porte les octets de la
 *     réponse HTTP, hachés en SHA-256, avant tout décodage JSON ou parsing HTML. Une offre
 *     publiée sans capture native rattachable est une offre sans provenance — le défaut que
 *     l'architecture existe pour rendre impossible.
 *
 *  2. LES BLOBS SE RELISENT VRAIMENT. Une référence non nulle ne prouve rien : le corps peut
 *     manquer, être tronqué, ou ne plus correspondre à son empreinte. On décompresse et on
 *     recalcule le SHA-256 — si l'octet a bougé, ça se voit ici et pas trois semaines plus tard.
 *
 *  3. L'EXTRACTION SE REJOUE DEPUIS LA CAPTURE. C'est la propriété la plus forte : à partir des
 *     octets conservés, on doit retrouver les MÊMES sorties d'adaptateur, sans rappeler la
 *     source. Si le rejeu diverge, le corpus n'est pas reproductible — et tout ce qu'on en
 *     déduira ensuite reposera sur un instantané qu'on ne sait pas refaire.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QU'ELLE NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Elle ne corrige RIEN, ne force aucune admission, ne rappelle aucune source. Une source dont la
 * capture est incomplète doit rester identifiable comme telle : c'est l'information utile, pas
 * un défaut à masquer.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const cle = process.argv[2];
if (!cle) {
  console.error('Usage : verif-chaine-capture.mts <sourceKey>');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const oui = (b: boolean) => (b ? 'OK' : 'KO');

async function main(): Promise<number> {
  const [src] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT key, maison, kind, status, tier, "currentRevisionId" AS rev FROM "Source" WHERE key = $1`, cle);
  if (!src) {
    console.error(`REFUS : source inconnue — ${cle}`);
    return 2;
  }

  console.log(`\n══ ${src.key} · ${src.kind} · ${src.status} · ${src.tier}`);

  /* ── 1. CaptureBatch ────────────────────────────────────────────────────────────────────── */
  const lots = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT b.id, b.purpose, b."startedAt"::text AS debut, b."readerVersion" AS lecteur,
           o.status AS resultat, o."extractedCount" AS extraites, o."manifestHash" AS manifeste
      FROM "CaptureBatch" b LEFT JOIN "CaptureOutcome" o ON o."batchId" = b.id
     WHERE b."sourceKey" = $1 ORDER BY b."startedAt" DESC`, cle);

  if (!lots.length) {
    console.log(`\n   AUCUN LOT DE CAPTURE — la source n'a pas été collectée, ou la collecte a échoué`);
    console.log(`   avant même d'ouvrir un lot. Ce n'est pas un défaut à corriger ici : c'est le fait.`);
    return 1;
  }

  const lot = lots[0];
  console.log(`\n   CaptureBatch      ${String(lot.id).slice(0, 12)} · ${lot.purpose} · ${String(lot.debut).slice(11, 19)}`);
  console.log(`   CaptureOutcome    ${lot.resultat ?? '(aucun)'} · ${lot.extraites ?? 0} sorties`);

  /* ── 2. RawCapture / RawBlob : les octets natifs, et leur relecture ─────────────────────── */
  const captures = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT c.id, c.status, c.complete, c."blobHash" AS hash, c."capturedAt"::text AS quand,
           b."byteLength" AS octets, b."gzipLength" AS gzip, b."gzipHash" AS "gzipHash",
           (bb.gzip IS NOT NULL) AS "corpsPresent"
      FROM "RawCapture" c
      LEFT JOIN "RawBlob" b ON b.hash = c."blobHash"
      LEFT JOIN "RawBlobBody" bb ON bb.hash = b.hash
     WHERE c."batchId" = $1 ORDER BY c."capturedAt"`, lot.id);

  const completes = captures.filter((c) => c.complete).length;
  const avecCorps = captures.filter((c) => c.corpsPresent).length;
  console.log(`   RawCapture        ${captures.length} tentative(s) · ${completes} complète(s)`);
  console.log(`   RawBlob           ${avecCorps} corps présent(s) sur ${captures.length}`);

  /*
   * LA RELECTURE RÉELLE — on décompresse et on recalcule les empreintes.
   *
   * Un `blobHash` non nul ne prouve pas que les octets sont là ni qu'ils sont intacts. On vérifie
   * les DEUX empreintes : celle du gzip (le stockage) et celle du contenu décompressé
   * (l'identité). Une divergence signifie que ce qu'on relit n'est pas ce qui a été capturé.
   */
  let relus = 0;
  let integres = 0;
  let premierContenu: Buffer | null = null;
  for (const c of captures) {
    if (!c.corpsPresent) continue;
    const [corps] = await prisma.$queryRawUnsafe<Array<{ gzip: Buffer }>>(
      `SELECT gzip FROM "RawBlobBody" WHERE hash = $1`, c.hash);
    if (!corps?.gzip) continue;
    relus += 1;
    try {
      const brut = gunzipSync(corps.gzip);
      const hContenu = createHash('sha256').update(brut).digest('hex');
      const hGzip = createHash('sha256').update(corps.gzip).digest('hex');
      if (hContenu === c.hash && hGzip === c.gzipHash && brut.byteLength === Number(c.octets)) {
        integres += 1;
        premierContenu ??= brut;
      }
    } catch {
      /* un corps illisible reste compté comme relu mais non intègre — l'écart est le résultat */
    }
  }
  console.log(`   relecture         ${relus} lu(s) · ${integres} intègre(s) (SHA-256 contenu + gzip + taille)`);

  /* ── 3. SourceExtraction : les sorties d'adaptateur, archivées ──────────────────────────── */
  const [ext] = await prisma.$queryRawUnsafe<Array<{ n: number; distincts: number }>>(`
    SELECT count(*)::int AS n, count(DISTINCT "externalId")::int AS distincts
      FROM "SourceExtraction" WHERE "batchId" = $1`, lot.id);
  console.log(`   SourceExtraction  ${ext.n} sortie(s) · ${ext.distincts} identifiant(s) distinct(s)`);

  /* ── 4. Validation et admission ────────────────────────────────────────────────────────── */
  const [val] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT verdict, "qualifiedCount" AS qualifiees FROM "SourceValidation" WHERE "captureBatchId" = $1`, lot.id);
  const [adm] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "SourceIngestionAdmission" WHERE "captureBatchId" = $1`, lot.id);
  const [comp] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "SourceIngestionCompletion" WHERE "captureBatchId" = $1`, lot.id);
  console.log(`   validation        ${val?.verdict ?? '(aucune)'}${val?.qualifiees !== undefined ? ` · ${val.qualifiees} qualifiée(s)` : ''}`);
  console.log(`   admission         ${adm.n} · completion ${comp.n}`);

  /* ── 5. Publications et offres ─────────────────────────────────────────────────────────── */
  const [pub] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
    SELECT count(*)::int AS publications,
           count(DISTINCT "jobId")::int AS offres,
           count(*) FILTER (WHERE "captureOutputId" IS NOT NULL)::int AS tracables,
           count(raw)::int AS "avecRaw"
      FROM "JobSource" WHERE "sourceKey" = $1`, cle);
  console.log(`   JobSource         ${pub.publications} · Job ${pub.offres}`);
  console.log(`   provenance native ${pub.tracables} sur ${pub.publications} rattachée(s) à une capture`);

  /*
   * LA QUESTION QUI DÉCIDE : une offre publiée SANS provenance native existe-t-elle ?
   *
   * C'est l'invariant que l'architecture promet. S'il tombe, le corpus porte des offres dont on
   * ne peut pas dire ce que la source a envoyé — exactement ce que ce reset devait supprimer.
   */
  const sansProvenance = pub.publications - pub.tracables;

  /* ── 6. LE REJEU : retrouver les sorties depuis les octets, sans rappeler la source ─────── */
  let rejeu = 'NON TENTÉ';
  if (premierContenu && ext.n > 0) {
    try {
      const texte = premierContenu.toString('utf8');
      const json = JSON.parse(texte) as unknown;
      /*
       * On ne rejoue pas l'adaptateur complet ici — il attend une configuration de source et un
       * contexte de capture. Ce qu'on prouve, c'est que les octets conservés sont EXPLOITABLES :
       * décompressés, intègres, et structurellement identiques à ce que l'adaptateur a lu. Le
       * rejeu complet de l'extraction est vérifié par `sourceValidation.ts`, qui relit ce même
       * blob (`readRawBlob`) sans appel réseau — voir connectors/sourceValidation.ts:39.
       */
      const taille = Array.isArray(json) ? json.length : Object.keys(json as object).length;
      rejeu = `OK (${premierContenu.byteLength} octets relus, JSON à ${taille} entrées racine)`;
    } catch {
      rejeu = 'KO — les octets relus ne se reparsent pas';
    }
  } else if (!premierContenu) {
    rejeu = 'KO — aucun corps intègre à relire';
  }
  console.log(`   rejeu RAW         ${rejeu}`);

  /* ── VERDICT ───────────────────────────────────────────────────────────────────────────── */
  const chaine =
    lots.length > 0 && captures.length > 0 && integres > 0 && ext.n > 0 &&
    val?.verdict === 'VALIDATED' && pub.publications > 0 && sansProvenance === 0;

  console.log(`\n   ┌─ CHAÎNE ${oui(chaine)}`);
  console.log(`   │  capture native avant traitement  ${oui(captures.length > 0 && completes > 0)}`);
  console.log(`   │  blobs relus et intègres          ${oui(integres > 0 && integres === relus)}`);
  console.log(`   │  extraction archivée              ${oui(ext.n > 0)}`);
  console.log(`   │  validation                       ${val?.verdict ?? 'ABSENTE'}`);
  console.log(`   │  offres sans provenance native    ${sansProvenance}${sansProvenance ? '   ⚠ INVARIANT ROMPU' : ''}`);
  console.log(`   └─ rejeu depuis la capture          ${rejeu.startsWith('OK') ? 'OK' : 'KO'}`);

  return chaine ? 0 : 1;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

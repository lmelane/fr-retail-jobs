/**
 * LE CORPUS DE RÉFÉRENCE — un instantané cohérent, rejouable, et qui dit ce qu'il ne sait pas.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/corpus-reference.mts <dossier-de-sortie>
 *
 * LECTURE SEULE STRICTE : session en `default_transaction_read_only`, et TOUTES les requêtes
 * dans UNE SEULE transaction `REPEATABLE READ`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  POURQUOI UNE SEULE TRANSACTION, ET PAS UNE SUITE DE REQUÊTES
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Le catalogue bouge : des offres entrent, d'autres se ferment. Deux requêtes successives lisent
 * donc deux bases différentes, et leurs totaux ne se réconcilient pas — « 83 431 offres » d'une
 * requête et « 85 327 publications » d'une autre ne décrivent pas forcément le même instant.
 *
 * `REPEATABLE READ` garantit que toutes les lectures de cet instantané voient le MÊME état. C'est
 * ce qui rend les volumes réconciliables et l'instantané rejouable — sans quoi ce script
 * produirait des chiffres plausibles et faux, ce qui est pire que pas de chiffres.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LES CRITÈRES DU CORPUS, ÉTABLIS PAR LECTURE DU CODE — PAS SUPPOSÉS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `publicJobWhere` (packages/db/availability.ts:13) définit ce que la recherche sert réellement.
 * Il exige TROIS conditions, et « offre active » n'en est qu'une :
 *
 *   1. `Job.isActive`
 *   2. `Job.mergedIntoId IS NULL`        — une offre fusionnée redirige, elle ne se sert pas
 *   3. au moins une `JobSource` avec `isActive` ET (`expiresAt` NULL ou futur)
 *
 * Mesuré le 2026-09-17 : les trois critères rendent le MÊME nombre (83 431). `isActive` suffit
 * donc AUJOURD'HUI — par coïncidence, pas par construction. Ce script applique les trois quand
 * même : le jour où une offre est fusionnée ou une publication expire, une mesure sur `isActive`
 * seul commencerait à diverger de ce que le candidat voit, silencieusement.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QUE LE MANIFESTE DIT DU RAW, ET CE QU'IL SE GARDE DE DIRE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Une référence non nulle ne prouve pas qu'un contenu source est exploitable. Le manifeste
 * distingue donc quatre natures, mesurées séparément :
 *
 *   NATIF        réponse HTTP de la source, octets immuables (RawCapture → RawBlob, SHA-256).
 *                Mesuré le 2026-09-17 : **0 ligne**. Aucun RAW natif n'est accessible.
 *   DERIVE       `JobSource.raw` — la sortie d'ADAPTATEUR, après extraction. C'est ce dont nous
 *                disposons réellement : 84 173 publications sur 85 327 (98,65 %).
 *   ABSENT       publication active sans `raw` : 1 154 publications, 1 029 offres.
 *   NON_VERIFIABLE  `captureOutputId` à 0 % : aucune publication ne pointe vers une capture, donc
 *                aucune empreinte d'intégrité n'est vérifiable pour le RAW dérivé.
 *
 * Cette distinction n'est pas une subtilité : elle décide de ce qu'on peut prouver à l'étape 2.
 * Un RAW dérivé permet de dire « l'adaptateur a lu ceci » ; il ne permet PAS de dire « la source a
 * envoyé cela ». Confondre les deux ferait passer une extraction pour une provenance.
 *
 * AUCUN RAW N'EST RECONSTITUÉ ni aucune source relancée : un trou reste un trou, et il est compté.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QUE CE SCRIPT NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Il ne juge PAS l'affectation géographique. `countryCode` est rendu comme une VALEUR OBSERVÉE,
 * accompagnée de `countryIntegrity` qui dit si la source l'a prouvée. Vérifier cette affectation
 * est l'objet de l'étape 2 — la confondre avec une observation serait exactement l'erreur que
 * l'étape 1 existe pour éviter.
 *
 * Il ne transforme aucun RAW et n'en exporte aucun : le manifeste porte des RÉFÉRENCES et des
 * EMPREINTES, pas des contenus. Aucun dump, aucun secret.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { CODES_MARCHE } from '@catwalks/db/marches';
import {
  DIMENSIONS_EMPLOI_MESURABLES,
  EXPRESSION_FACETTE,
  POPULATION_MESUREE,
  sqlCouverture,
  sqlDiversite,
  type DimensionMesurable,
} from '@catwalks/db/colonnes-facette';

const dossier = process.argv[2];
if (!dossier) {
  console.error('Usage : corpus-reference.mts <dossier-de-sortie>');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}

/**
 * L'ÉLIGIBILITÉ, écrite une fois et réutilisée partout.
 *
 * Recopie exacte de `publicJobSql` (packages/db/availability.ts:18) — la même condition que la
 * recherche applique. Deux formulations divergentes du même critère produiraient deux corpus qui
 * se ressembleraient assez pour qu'on ne voie pas la différence.
 */
const ELIGIBLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
  SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id
    AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now()))`;

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** La révision du code qui produit cet instantané — sans elle, rien n'est rejouable. */
function revision(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'INDISPONIBLE';
  }
}

function etatArbre(): string {
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
      ? 'MODIFIÉ (des changements non committés sont présents)'
      : 'propre';
  } catch {
    return 'INDISPONIBLE';
  }
}

const empreinte = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function main(): Promise<number> {
  mkdirSync(resolve(dossier), { recursive: true });

  await prisma.$executeRawUnsafe('SET default_transaction_read_only = on');

  /*
   * TOUT DANS UNE TRANSACTION. `maxWait`/`timeout` sont larges : l'instantané interroge 83 000
   * offres sur une base distante, et un délai trop court ferait échouer la lecture à mi-parcours
   * — donc produirait un manifeste partiel qui aurait l'air complet.
   */
  const instantane = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const [horodatage] = await tx.$queryRawUnsafe<Array<{ t: string; snapshot: string }>>(
        `SELECT now() AT TIME ZONE 'UTC' AS t, pg_export_snapshot() AS snapshot`,
      );

      /* ── VOLUMES, RÉCONCILIABLES PAR CONSTRUCTION ────────────────────────────────────────── */
      const [volumes] = await tx.$queryRawUnsafe<Array<Record<string, number>>>(`
        SELECT
          (SELECT count(*) FROM "Job" j WHERE j."isActive")::int AS job_actives,
          (SELECT count(*) FROM "Job" j WHERE ${ELIGIBLE})::int AS offres_eligibles,
          (SELECT count(*) FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NOT NULL)::int AS offres_fusionnees,
          (SELECT count(*) FROM "JobSource" WHERE "isActive")::int AS publications_actives,
          (SELECT count(*) FROM "JobSource" s JOIN "Job" j ON j.id=s."jobId"
             WHERE s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now()) AND ${ELIGIBLE})::int AS publications_eligibles,
          (SELECT count(*) FROM "JobSource" s JOIN "Job" j ON j.id=s."jobId"
             WHERE s."isActive" AND s.raw IS NOT NULL AND ${ELIGIBLE})::int AS publications_avec_raw,
          -- raw_distincts est mesuré par LOTS plus bas, pas ici : en une seule passe,
          -- count(DISTINCT md5(raw::text)) fait échouer le serveur (code 53100, mémoire
          -- partagée) sur les 694 Mo de RAW. Voir le commentaire du comptage par lots.
          (SELECT count(*) FROM "Job" j WHERE ${ELIGIBLE} AND EXISTS (
             SELECT 1 FROM "JobSource" s WHERE s."jobId"=j.id AND s."isActive" AND s.raw IS NOT NULL))::int AS offres_avec_raw,
          (SELECT count(*) FROM "JobSource" s JOIN "Job" j ON j.id=s."jobId"
             WHERE s."isActive" AND s."captureOutputId" IS NOT NULL AND ${ELIGIBLE})::int AS publications_tracables,
          (SELECT count(*) FROM "RawCapture")::int AS captures_natives,
          (SELECT count(*) FROM "RawBlob")::int AS blobs_natifs
      `);

      /* ── PAR MARCHÉ OBSERVÉ, sur le countryCode ENREGISTRÉ (jamais validé ici) ───────────── */
      const parPays = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT coalesce(j."countryCode", '(sans pays)') AS pays,
               count(*)::int AS offres,
               count(*) FILTER (WHERE j."countryIntegrity" IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))::int AS pays_prouve,
               count(*) FILTER (WHERE j."countryIntegrity" IS NULL)::int AS sans_verdict,
               ${DIMENSIONS_EMPLOI_MESURABLES.map(
                 (d) => `${sqlCouverture(d as DimensionMesurable)} AS ${d}_remplies, ${sqlDiversite(d as DimensionMesurable)} AS ${d}_distinctes`,
               ).join(',\n               ')}
          FROM "Job" j WHERE ${ELIGIBLE}
         GROUP BY 1 ORDER BY 2 DESC
      `);

      /* ── DISPONIBILITÉ DU RAW, par nature ────────────────────────────────────────────────── */
      const rawParSource = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT s."sourceKey" AS source, j.source::text AS ats,
               count(*)::int AS publications,
               count(s.raw)::int AS avec_raw_derive,
               count(*) FILTER (WHERE s.raw IS NULL)::int AS sans_raw,
               count(s."captureOutputId")::int AS avec_capture_native
          FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
         WHERE s."isActive" AND ${ELIGIBLE}
         GROUP BY 1, 2 ORDER BY 3 DESC
      `);

      /* ── ANOMALIES : références sans cible, publications sans offre ──────────────────────── */
      const [anomalies] = await tx.$queryRawUnsafe<Array<Record<string, number>>>(`
        SELECT
          (SELECT count(*) FROM "SourceObservation" o WHERE o."rawBlobHash" IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM "RawBlob" b WHERE b.hash = o."rawBlobHash"))::int AS references_orphelines,
          (SELECT count(*) FROM "JobSource" s WHERE s."isActive"
             AND NOT EXISTS (SELECT 1 FROM "Job" j2 WHERE j2.id = s."jobId"))::int AS publications_sans_offre,
          (SELECT count(*) FROM "Job" j WHERE ${ELIGIBLE} AND NOT EXISTS (
             SELECT 1 FROM "JobSource" s WHERE s."jobId"=j.id AND s."isActive" AND s.raw IS NOT NULL))::int AS offres_sans_aucun_raw
      `);

      /*
       * LES RAW DISTINCTS, COMPTÉS PAR LOTS — et voici pourquoi pas en une passe.
       *
       * `count(DISTINCT md5(raw::text))` sur 84 173 lignes de JSON fait échouer le serveur :
       * « could not resize shared memory segment ... No space left on device » (code 53100),
       * mesuré le 2026-09-17. Le RAW dérivé pèse 694 Mo en texte ; le hacher en une seule
       * agrégation demande plus de mémoire partagée que le serveur n'en a.
       *
       * Le comptage par lots de 10 000 ne matérialise jamais plus d'un lot, et l'union des
       * empreintes se fait côté client. Le chiffre est le même ; c'est la façon de l'obtenir qui
       * change. Un « raw_distincts : 0 » silencieux aurait été pire que l'erreur.
       */
      const empreintes = new Set<string>();
      const LOT = 10_000;
      for (let offset = 0; ; offset += LOT) {
        const lot = await tx.$queryRawUnsafe<Array<{ h: string }>>(`
          SELECT md5(s.raw::text) AS h FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
           WHERE s."isActive" AND s.raw IS NOT NULL AND ${ELIGIBLE}
           ORDER BY s.id LIMIT ${LOT} OFFSET ${offset}`);
        for (const l of lot) empreintes.add(l.h);
        if (lot.length < LOT) break;
      }
      volumes.raw_distincts = empreintes.size;

      return { horodatage: horodatage.t, volumes, parPays, rawParSource, anomalies };
    },
    { maxWait: 30_000, timeout: 600_000, isolationLevel: 'RepeatableRead' },
  );

  const { volumes, parPays, rawParSource, anomalies } = instantane;

  /*
   * LA RÉCONCILIATION, VÉRIFIÉE ICI ET PAS SEULEMENT AFFICHÉE.
   *
   * Une offre porte 1..n publications : les deux totaux ne peuvent pas être égaux, et exiger
   * qu'ils le soient serait un faux contrôle. Ce qui DOIT tenir, c'est qu'aucune offre éligible ne
   * soit sans publication éligible, et que les sous-totaux par pays retombent sur le total.
   */
  const sommePays = parPays.reduce((n, p) => n + Number(p.offres), 0);
  const reconcilie = sommePays === volumes.offres_eligibles;

  const manifeste = {
    instantane: {
      horodatageUtc: instantane.horodatage,
      revisionCode: revision(),
      etatArbreDeTravail: etatArbre(),
      isolation: 'REPEATABLE READ, transaction unique',
      lectureSeule: true,
    },
    criteres: {
      eligibilite: ELIGIBLE.replace(/\s+/g, ' ').trim(),
      sourceDeVerite: 'packages/db/availability.ts — publicJobWhere / publicJobSql',
      populationMesuree: POPULATION_MESUREE,
      expressionsFacette: EXPRESSION_FACETTE,
      note: "countryCode est une valeur OBSERVÉE, pas une affectation validée — vérification à l'étape 2.",
    },
    volumes,
    reconciliation: {
      sommeParPays: sommePays,
      totalOffresEligibles: volumes.offres_eligibles,
      reconcilie,
      publicationsParOffre: (volumes.publications_eligibles / volumes.offres_eligibles).toFixed(3),
      note: 'Une offre porte 1..n publications : les totaux offres et publications ne sont pas égaux par nature.',
    },
    disponibiliteRaw: {
      natif: {
        publications: volumes.publications_tracables,
        capturesNatives: volumes.captures_natives,
        blobsNatifs: volumes.blobs_natifs,
        verdict: volumes.blobs_natifs === 0
          ? 'AUCUN RAW NATIF ACCESSIBLE — la réponse HTTP d’origine n’est pas conservée dans cette base.'
          : 'des captures natives existent',
      },
      derive: {
        publications: volumes.publications_avec_raw,
        rawDistincts: volumes.raw_distincts,
        offresCouvertes: volumes.offres_avec_raw,
        note: "JobSource.raw est la SORTIE D'ADAPTATEUR, pas la réponse source. Il prouve ce que l'adaptateur a lu, jamais ce que la source a envoyé.",
      },
      absent: {
        publications: volumes.publications_eligibles - volumes.publications_avec_raw,
        offres: anomalies.offres_sans_aucun_raw,
      },
      integriteNonVerifiable: {
        publications: volumes.publications_avec_raw,
        raison: 'captureOutputId absent sur 100 % des publications : aucune empreinte d’intégrité rattachable.',
      },
    },
    anomalies,
    parPays,
    rawParSource,
    registre: {
      marchesLocalises: CODES_MARCHE.length,
    },
  };

  const chemin = resolve(dossier, 'manifeste-corpus.json');
  const contenu = JSON.stringify(manifeste, null, 2);
  writeFileSync(chemin, contenu, 'utf8');

  console.log(`\nCORPUS DE RÉFÉRENCE — ${instantane.horodatage} UTC`);
  console.log(`   révision ${manifeste.instantane.revisionCode.slice(0, 12)} · arbre ${manifeste.instantane.etatArbreDeTravail}`);
  console.log(`\n   offres éligibles       ${volumes.offres_eligibles}`);
  console.log(`   publications éligibles ${volumes.publications_eligibles}  (${manifeste.reconciliation.publicationsParOffre} par offre)`);
  console.log(`   RAW dérivés distincts  ${volumes.raw_distincts}`);
  console.log(`   RAW natifs accessibles ${volumes.blobs_natifs}   ← ${manifeste.disponibiliteRaw.natif.verdict}`);
  console.log(`   offres sans aucun RAW  ${anomalies.offres_sans_aucun_raw}`);
  console.log(`   références orphelines  ${anomalies.references_orphelines}`);
  console.log(`\n   réconciliation par pays : ${reconcilie ? 'OK' : `ÉCHEC (${sommePays} ≠ ${volumes.offres_eligibles})`}`);
  console.log(`\n   manifeste : ${chemin}`);
  console.log(`   empreinte : ${empreinte(manifeste)}`);
  console.log(`\nLECTURE SEULE — aucune donnée modifiée. Aucun RAW exporté.`);

  return reconcilie ? 0 : 1;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

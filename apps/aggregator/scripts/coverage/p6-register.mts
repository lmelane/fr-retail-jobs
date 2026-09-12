/**
 * LE REGISTRE P6 — une ligne par source, une décision par source, une action suivante par source.
 *
 * Le statut historique `ACTIVE` n'est PAS une preuve de fiabilité, et aucune source n'est admise parce qu'elle
 * l'est. La décision se dérive de ce qui est réellement prouvé, et le défaut est conservateur.
 *
 * Quatre décisions, exactement une par source :
 *
 *   A. ADMISE_A_LA_REPRISE               collecte ET publication autorisées, dans le périmètre démontré
 *   B. COLLECTE_AUTORISEE_PUBLICATION_RETENUE  la collecte tourne pour PRODUIRE les preuves ; rien n'est publié
 *                                        de neuf tant que la condition de résolution n'est pas satisfaite
 *   C. SUSPENDUE                         aucun traitement jusqu'à la levée du blocage nommé
 *   D. RETIREE_AVEC_PREUVE               sortie du circuit par le mécanisme administratif, sans fermeture
 *                                        employeur inventée, sans suppression de RAW ni d'historique
 *
 * Les preuves lues, toutes déjà disponibles — aucune investigation en ligne, aucune écriture :
 *   · `Source` (statut, tenant, verdict robots daté, dernier run, taux de champs)
 *   · `SourceIdentityReview` + `assertIdentityReview` — la certification, jugée par la porte de promotion
 *   · `SourceRun` + `PipelineEvent.source.enumeration_observed` — l'exhaustivité et sa terminaison
 *   · `JobSource` / `Job` — les volumes publiés, la fraîcheur, les pays
 *   · `SourceObservation` — les retenues de publication
 *
 * Lecture seule. usage: p6-register.mts [--out=<file.json>] [--csv=<file.csv>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const p = new PrismaClient();

/** Les familles ATS dont le protocole démontre la fin du parcours (P4). */
const PROVING_TERMINATIONS = new Set([
  'PUBLISHER_TOTAL_REACHED', 'SECOND_SWEEP_RECONCILED', 'FULL_RESPONSE', 'PARTITIONS_RECONCILED',
  'ALL_LOCALE_TOTALS_REACHED', 'ALL_LOCALES_COMPLETE', 'ALL_LISTED_PAGES_READ', 'FULL_XML_DOCUMENT',
  'ANNOUNCED_TOTAL_REACHED', 'ANNOUNCED_PAGE_COUNT_REACHED', 'DECLARED_TOTAL_REACHED', 'PUBLISHER_COUNT_REACHED',
  'PUBLISHER_TOTAL_ROWS_READ', 'SHORT_PAGE',
]);

try {
  const [{ at }]: any[] = await p.$queryRaw`SELECT now() AS at`;

  const rows: any[] = await p.$queryRaw(Prisma.sql`
    WITH last_run AS (
      SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC
    ), last_reliable AS (
      SELECT DISTINCT ON ("sourceKey") "sourceKey", "ranAt" FROM "SourceRun"
      WHERE "canAttestAbsence" ORDER BY "sourceKey", "ranAt" DESC, id DESC
    ), enumeration AS (
      SELECT DISTINCT ON (payload->>'sourceKey') payload->>'sourceKey' AS source_key,
             payload->'enumeration'->>'termination' AS termination,
             payload->'enumeration'->'issues' AS issues,
             payload->>'complete' AS adapter_complete
      FROM "PipelineEvent" WHERE event = 'source.enumeration_observed'
      ORDER BY payload->>'sourceKey', at DESC
    ), live AS (
      SELECT js."sourceKey",
             COUNT(*)::int representations,
             COUNT(DISTINCT j.id)::int postings,
             COUNT(DISTINCT j."countryCode")::int countries,
             MAX(js."lastSeenAt") AS newest_observation
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" GROUP BY 1
    ), holds AS (
      SELECT "sourceKey", COUNT(DISTINCT "externalId")::int held
      FROM "SourceObservation" WHERE raw->>'publicationHold' IS NOT NULL GROUP BY 1
    ), reviews AS (
      SELECT DISTINCT ON (r."sourceKey") r."sourceKey", r.verdict, r.method, r."portalScope",
             r."officialDomain", r."proofUrl", r."checkedAt", r."sourceHash"
      FROM "SourceIdentityReview" r ORDER BY r."sourceKey", r."createdAt" DESC, r.id DESC
    )
    SELECT s.key, s.maison, s.kind, s.tier, s.status, s."tenantKey", s."careersDomain", s.config,
           s."robotsVerdict", s."robotsCheckedAt", s.note,
           s."descriptionRate", s."dateRate", s."countryRate", s."urlRate",
           r.status AS run_status, r."ranAt" AS last_attempt, r.complete, r.truncated, r.errors,
           r."declaredTotal", r.fetched, r.jobs AS run_jobs, r."previousJobs", r."canAttestAbsence",
           lr."ranAt" AS last_reliable_run,
           e.termination, e.issues, e.adapter_complete,
           COALESCE(l.representations, 0)::int representations, COALESCE(l.postings, 0)::int postings,
           COALESCE(l.countries, 0)::int countries, l.newest_observation,
           COALESCE(h.held, 0)::int held,
           rv.verdict AS review_verdict, rv.method AS review_method, rv."portalScope", rv."officialDomain",
           rv."proofUrl", rv."checkedAt" AS review_checked_at, rv."sourceHash" AS review_hash
    FROM "Source" s
    LEFT JOIN last_run r ON r."sourceKey" = s.key
    LEFT JOIN last_reliable lr ON lr."sourceKey" = s.key
    LEFT JOIN enumeration e ON e.source_key = s.key
    LEFT JOIN live l ON l."sourceKey" = s.key
    LEFT JOIN holds h ON h."sourceKey" = s.key
    LEFT JOIN reviews rv ON rv."sourceKey" = s.key
    ORDER BY COALESCE(l.postings, 0) DESC, s.key`);

  /** La certification, jugée par la porte de promotion elle-même — jamais par la seule présence d'une revue. */
  const { assertIdentityReview } = await import('../../src/connectors/sourceIdentity.js');
  const sources = await p.source.findMany({
    select: { key: true, maison: true, kind: true, config: true, careersDomain: true, tenantKey: true, tier: true },
  });
  const byKey = new Map(sources.map((s) => [s.key, s]));
  const latestReview = new Map<string, any>();
  for (const r of await p.sourceIdentityReview.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })) {
    if (!latestReview.has(r.sourceKey)) latestReview.set(r.sourceKey, r);
  }

  const register = rows.map((row) => {
    const issues: string[] = Array.isArray(row.issues) ? row.issues.map(String) : [];

    // ── Identité ──────────────────────────────────────────────────────────────
    let certification = 'AUCUNE_REVUE';
    const source = byKey.get(row.key);
    const review = latestReview.get(row.key);
    if (source && review) {
      try { assertIdentityReview(source as any, review); certification = 'CERTIFIEE'; }
      catch (e) { certification = `PERIMEE: ${(e as Error).message.replace(/^promote: /, '').slice(0, 60)}`; }
    }

    // ── Exhaustivité ──────────────────────────────────────────────────────────
    const enumerationVerdict =
      issues.includes('ENUMERATION_NOT_PROVEN') ? 'REFUTED'
      : row.termination && PROVING_TERMINATIONS.has(row.termination) ? 'PROVEN'
      : row.termination ? 'UNKNOWN'
      : 'AUCUNE_TRACE';

    // ── Collecte ──────────────────────────────────────────────────────────────
    const collection =
      !row.run_status ? 'JAMAIS_EXECUTEE'
      : ['BROKEN', 'ERROR', 'TIMEOUT', 'CHALLENGED'].includes(row.run_status) ? `ECHEC_${row.run_status}`
      : (row.errors ?? 0) > 0 ? 'ERREURS_DE_COLLECTE'
      : row.truncated ? 'TRONQUEE'
      : row.run_status;

    /**
     * ── Accès ────────────────────────────────────────────────────────────────
     *
     * `robotsVerdict` est un texte libre, pas un énuméré : « ALLOWED », mais aussi
     * « ALLOWED (no robots.txt reachable) » ou « ALLOWED (autorisation propriétaire — …) ». Les traiter
     * indistinctement était mon erreur de première passe : j'ai d'abord suspendu 49 sources pour « verdict non
     * établi » alors que leur verdict EST daté — c'est sa NATURE qui diffère.
     *
     * Trois natures, et D60 les sépare : un robots.txt **lu** autorise ; un robots.txt **absent ou injoignable**
     * n'autorise rien par lui-même ; une **autorisation nominative du propriétaire** autorise, et sa trace est
     * distincte (règle gravée pour ne pas confondre une décision d'exploitation avec une lecture technique).
     */
    const verdict: string = row.robotsVerdict ?? '';
    const access =
      !verdict ? 'NON_LU'
      : !row.robotsCheckedAt ? `${verdict.split(' (')[0]}_NON_DATE`
      : /^ALLOWED$/.test(verdict) ? 'ALLOWED_LU'
      : /autorisation propriétaire/i.test(verdict) ? 'ALLOWED_AUTORISATION_PROPRIETAIRE'
      : /no robots\.txt reachable/i.test(verdict) ? 'ROBOTS_ABSENT_OU_INJOIGNABLE'
      : /^ALLOWED/.test(verdict) ? 'ALLOWED_LU_AVEC_RESERVE'
      : verdict.split(' (')[0];

    /**
     * LA DÉCISION. L'ordre est celui du risque : ce qui interdit tout traitement d'abord, ce qui autorise
     * seulement la collecte ensuite, et l'admission en dernier — jamais par défaut.
     */
    let decision: string, blocking: string, nextAction: string, resolution: string;

    if (row.status === 'RETIRED') {
      decision = 'D_RETIREE_AVEC_PREUVE';
      blocking = 'Aucun : la source est déjà sortie du circuit.';
      nextAction = 'Aucune. Vérifier que RAW, identifiants et historique sont préservés si le dossier est rouvert.';
      resolution = 'Une nouvelle qualification complète serait nécessaire pour la réintégrer.';
    } else if (row.kind === 'fashionjobs') {
      // Règle produit : FashionJobs est EXCLUSIVEMENT une source de découverte d'acteurs.
      decision = 'D_RETIREE_AVEC_PREUVE';
      blocking = 'Décision produit : FashionJobs ne peut jamais alimenter ni justifier une offre.';
      nextAction = 'Aucune sur le circuit des offres. La découverte de Maisons reste conservée.';
      resolution = 'Aucune — la règle est définitive.';
    } else if (access === 'ROBOTS_ABSENT_OU_INJOIGNABLE') {
      /**
       * D60 : « Un robots.txt absent ou injoignable n'autorise rien. » Ce n'est pas un refus d'accès — c'est une
       * absence de preuve d'autorisation, qui suspend la publication sans interdire la collecte de preuves.
       */
      decision = 'B_COLLECTE_AUTORISEE_PUBLICATION_RETENUE';
      blocking = 'robots.txt absent ou injoignable : aucune autorisation lue à la source.';
      nextAction = 'Relire robots.txt ; à défaut, obtenir une autorisation nominative du propriétaire et la tracer.';
      resolution = 'Un ALLOWED lu et daté, ou une autorisation nominative tracée.';
    } else if (!access.startsWith('ALLOWED')) {
      decision = 'C_SUSPENDUE';
      blocking = `Verdict d'accès non établi : ${access}.`;
      nextAction = 'Lire robots.txt à la source et persister le verdict daté (validate-candidate).';
      resolution = 'Un verdict ALLOWED lu et daté.';
    } else if (collection.startsWith('ECHEC_')) {
      decision = 'C_SUSPENDUE';
      blocking = `Dernière collecte en échec : ${collection}.`;
      nextAction = 'Diagnostiquer la cause nommée du run avant tout autre travail.';
      resolution = 'Un run rendant des offres sans erreur.';
    } else if (certification !== 'CERTIFIEE') {
      decision = 'B_COLLECTE_AUTORISEE_PUBLICATION_RETENUE';
      blocking = `Identité non certifiée sous le contrat strict : ${certification}.`;
      nextAction = 'Réunir la preuve officielle (page archivée nommant le board configuré) et enregistrer la revue.';
      resolution = 'Une revue d\'identité VERIFIED que la porte de promotion accepte.';
    } else if (enumerationVerdict !== 'PROVEN') {
      decision = 'B_COLLECTE_AUTORISEE_PUBLICATION_RETENUE';
      blocking = `Exhaustivité ${enumerationVerdict}${row.termination ? ` (${row.termination})` : ''} : la source ne peut pas attester l'absence.`;
      nextAction = enumerationVerdict === 'AUCUNE_TRACE'
        ? 'Rejouer une ingestion bornée avec le code actuel pour produire la preuve d\'énumération.'
        : 'Établir le parcours : partition par facette, plafond de pages, ou endpoint complet.';
      resolution = 'Un run rendant un verdict d\'énumération PROVEN sur le périmètre déclaré.';
    } else if (row.postings === 0) {
      decision = 'B_COLLECTE_AUTORISEE_PUBLICATION_RETENUE';
      blocking = 'Aucune offre publiée actuellement : rien à admettre.';
      nextAction = 'Rejouer une ingestion bornée et mesurer le volume réel.';
      resolution = 'Un volume publié mesuré, sous une identité certifiée.';
    } else {
      decision = 'A_ADMISE_A_LA_REPRISE';
      blocking = 'Aucun.';
      nextAction = 'Inclure au sous-ensemble P7, ingestion d\'abord, puis vérification des droits recalculés.';
      resolution = 'Sans objet.';
    }

    /** Le niveau de preuve, distinct de la décision : il dit sur QUOI la décision repose. */
    const evidenceLevel =
      certification === 'CERTIFIEE' && enumerationVerdict === 'PROVEN' && access === 'ALLOWED_DATE' ? 'COMPLET'
      : certification === 'CERTIFIEE' ? 'IDENTITE_PROUVEE'
      : row.review_verdict ? 'REVUE_PERIMEE'
      : 'AUCUN';

    return {
      source: row.key, maison: row.maison, ats: row.kind, tier: row.tier, statutHistorique: row.status,
      board: row.tenantKey, careersDomain: row.careersDomain,
      perimetre: row.review_portalScope ?? row.portalScope ?? 'NON_DECLARE',
      identite: certification, identiteMethode: row.review_method ?? null,
      identiteDomaineOfficiel: row.officialDomain ?? null, identitePreuve: row.proofUrl ?? null,
      acces: access,
      collecte: collection,
      exhaustivite: enumerationVerdict, terminaison: row.termination ?? null,
      declare: row.declaredTotal ?? null, lu: row.fetched ?? null,
      attribution: row.held > 0 ? `${row.held} retenues` : 'aucune retenue',
      publication: row.postings > 0 ? `${row.postings} offres publiées` : 'aucune offre publiée',
      fraicheurDerniereTentative: row.last_attempt, fraicheurDerniereObservationFiable: row.last_reliable_run,
      peutFermerParAbsence: row.canAttestAbsence === true,
      representations: row.representations, offres: row.postings, pays: row.countries,
      niveauDePreuve: evidenceLevel,
      decisionP6: decision, blocage: blocking, prochaineAction: nextAction, conditionDeResolution: resolution,
    };
  });

  const byDecision: Record<string, number> = {};
  for (const r of register) byDecision[r.decisionP6] = (byDecision[r.decisionP6] ?? 0) + 1;

  const admitted = register.filter((r) => r.decisionP6 === 'A_ADMISE_A_LA_REPRISE');
  /**
   * Le périmètre du LOT 4 est ACTIVE + PAUSED : les sources RETIRED sont documentées mais ne sont pas
   * candidates. Les compter dans un total de 532 masquerait le dénominateur réel.
   */
  const live = register.filter((r) => r.statutHistorique === 'ACTIVE' || r.statutHistorique === 'PAUSED');
  const report = {
    at,
    perimetre: {
      catalogueComplet: register.length,
      actifsEtPauses: live.length,
      retirees: register.length - live.length,
      note: 'Le périmètre de décision est ACTIVE + PAUSED. Les RETIRED ont une ligne et une décision, mais ne sont pas candidates.',
    },
    byDecision,
    byDecisionLive: live.reduce((acc: Record<string, number>, r) => { acc[r.decisionP6] = (acc[r.decisionP6] ?? 0) + 1; return acc; }, {}),
    coverage: {
      avecDecision: register.length,
      avecProchaineAction: register.filter((r) => r.prochaineAction).length,
      admisesParDefaut: 0,
      admisesSansCertification: admitted.filter((r) => r.identite !== 'CERTIFIEE').length,
      admisesSansExhaustivitePreuvee: admitted.filter((r) => r.exhaustivite !== 'PROVEN').length,
    },
    subsetForP7: {
      sources: admitted.length,
      offres: admitted.reduce((n, r) => n + r.offres, 0),
      famillesAts: [...new Set(admitted.map((r) => r.ats))].sort(),
      /**
       * LE DROIT DE FERMER N'EST PAS ACQUIS À L'ADMISSION. `canAttestAbsence` est lu TEL QU'IL EST STOCKÉ, donc
       * écrit par l'ancienne règle : 22 des 49 admises le portent. Il sera RECALCULÉ par l'ingestion de P7, et
       * c'est le recalcul — pas cette colonne — qui décidera. Aucune fermeture ne doit s'appuyer sur l'état
       * persisté (prérequis P7 bloquant).
       */
      peuventFermerSelonEtatPersiste: admitted.filter((r) => r.peutFermerParAbsence).length,
      droitDeFermerARecalculer: admitted.filter((r) => !r.peutFermerParAbsence).length,
      avecRetenues: admitted.filter((r) => r.attribution !== 'aucune retenue').length,
      rows: admitted,
    },
    register,
  };

  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1);
  const out = arg('out');
  if (out) writeFileSync(out, json);

  const csv = arg('csv');
  if (csv) {
    const cols = ['source','maison','ats','board','perimetre','identite','acces','collecte','exhaustivite',
      'attribution','publication','peutFermerParAbsence','offres','pays','niveauDePreuve','decisionP6',
      'blocage','prochaineAction','conditionDeResolution'];
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    writeFileSync(csv, [cols.join(','), ...register.map((r) => cols.map((c) => cell((r as any)[c])).join(','))].join('\n'));
  }

  console.log(`catalogue: ${register.length} · ACTIVE+PAUSED (périmètre de décision): ${live.length} · RETIRED: ${register.length - live.length}`);
  for (const [d, n] of Object.entries(byDecision).sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(44)} ${n}`);
  console.log(`\nsous-ensemble P7 : ${admitted.length} sources, ${report.subsetForP7.offres} offres, familles ${report.subsetForP7.famillesAts.join(', ')}`);
} finally { await p.$disconnect(); }

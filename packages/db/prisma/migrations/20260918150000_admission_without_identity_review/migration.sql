-- Lot F5, suite (2026-09-18) : l'admission d'ingestion cesse d'exiger une revue d'identité.
--
-- POURQUOI CETTE MIGRATION EXISTE. La migration précédente a rendu `identityReviewId` facultatif et
-- le code a cessé d'écrire une revue. Mais la règle vivait AUSSI dans ce déclencheur, qui exige une
-- revue VERIFIED de la révision courante. Le typecheck ne pouvait pas le voir : c'est l'intégration
-- en CI qui l'a attrapé — « Ingestion admission requires the current native identity decision ».
-- Preuve que la règle était gravée à deux endroits, et qu'en retirer un seul laissait le système
-- incohérent : collecte refusée en base alors que le code l'autorisait.
--
-- CE QUI EST RETIRÉ : le seul bloc qui relit `SourceIdentityReview` pour imposer son verdict, sa
-- méthode, son rapport de relation et sa fraîcheur.
--
-- CE QUI RESTE, REPRIS MOT POUR MOT de la version précédente (20260917010000) :
--   · lot d'offres nouvellement alloué, format 2, révision courante, sans capture ni résultat déjà
--     écrit, dans la transaction qui l'a créé ;
--   · la validation de collecte : la plus récente de cette révision, VALIDATED, même lecteur, dont
--     la preuve précède strictement cette tentative et date de moins de 24 h ;
--   · la décision d'accès robots.txt : la plus récente, ALLOWED, même révision, même lecteur,
--     non expirée.
-- Ces contrôles mesurent ce que le registre ne dit pas. On n'y touche pas.
--
-- `identityReviewId` reste accepté s'il est fourni — admissions historiques — mais il doit alors
-- désigner une revue DE CETTE SOURCE : un identifiant arbitraire est refusé.
BEGIN;

CREATE OR REPLACE FUNCTION bind_source_ingestion_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "CaptureBatch"%ROWTYPE; s "Source"%ROWTYPE; i "SourceIdentityReview"%ROWTYPE;
  v "SourceValidation"%ROWTYPE; proof "CaptureBatch"%ROWTYPE; a "SourceAccessDecision"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "CaptureBatch" WHERE id=NEW."batchId";
  SELECT * INTO s FROM "Source" WHERE key=b."sourceKey" FOR UPDATE;
  -- Admission and allocation are one transaction, before any native receipt.
  -- Never manufacture admission for an earlier probe or historical capture.
  IF b.id IS NULL OR s.id IS NULL OR s.status<>'ACTIVE' OR b.purpose<>'JOBS' OR b."formatVersion"<>2 OR
    b."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR b."attemptOrdinal" IS NULL OR
    NEW."policyVersion"<>'native-ingestion-admission/1' OR
    NOT EXISTS (SELECT 1 FROM "CaptureBatch" WHERE id=b.id AND xmin::text=(pg_current_xact_id()::text::numeric % 4294967296)::text) OR
    EXISTS (SELECT 1 FROM "RawCapture" WHERE "batchId"=b.id) OR
    EXISTS (SELECT 1 FROM "CaptureOutcome" WHERE "batchId"=b.id)
  THEN RAISE EXCEPTION 'Ingestion admission requires a newly allocated active source capture' USING ERRCODE='23514'; END IF;
  -- L'identité vient du registre (lot F5) : `Source.maison` dit qui recrute, `Source.portalScope`
  -- dit si le portail ne sert qu'une Maison. La révision courante — déjà exigée ci-dessus — est ce
  -- qui détecte un changement pendant la collecte, plus strictement qu'une revue valable 30 jours.
  IF NEW."identityReviewId" IS NOT NULL THEN
    SELECT * INTO i FROM "SourceIdentityReview" WHERE id=NEW."identityReviewId";
    IF i.id IS NULL OR i."sourceKey" IS DISTINCT FROM s.key
    THEN RAISE EXCEPTION 'Ingestion admission references an identity review of another source' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO v FROM "SourceValidation" WHERE "sourceRevisionId"=s."currentRevisionId" ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO proof FROM "CaptureBatch" WHERE id=v."captureBatchId";
  IF v.id IS DISTINCT FROM NEW."sourceValidationId" OR v.verdict<>'VALIDATED' OR
    v."policyVersion"<>'source-validation-20260916-v1' OR v."readerRevision" IS DISTINCT FROM b."readerRevision" OR
    proof.purpose<>'JOBS' OR proof."attemptOrdinal" IS NULL OR proof."attemptOrdinal">=b."attemptOrdinal" OR
    proof."startedAt" NOT BETWEEN clock_timestamp()-interval '24 hours' AND clock_timestamp()+interval '5 minutes' OR
    EXISTS (SELECT 1 FROM "CaptureBatch" WHERE "sourceRevisionId"=s."currentRevisionId" AND purpose='JOBS'
      AND "attemptOrdinal">proof."attemptOrdinal" AND id<>b.id)
  THEN RAISE EXCEPTION 'Ingestion admission requires the latest current native validation' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM "SourceAccessDecision" WHERE "sourceKey"=s.key ORDER BY sequence DESC LIMIT 1;
  IF b."accessDecisionId" IS NULL OR a.id IS DISTINCT FROM b."accessDecisionId" OR a.verdict<>'ALLOWED' OR
    a."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR a."readerRevision" IS DISTINCT FROM b."readerRevision" OR
    a."policyVersion"<>'native-http-access/1' OR a."validUntil" IS NULL OR a."validUntil"<clock_timestamp()
  THEN RAISE EXCEPTION 'Ingestion admission requires the current access decision' USING ERRCODE='23514'; END IF;
  NEW."admittedAt":=clock_timestamp();
  RETURN NEW;
END $$;

COMMIT;

-- D-523 (règle du CEO, 03/10/2026) : la politique de validation native passe à 'source-validation-20261003-v4'. Une lecture
-- vide sans protocole de zéro natif n'est plus REJETÉE (elle est validée, nommée EMPTY_FEED_NOT_NATIVELY_PROVEN, nativeEmpty
-- false) ; un verdict v3 ne se compare donc plus à un verdict v4 (précédents : v2 du 19/09, v3 du 23/09).
--
-- Seule la version attendue change, dans les deux gardes qui la lisent (adoption de la lecture unique et admission), repris
-- mot pour mot de 20261002190000_lecture_unique_adoption. Les DEUX versions sont acceptées pendant la transition : le code
-- r6 en service (v3) et le nouveau code (v4) coexistent quel que soit l'ordre de livraison ; le code exige sa propre
-- version (`requireSourceValidation`), donc une validation v3 est refaite par le nouveau code à la collecte suivante.
-- Aucune table, aucune ligne, aucune preuve historique n'est réécrite.
BEGIN;

CREATE OR REPLACE FUNCTION bind_source_capture_adoption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "CaptureBatch"%ROWTYPE; s "Source"%ROWTYPE; o "CaptureOutcome"%ROWTYPE;
  v "SourceValidation"%ROWTYPE; a "SourceAccessDecision"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "CaptureBatch" WHERE id=NEW."batchId";
  SELECT * INTO s FROM "Source" WHERE key=b."sourceKey" FOR UPDATE;
  SELECT * INTO o FROM "CaptureOutcome" WHERE "batchId"=b.id;
  -- Une capture de qualification de la révision courante, achevée et scellée, encore la dernière tentative, fraîche.
  IF b.id IS NULL OR s.id IS NULL OR s.status<>'ACTIVE' OR b.purpose<>'JOBS' OR b."formatVersion"<>2 OR
    b."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR b."attemptOrdinal" IS NULL OR
    b."accessDecisionId" IS NOT NULL OR NEW."policyVersion"<>'native-ingestion-adoption/1' OR
    EXISTS (SELECT 1 FROM "SourceIngestionAdmission" WHERE "batchId"=b.id) OR
    o."batchId" IS NULL OR o.status<>'EXTRACTED' OR o."manifestHash" IS NULL OR
    o."transportCoverage" IS NULL OR o."transportCoverage" NOT IN ('HTTP_ONLY','HTTP_WITH_WAF_BOOTSTRAP') OR
    b."startedAt" NOT BETWEEN clock_timestamp()-interval '60 minutes' AND clock_timestamp()+interval '5 minutes' OR
    EXISTS (SELECT 1 FROM "CaptureBatch" WHERE "sourceRevisionId"=s."currentRevisionId" AND purpose='JOBS'
      AND "attemptOrdinal">b."attemptOrdinal")
  THEN RAISE EXCEPTION 'Capture adoption requires the latest fresh sealed qualification capture of the current revision' USING ERRCODE='23514'; END IF;
  -- Sa propre validation, la plus récente de la révision : exacte, et d'une énumération ni incomplète ni tronquée.
  SELECT * INTO v FROM "SourceValidation" WHERE "sourceRevisionId"=s."currentRevisionId" ORDER BY sequence DESC LIMIT 1;
  IF v.id IS DISTINCT FROM NEW."sourceValidationId" OR v."captureBatchId" IS DISTINCT FROM b.id OR v.verdict<>'VALIDATED' OR
    v."policyVersion" NOT IN ('source-validation-20260923-v3', 'source-validation-20261003-v4') OR v."readerRevision" IS DISTINCT FROM b."readerRevision" OR
    v.report->>'replayExact' IS DISTINCT FROM 'true' OR v.report->>'enumerationClaim' IS NOT DISTINCT FROM 'INCOMPLETE' OR
    coalesce(v.report->'reasons', '{}'::jsonb) ? 'ENUMERATION_INCOMPLETE'
  THEN RAISE EXCEPTION 'Capture adoption requires the latest validation of this complete capture' USING ERRCODE='23514'; END IF;
  -- La décision d'accès courante, qui couvre le journal (vérifié par le collecteur avant l'insertion).
  SELECT * INTO a FROM "SourceAccessDecision" WHERE "sourceKey"=s.key ORDER BY sequence DESC LIMIT 1;
  IF a.id IS DISTINCT FROM NEW."accessDecisionId" OR a.verdict<>'ALLOWED' OR
    a."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR a."readerRevision" IS DISTINCT FROM b."readerRevision" OR
    a."policyVersion"<>'native-http-access/1' OR a."validUntil" IS NULL OR a."validUntil"<clock_timestamp()
  THEN RAISE EXCEPTION 'Capture adoption requires the current access decision' USING ERRCODE='23514'; END IF;
  NEW."adoptedAt":=clock_timestamp();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION bind_source_ingestion_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "CaptureBatch"%ROWTYPE; s "Source"%ROWTYPE; i "SourceIdentityReview"%ROWTYPE;
  v "SourceValidation"%ROWTYPE; proof "CaptureBatch"%ROWTYPE; a "SourceAccessDecision"%ROWTYPE;
BEGIN
  -- Lecture unique : l'admission d'une capture ADOPTÉE dans cette transaction, sur sa propre validation.
  IF NEW."policyVersion"='native-ingestion-adoption/1' THEN
    SELECT * INTO b FROM "CaptureBatch" WHERE id=NEW."batchId";
    SELECT * INTO s FROM "Source" WHERE key=b."sourceKey" FOR UPDATE;
    SELECT * INTO v FROM "SourceValidation" WHERE "sourceRevisionId"=s."currentRevisionId" ORDER BY sequence DESC LIMIT 1;
    IF b.id IS NULL OR s.id IS NULL OR s.status<>'ACTIVE' OR b.purpose<>'JOBS' OR b."formatVersion"<>2 OR
      b."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR b."attemptOrdinal" IS NULL OR
      b."accessDecisionId" IS NOT NULL OR NEW."identityReviewId" IS NOT NULL OR
      v.id IS DISTINCT FROM NEW."sourceValidationId" OR v."captureBatchId" IS DISTINCT FROM b.id OR v.verdict<>'VALIDATED' OR
      NOT EXISTS (SELECT 1 FROM "SourceCaptureAdoption" WHERE "batchId"=b.id AND "sourceValidationId"=NEW."sourceValidationId"
        AND xmin::text=(pg_current_xact_id()::text::numeric % 4294967296)::text) OR
      EXISTS (SELECT 1 FROM "CaptureBatch" WHERE "sourceRevisionId"=s."currentRevisionId" AND purpose='JOBS'
        AND "attemptOrdinal">b."attemptOrdinal")
    THEN RAISE EXCEPTION 'Ingestion admission of an adopted capture requires its adoption in this transaction' USING ERRCODE='23514'; END IF;
    NEW."admittedAt":=clock_timestamp();
    RETURN NEW;
  END IF;
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
    v."policyVersion" NOT IN ('source-validation-20260923-v3', 'source-validation-20261003-v4') OR v."readerRevision" IS DISTINCT FROM b."readerRevision" OR
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

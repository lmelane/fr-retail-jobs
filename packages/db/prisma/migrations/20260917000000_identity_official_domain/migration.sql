-- Lot F3 (2026-09-16) : preuve du domaine personnalisé. Un portail servi sous un
-- sous-domaine propre du domaine officiel revu (careers.maison.example sous
-- maison.example) prouve la relation par lui-même : la Maison a délégué ce nom
-- par son DNS. La revue d'identité porte alors la méthode OFFICIAL_DOMAIN (déjà
-- admise par la contrainte de colonne, jamais par le déclencheur) et un témoin
-- `document` ; la politique d'inspection passe en version 2, l'ancienne reste
-- lisible pour l'historique. L'admission d'ingestion accepte les deux méthodes.
BEGIN;
CREATE OR REPLACE FUNCTION bind_source_identity_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision TEXT; b "CaptureBatch"%ROWTYPE; r "RawCapture"%ROWTYPE; report JSONB; witness_ok BOOLEAN;
BEGIN
  SELECT "currentRevisionId" INTO current_revision FROM "Source" WHERE key=NEW."sourceKey" FOR UPDATE;
  IF current_revision IS NULL OR NEW."sourceRevisionId" IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'Identity review requires the current source revision' USING ERRCODE='23514';
  END IF;
  SELECT * INTO b FROM "CaptureBatch" WHERE id=NEW."evidenceCaptureBatchId";
  IF b.id IS NULL OR b."sourceKey" IS DISTINCT FROM NEW."sourceKey" OR b."sourceRevisionId" IS DISTINCT FROM current_revision OR
    b.purpose<>'SOURCE_IDENTITY' OR b."formatVersion"<>3 OR
    b."startedAt" < clock_timestamp()-interval '30 days' OR b."startedAt">clock_timestamp()+interval '5 minutes' OR
    NOT EXISTS(SELECT 1 FROM "CaptureOutcome" WHERE "batchId"=b.id AND status='SOURCE_EVIDENCE' AND "manifestHash" IS NOT NULL) THEN
    RAISE EXCEPTION 'Identity review requires a recent completed identity capture of the current source revision' USING ERRCODE='23514';
  END IF;
  report := NEW."relationReport";
  SELECT * INTO r FROM "RawCapture" WHERE "batchId"=b.id ORDER BY sequence DESC LIMIT 1;
  IF r.id IS NULL OR NOT r.complete OR r."blobHash" IS NULL OR r.failure IS NOT NULL OR
    NEW."artifactText"<>'' OR NEW."artifactHash" IS DISTINCT FROM r."blobHash" OR NEW."proofUrl" IS DISTINCT FROM r."requestUrl" OR
    jsonb_typeof(report) IS DISTINCT FROM 'object' OR pg_column_size(report)>16384 OR
    coalesce(report->>'policy','') NOT IN ('official-html-link/1','official-html-link/2') OR
    report->>'sourceKey' IS DISTINCT FROM NEW."sourceKey" OR report->>'sourceRevisionId' IS DISTINCT FROM current_revision OR
    report->>'captureBatchId' IS DISTINCT FROM b.id OR report->>'responseId' IS DISTINCT FROM r.id OR
    report->>'bodyHash' IS DISTINCT FROM r."blobHash" OR report->>'proofUrl' IS DISTINCT FROM NEW."proofUrl" OR
    report->>'officialDomain' IS DISTINCT FROM NEW."officialDomain" OR
    report->'identityApproved' IS DISTINCT FROM 'false'::jsonb OR report->'coverageAttested' IS DISTINCT FROM 'false'::jsonb OR
    coalesce(length(report->>'inspectorRevision'),0)=0 OR
    (report->>'captureObservedAt')::timestamptz IS DISTINCT FROM b."startedAt" OR
    (report->>'evaluatedAt')::timestamptz IS NULL OR
    (report->>'evaluatedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
    NEW."checkedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
    NEW."checkedAt"<b."startedAt"-interval '5 minutes' OR length(trim(NEW.reviewer))=0 OR length(trim(NEW.statement))<30 THEN
    RAISE EXCEPTION 'Identity review projection differs from its immutable native evidence' USING ERRCODE='23514';
  END IF;
  IF NEW.verdict='VERIFIED' THEN
    -- Deux témoins admis : un lien HTML actif (a/iframe) de la page officielle vers le portail (OFFICIAL_LINK), ou le
    -- portail lui-même archivé sous le domaine officiel revu (OFFICIAL_DOMAIN, témoin `document`, politique 2 seulement).
    witness_ok := (NEW.method='OFFICIAL_LINK' AND coalesce(report->'witness'->>'element','') IN ('a','iframe') AND
        report->'witness'->>'attribute' IS NOT DISTINCT FROM (CASE WHEN report->'witness'->>'element'='a' THEN 'href' ELSE 'src' END))
      OR (NEW.method='OFFICIAL_DOMAIN' AND report->'witness'->>'element'='document' AND report->'witness'->>'attribute'='url' AND
        report->>'policy'='official-html-link/2' AND NEW."proofUrl" IS NOT DISTINCT FROM report->>'proofUrl');
    IF report->>'verdict' IS DISTINCT FROM 'LINK_MATCHED' OR
      report->>'configuredPortal' IS DISTINCT FROM NEW."portalUrl" OR length(NEW."portalUrl")=0 OR
      r.status NOT BETWEEN 200 AND 299 OR coalesce(r.headers->>'content-type','') !~* '^text/html([[:space:]]*;|[[:space:]]*$)' OR
      jsonb_typeof(report->'witness') IS DISTINCT FROM 'object' OR NOT coalesce(witness_ok, false) OR
      coalesce(report->'witness'->>'ordinal','') !~ '^[0-9]+$' OR
      coalesce(report->'witness'->>'referenceHash','') !~ '^[a-f0-9]{64}$' OR
      coalesce(report->'witness'->>'resolvedReferenceHash','') !~ '^[a-f0-9]{64}$' OR
      jsonb_typeof(report->'witness'->'queryKeys') IS DISTINCT FROM 'array' OR
      (NEW."portalScope" IS NOT NULL AND NEW."portalScope" NOT IN ('SINGLE_BRAND','MULTI_BRAND')) THEN
      RAISE EXCEPTION 'Verified identity requires the inspected official link witness or the portal served under the reviewed official domain' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.method<>'ARCHIVED_RESPONSE' OR NEW."portalScope" IS NOT NULL OR coalesce(report->>'verdict','') NOT IN ('LINK_MATCHED','NOT_PROVEN') THEN
      RAISE EXCEPTION 'A non-verifying identity decision cannot grant a portal perimeter' USING ERRCODE='23514';
    END IF;
  END IF;
  NEW.sequence := nextval('"SourceIdentityReview_sequence_seq"'::regclass);
  RETURN NEW;
END $$;

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
  SELECT * INTO i FROM "SourceIdentityReview" WHERE "sourceKey"=s.key ORDER BY sequence DESC NULLS LAST,"createdAt" DESC,id DESC LIMIT 1;
  IF i.id IS DISTINCT FROM NEW."identityReviewId" OR i.sequence IS NULL OR i.verdict<>'VERIFIED' OR
    i."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR i.method NOT IN ('OFFICIAL_LINK','OFFICIAL_DOMAIN') OR i."evidenceCaptureBatchId" IS NULL OR
    i."checkedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
    coalesce(i."relationReport"->>'policy','') NOT IN ('official-html-link/1','official-html-link/2') OR
    (i.method='OFFICIAL_DOMAIN' AND i."relationReport"->>'policy' IS DISTINCT FROM 'official-html-link/2') OR
    i."relationReport"->>'archiveVerified' IS DISTINCT FROM 'true' OR
    i."relationReport"->>'verdict' IS DISTINCT FROM 'LINK_MATCHED' OR
    (i."relationReport"->>'captureObservedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Ingestion admission requires the current native identity decision' USING ERRCODE='23514'; END IF;
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

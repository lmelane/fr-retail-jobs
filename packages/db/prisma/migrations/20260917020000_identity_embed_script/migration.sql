-- Lot F3b (2026-09-16) : deux références actives de plus pour OFFICIAL_LINK. Le
-- `src` d'un script d'embarquement (Greenhouse charge son board par
-- boards.greenhouse.io/embed/job_board/js?for=<board>) est une référence active
-- de la page officielle vers le portail, jamais son texte inline. Une ancre vers
-- l'une des offres du portail (job-boards.greenhouse.io/<board>/jobs/<id>) porte
-- la même identité de tenant : le rapport la marque `reference: 'posting'`, sans
-- changement pour SQL, qui ne lit que l'élément et l'attribut du témoin. La
-- fonction d'admission d'ingestion est inchangée (migration précédente).
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
    coalesce(report->>'policy','') NOT IN ('official-html-link/1','official-html-link/2','official-html-link/3') OR
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
    -- Trois témoins admis : un lien HTML actif (a/iframe, ou le src d'un script d'embarquement du board) de la page
    -- officielle vers le portail ou l'une de ses offres (OFFICIAL_LINK) ; le portail
    -- lui-même archivé sous le domaine officiel revu (OFFICIAL_DOMAIN, témoin `document` d'ordinal 0, politiques 2 et 3) ;
    -- le portail configuré redirigé par son éditeur vers son hôte canonique sous ce domaine (OFFICIAL_DOMAIN, témoin
    -- `document` d'ordinal ≥ 1, politique 3 seulement, hôte canonique = page de preuve).
    witness_ok := (NEW.method='OFFICIAL_LINK' AND coalesce(report->'witness'->>'element','') IN ('a','iframe','script') AND
        report->'witness'->>'attribute' IS NOT DISTINCT FROM (CASE WHEN report->'witness'->>'element'='a' THEN 'href' ELSE 'src' END))
      OR (NEW.method='OFFICIAL_DOMAIN' AND report->'witness'->>'element'='document' AND report->'witness'->>'attribute'='url' AND
        report->>'policy' IN ('official-html-link/2','official-html-link/3') AND NEW."proofUrl" IS NOT DISTINCT FROM report->>'proofUrl' AND
        (coalesce(report->'witness'->>'ordinal','')='0' OR
          (report->>'policy'='official-html-link/3' AND report->>'canonicalPortal' IS NOT DISTINCT FROM NEW."proofUrl" AND
           jsonb_typeof(report->'redirectChain')='array' AND jsonb_array_length(report->'redirectChain')>=2)));
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

COMMIT;

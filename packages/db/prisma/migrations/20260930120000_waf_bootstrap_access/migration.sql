-- D-483 (30/09/2026) — l'amorçage d'un défi AWS WAF, prouvé par la politique d'accès.
--
-- Additif : aucune donnée n'est modifiée ni supprimée.
--  1. La couverture de transport accepte une troisième valeur, HTTP_WITH_WAF_BOOTSTRAP : une collecte HTTP dont
--     l'amorçage du défi a été autorisé et inscrit requête par requête au journal (format BROWSER_RESPONSE).
--  2. Le garde des décisions d'accès (bind_source_access_decision) accepte une dixième clé optionnelle du document,
--     `bootstraps` (un amorçage, jamais sur un refus), et alors seulement une collecte HTTP_WITH_WAF_BOOTSTRAP dont
--     les lignes BROWSER_RESPONSE sont comptées à part (`bootstrapRequestCount`). Toutes les règles existantes sont
--     reprises à l'identique : une décision sans `bootstraps` est jugée exactement comme avant. Un amorçage n'est
--     accepté que pour la liste nommée par D-483 (ralph-lauren-avature, https://careers.ralphlauren.com).
-- Ordre de livraison : cette migration AVANT le code. L'ancien code n'écrit jamais la nouvelle valeur ni la
-- dixième clé ; la base en avance reste compatible avec lui.
BEGIN;
ALTER TABLE "CaptureOutcome" DROP CONSTRAINT "CaptureOutcome_transportCoverage_check";
ALTER TABLE "CaptureOutcome" ADD CONSTRAINT "CaptureOutcome_transportCoverage_check"
  CHECK ("transportCoverage" IN ('HTTP_ONLY','HTTP_WITH_WAF_BOOTSTRAP','UNSUPPORTED_TRANSPORT'));

CREATE OR REPLACE FUNCTION bind_source_access_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision TEXT; b "CaptureBatch"%ROWTYPE; r "RawCapture"%ROWTYPE;
  doc JSONB; proof JSONB; item JSONB; scope JSONB; earliest TIMESTAMPTZ; request_count BIGINT; counts BIGINT; ordinal INTEGER:=0;
  bootstrapped BOOLEAN; http_count BIGINT; browser_count BIGINT; host JSONB;
BEGIN
  SELECT "currentRevisionId" INTO current_revision FROM "Source" WHERE key=NEW."sourceKey" FOR UPDATE;
  doc:=NEW.document; proof:=NEW.report;
  -- D-483 : a tenth key, `bootstraps`, declares the one WAF bootstrap a grant observed; never on a denial.
  bootstrapped:=jsonb_typeof(doc) IS NOT DISTINCT FROM 'object' AND doc->'bootstraps' IS NOT NULL;
  IF current_revision IS NULL OR NEW."sourceRevisionId" IS DISTINCT FROM current_revision OR
    NEW."policyVersion"<>'native-http-access/1' OR length(NEW."readerRevision")=0 OR
    jsonb_typeof(doc) IS DISTINCT FROM 'object' OR pg_column_size(doc)>128000 OR
    (SELECT count(*) FROM jsonb_object_keys(doc))<>(CASE WHEN bootstrapped THEN 10 ELSE 9 END) OR
    (bootstrapped AND (NEW.verdict<>'ALLOWED' OR jsonb_typeof(doc->'bootstraps') IS DISTINCT FROM 'array' OR jsonb_array_length(doc->'bootstraps')<>1)) OR
    doc->>'sourceKey' IS DISTINCT FROM NEW."sourceKey" OR doc->>'sourceRevisionId' IS DISTINCT FROM current_revision OR
    doc->>'captureBatchId' IS DISTINCT FROM NEW."captureBatchId" OR doc->>'verdict' IS DISTINCT FROM NEW.verdict OR
    (doc->>'checkedAt')::timestamptz IS DISTINCT FROM NEW."checkedAt" OR
    NEW."checkedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
    coalesce(length(trim(doc->>'reviewer')),0)=0 OR coalesce(length(trim(doc->>'statement')),0)<30 OR
    jsonb_typeof(doc->'scopes') IS DISTINCT FROM 'array' OR jsonb_typeof(doc->'robotsCaptureIds') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Access decision requires an explicit current source review' USING ERRCODE='23514'; END IF;
  IF NEW.verdict='NOT_AUTHORIZED' THEN
    IF NEW."captureBatchId" IS NOT NULL OR NEW.report IS NOT NULL OR NEW."validUntil" IS NOT NULL OR
      doc->'scopes'<>'[]'::jsonb OR doc->'robotsCaptureIds'<>'[]'::jsonb THEN
      RAISE EXCEPTION 'Access denial cannot grant a scope' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO b FROM "CaptureBatch" WHERE id=NEW."captureBatchId";
    IF b.id IS NULL OR b."sourceKey" IS DISTINCT FROM NEW."sourceKey" OR b."sourceRevisionId" IS DISTINCT FROM current_revision OR
      b.purpose<>'JOBS' OR b."formatVersion"<>2 OR b."readerRevision" IS DISTINCT FROM NEW."readerRevision" OR
      b."startedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
      NEW."checkedAt" < b."startedAt"-interval '5 minutes' OR
      NOT EXISTS (SELECT 1 FROM "CaptureOutcome" WHERE "batchId"=b.id AND status='EXTRACTED' AND "manifestHash" IS NOT NULL AND
        "transportCoverage"=(CASE WHEN bootstrapped THEN 'HTTP_WITH_WAF_BOOTSTRAP' ELSE 'HTTP_ONLY' END)) OR
      jsonb_typeof(proof) IS DISTINCT FROM 'object' OR pg_column_size(proof)>128000 OR
      proof->>'policy' IS DISTINCT FROM NEW."policyVersion" OR proof->>'readerRevision' IS DISTINCT FROM NEW."readerRevision" OR
      proof->>'sourceKey' IS DISTINCT FROM NEW."sourceKey" OR proof->>'sourceRevisionId' IS DISTINCT FROM current_revision OR
      proof->>'captureBatchId' IS DISTINCT FROM b.id OR proof->>'authorizationBasis' IS DISTINCT FROM 'OWNER_SECTOR_AUTHORIZATION' OR
      proof->>'ownerDecisionScope' IS DISTINCT FROM 'LUXURY_FASHION_BEAUTY_RETAIL_WATCHES_PUBLIC_JOBS' OR
      proof->>'ownerDecisionAt' IS DISTINCT FROM '2026-09-13' OR coalesce(proof->>'requestSetHash','') !~ '^[a-f0-9]{64}$' OR
      jsonb_array_length(doc->'scopes') NOT BETWEEN 1 AND 64 OR jsonb_array_length(doc->'robotsCaptureIds') NOT BETWEEN 1 AND 64 OR
      jsonb_typeof(proof->'scopeCounts') IS DISTINCT FROM 'array' OR jsonb_typeof(proof->'robots') IS DISTINCT FROM 'array' OR
      jsonb_array_length(proof->'scopeCounts')<>jsonb_array_length(doc->'scopes') OR
      jsonb_array_length(proof->'robots')<>jsonb_array_length(doc->'robotsCaptureIds') OR
      (proof->>'validUntil')::timestamptz IS DISTINCT FROM NEW."validUntil"
    THEN RAISE EXCEPTION 'Access grant requires bound native HTTP evidence and policy projection' USING ERRCODE='23514'; END IF;
    IF bootstrapped THEN
      FOR item IN SELECT value FROM jsonb_array_elements(doc->'bootstraps') LOOP
        IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>3 OR
          item->>'vendor' IS DISTINCT FROM 'AWS_WAF_CHALLENGE' OR coalesce(item->>'origin','') !~ '^https://[a-z0-9.-]+$' OR
          -- Défense en profondeur : la liste nommée par D-483 (wafBootstrap.ts), une source et une origine.
          (NEW."sourceKey", item->>'origin') IS DISTINCT FROM ('ralph-lauren-avature', 'https://careers.ralphlauren.com') OR
          NOT EXISTS (SELECT 1 FROM jsonb_array_elements(doc->'scopes') s WHERE s.value->>'origin'=item->>'origin') OR
          jsonb_typeof(item->'challengeHosts') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'challengeHosts') NOT BETWEEN 1 AND 8 THEN
          RAISE EXCEPTION 'Access grant declares an invalid WAF bootstrap' USING ERRCODE='23514';
        END IF;
        FOR host IN SELECT value FROM jsonb_array_elements(item->'challengeHosts') LOOP
          IF jsonb_typeof(host) IS DISTINCT FROM 'string' OR host#>>'{}' !~ '^https://([a-z0-9-]+\.)+awswaf\.com$' THEN
            RAISE EXCEPTION 'Access grant declares a WAF bootstrap host outside the AWS challenge infrastructure' USING ERRCODE='23514';
          END IF;
        END LOOP;
      END LOOP;
    END IF;
    FOR scope IN SELECT value FROM jsonb_array_elements(doc->'scopes') LOOP
      IF coalesce(scope->>'surface','') NOT IN ('PUBLIC_OFFICIAL_API','PUBLIC_ATS_JOB_API','PUBLIC_PORTAL_JSON','PUBLIC_XML_OR_RSS',
        'PUBLIC_SITEMAP','PUBLIC_OFFICIAL_HTML','PUBLIC_ATS_HTML') THEN
        RAISE EXCEPTION 'Access grant cannot classify an unknown or unsupported surface as public' USING ERRCODE='23514';
      END IF;
    END LOOP;
    SELECT count(*), count(*) FILTER (WHERE format='HTTP_RESPONSE'), count(*) FILTER (WHERE format='BROWSER_RESPONSE')
      INTO counts, http_count, browser_count FROM "RawCapture" WHERE "batchId"=b.id;
    request_count:=(proof->>'requestCount')::bigint;
    -- HTTP hops are the certified request count; the declared bootstrap's browser requests are counted apart.
    IF counts<1 OR http_count<1 OR (proof->>'captureCount')::bigint IS DISTINCT FROM counts OR request_count IS NULL OR request_count NOT BETWEEN http_count AND 100000 OR
      EXISTS (SELECT 1 FROM "RawCapture" WHERE "batchId"=b.id AND ("requestDataHash" IS NULL OR
        format NOT IN ('HTTP_RESPONSE', CASE WHEN bootstrapped THEN 'BROWSER_RESPONSE' ELSE 'HTTP_RESPONSE' END))) OR
      (bootstrapped AND (browser_count<1 OR (proof->>'bootstrapRequestCount')::bigint IS DISTINCT FROM browser_count)) OR
      (NOT bootstrapped AND proof->'bootstrapRequestCount' IS NOT NULL) OR
      (SELECT sum(value::text::bigint) FROM jsonb_array_elements(proof->'scopeCounts')) IS DISTINCT FROM request_count OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(proof->'scopeCounts') WHERE value::text::bigint<1) THEN
      RAISE EXCEPTION 'Access coverage differs from the complete native request journal' USING ERRCODE='23514';
    END IF;
    earliest:=least(b."startedAt",NEW."checkedAt");
    FOR item IN SELECT value FROM jsonb_array_elements(proof->'robots') LOOP
      SELECT * INTO b FROM "CaptureBatch" WHERE id=item->>'captureBatchId';
      SELECT * INTO r FROM "RawCapture" WHERE "batchId"=b.id ORDER BY sequence DESC LIMIT 1;
      IF b.id IS NULL OR b.id IS DISTINCT FROM doc->'robotsCaptureIds'->>ordinal OR b.purpose<>'SOURCE_ACCESS' OR b."formatVersion"<>3 OR
        b."sourceKey" IS DISTINCT FROM NEW."sourceKey" OR b."sourceRevisionId" IS DISTINCT FROM current_revision OR b."readerRevision" IS DISTINCT FROM NEW."readerRevision" OR
        b."startedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
        NEW."checkedAt" < b."startedAt"-interval '5 minutes' OR (item->>'observedAt')::timestamptz IS DISTINCT FROM b."startedAt" OR
        NOT EXISTS (SELECT 1 FROM "CaptureOutcome" WHERE "batchId"=b.id AND status='SOURCE_EVIDENCE' AND "manifestHash" IS NOT NULL) OR
        r.id IS NULL OR r.id IS DISTINCT FROM item->>'responseId' OR r."blobHash" IS NULL OR r."blobHash" IS DISTINCT FROM item->>'bodyHash' OR
        r.status IS DISTINCT FROM (item->>'status')::integer OR NOT r.complete OR r."requestDataHash" IS NULL OR
        coalesce(item->>'observationKind','') NOT IN ('RULES','NO_ROBOTS','UNREACHABLE') THEN
        RAISE EXCEPTION 'Robots observation differs from its current native evidence' USING ERRCODE='23514';
      END IF;
      earliest:=least(earliest,b."startedAt"); ordinal:=ordinal+1;
    END LOOP;
    IF NEW."validUntil" IS DISTINCT FROM earliest+interval '30 days' OR NEW."validUntil" < clock_timestamp() THEN
      RAISE EXCEPTION 'Access validity exceeds native evidence freshness' USING ERRCODE='23514';
    END IF;
  END IF;
  NEW.sequence:=nextval('"SourceAccessDecision_sequence_seq"'::regclass);
  RETURN NEW;
END $$;
COMMIT;

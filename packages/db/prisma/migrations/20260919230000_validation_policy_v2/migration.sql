-- LA VERSION DE POLITIQUE DE VALIDATION PASSE EN v2, DANS LE TRIGGER AUSSI.
--
-- ── POURQUOI CETTE MIGRATION EXISTE ────────────────────────────────────────────────────────────
--
-- `bind_source_ingestion_admission()` exige que la validation portée par une admission ait
-- EXACTEMENT la version de politique attendue. Cette version est écrite EN DUR dans la fonction.
--
-- Le 19/09/2026, la règle de validation a changé : la tolérance zéro (une offre non relisible
-- faisait échouer la source entière) devient un seuil nommé. `SOURCE_VALIDATION_POLICY` est donc
-- passée à `source-validation-20260919-v2` côté application.
--
-- Changer la constante TypeScript SANS migrer le trigger rend le pipeline entièrement bloquant :
-- toute validation rendue sous v2 est refusée par la base avec
-- « Ingestion admission requires the latest current native validation » (SQLSTATE 23514), donc
-- AUCUNE offre ne peut plus être publiée, quelle que soit la source.
--
-- C'est la CI qui l'a établi — `lifecycle.operational.test.ts` a échoué sur cette contrainte. Le
-- typecheck et les tests unitaires ne pouvaient pas le voir : la règle vit dans la base, pas dans
-- le code.
--
-- ── CE QUI CHANGE, ET CE QUI NE CHANGE PAS ─────────────────────────────────────────────────────
--
-- UNE SEULE LIGNE : `source-validation-20260916-v1` → `source-validation-20260919-v2`. Tout le
-- reste de la fonction est rejoué VERBATIM depuis sa version courante (migration
-- 20260918150000). Un garde-fou qu'on réécrit en le migrant est un garde-fou qu'on affaiblit sans
-- le savoir.
--
-- CONSÉQUENCE ASSUMÉE : les validations rendues sous v1 cessent d'admettre une ingestion. C'est
-- l'effet RECHERCHÉ — elles ont été rendues sous une règle différente, et rien ne dit qu'elles
-- passeraient la nouvelle. Chaque source se revalide à sa prochaine collecte.
--
-- RETOUR ARRIÈRE : rejouer la fonction de la migration 20260918150000 telle quelle, et remettre
-- `SOURCE_VALIDATION_POLICY` à la v1 côté application. Les deux vont ensemble, toujours.

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
    v."policyVersion"<>'source-validation-20260919-v2' OR v."readerRevision" IS DISTINCT FROM b."readerRevision" OR
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

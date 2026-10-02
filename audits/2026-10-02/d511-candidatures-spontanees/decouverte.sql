-- D-511 — découverte large, lecture seule : offres publiques dont l'intitulé contient un libellé de
-- candidature spontanée N'IMPORTE OÙ (pour trouver aussi les vrais postes qui le contiennent), ou que l'éditeur
-- déclare OPEN_APPLICATION. Rejouable : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -f <ce fichier>'
\pset pager off
WITH pub AS (
  SELECT j.id, j.title, j."opportunityType"::text AS ot, s."sourceKey", s."externalId"
  FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now())
)
SELECT "sourceKey", ot, title, count(*) n FROM pub
WHERE ot = 'OPEN_APPLICATION'
   OR title ~* '(spontan|initiativ|unsolicited|open\s+applica|general\s+applica|speculative|candidature\s+(libre|ouverte)|candidatura\s+(abierta|libre)|autocandidatura|open\s+sollicitatie|öppen\s+ansökan|åpen\s+søknad|uopfordret|avoin\s+hakemus|ενδιαφέροντος|talent\s+(pool|community|network)|vivier|bewerbungspool|future\s+opportunit|express(ion)?\s+(of\s+)?interest|register\s+your\s+interest|自荐|自薦|オープンポジション)'
GROUP BY 1,2,3 ORDER BY 1,3;

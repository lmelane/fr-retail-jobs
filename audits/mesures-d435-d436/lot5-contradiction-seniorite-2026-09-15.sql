-- LECTURE SEULE. LE TAUX DE DÉSACCORD entre la SOURCE DÉCLARÉE et la DÉDUCTION.
-- Population : offres où la source déclare un niveau d'expérience canonisable
-- ET où le regex sur l'intitulé a produit une valeur. Les deux existent : on
-- peut donc les confronter. Valeurs brutes tirées de l'énumération réelle.
-- Rejouable : node audits/mesures-d435-d436/q.mjs --file <ce fichier>
WITH a AS (
  SELECT source::text AS ats, "seniority" AS deduit,
    lower(COALESCE(raw#>>'{experienceLevel,id}', raw->>'experienceLevel',
                   raw->>'requiredExperience', raw->>'experience_code',
                   raw->>'careerLevel', raw->>'seniority')) AS brut
  FROM "Job"
  WHERE "isActive" = true AND "mergedIntoId" IS NULL AND raw IS NOT NULL
    AND "seniority" IS NOT NULL
),
b AS (
  SELECT ats, deduit, brut,
    CASE
      WHEN brut IN ('entry_level','entry-level','entry level','beginner','débutant','debutant','student_school','student_college','etudiant','berufseinsteiger(in)','prima esperienza','early-career') THEN 'JUNIOR'
      WHEN brut IN ('mid_level','mid-level','experienced','associate') THEN 'MID'
      WHEN brut IN ('mid_senior_level','mid-senior','mid-senior level') THEN 'SENIOR'
      WHEN brut IN ('manager') THEN 'MANAGER'
      WHEN brut IN ('director') THEN 'DIRECTOR'
      WHEN brut IN ('executive') THEN 'EXECUTIVE'
      ELSE NULL
    END AS brut_canon
  FROM a WHERE brut IS NOT NULL AND brut <> ''
)
SELECT ats, brut_canon, deduit, count(*)::int AS n
FROM b
WHERE brut_canon IS NOT NULL
GROUP BY 1,2,3
ORDER BY n DESC
LIMIT 60

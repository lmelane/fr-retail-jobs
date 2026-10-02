-- R-143 §10 (D-515 §1) — combien d'offres servies un filtre écarte-t-il seulement parce que la donnée est INCONNUE ?
-- Filtres stricts de job-search-query.ts : langue (`language`), secteur (`sectorCodes` vide = « unclassified »), métier
-- (aucun code ni rôle = « unclassified » ; strict par R-141), Maison et groupe (toujours connus). LECTURE SEULE.
SET statement_timeout = '240s';
SELECT count(*) servies,
  count(*) FILTER (WHERE j.language IS NULL) langue_inconnue,
  count(*) FILTER (WHERE cardinality(c."sectorCodes") = 0) secteur_inconnu,
  count(*) FILTER (WHERE c."parentGroup" IS NULL) sans_groupe,
  count(*) FILTER (WHERE j."occupationCode" IS NULL AND cardinality(j."titleRoles") = 0) metier_inconnu,
  count(*) FILTER (WHERE j."workTime" IS NULL) temps_inconnu,
  count(*) FILTER (WHERE j."workplaceType" IS NULL) lieu_de_travail_inconnu,
  count(*) FILTER (WHERE j."salaryMin" IS NULL AND j."salaryMax" IS NULL) salaire_inconnu
FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
WHERE j."isActive" AND j."mergedIntoId" IS NULL
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now()));

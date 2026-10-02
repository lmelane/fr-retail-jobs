-- D-520 — les 10 Maisons WTTJ de 3 offres ou moins au 23/09 (sous le plancher de 5 offres de l'alerte de couverture) :
-- sont-elles encore servies par le balayage wttj-sector au 02/10 ? (lecture seule)
SELECT json_agg(row_to_json(t)) FROM (
  SELECT m AS maison,
         (SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" JOIN "Company" c ON c.id = j."companyId"
           WHERE js."sourceKey" = 'wttj-sector' AND js."isActive" AND j."isActive" AND j."withdrawnAt" IS NULL
             AND lower(c.name) LIKE '%' || lower(m) || '%') AS servies,
         (SELECT max(js."lastSeenAt") FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" JOIN "Company" c ON c.id = j."companyId"
           WHERE js."sourceKey" = 'wttj-sector' AND lower(c.name) LIKE '%' || lower(m) || '%') AS "derniereVue"
    FROM unnest(ARRAY['figaret', 'dreyfuss', 'moea', 'payot', 'embryolisse', 'louise misha', 'lunettes pour tous',
                      'monsieur', 'simone p', 'wolf lingerie']) AS m
) t;

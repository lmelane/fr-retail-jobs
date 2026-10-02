-- D-515 §1 (suites du classement, 02/10/2026) : les offres Catwalks publiables (origine 0, servies AVANT toute offre
-- agrégée, D-419 §1) qui ne précisent pas un filtre toléré. Lecture seule. Le secteur et le groupe d'une offre directe
-- viennent de sa ligne (`sectorCodes`) ; la projection de recherche lit aussi ceux de sa Maison rattachée.
SELECT count(*) AS publiables,
  count(*) FILTER (WHERE cardinality(d."sectorCodes") = 0) AS sans_secteur,
  count(*) FILTER (WHERE coalesce(d.language, '') = '') AS sans_langue,
  count(*) FILTER (WHERE d."employmentTerm" IS NULL AND d."programType" IS NULL
    AND coalesce(d."engagementType", '') NOT IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR')) AS sans_contrat,
  count(*) FILTER (WHERE d."workTime" IS NULL) AS sans_temps
FROM "DirectOffer" d
WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > (now() AT TIME ZONE 'UTC'));

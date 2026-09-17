-- Export des candidats d'une campagne de qualification (lot F3), en LECTURE SEULE sur une copie du registre
-- (jamais la base de production vivante : `SET default_transaction_read_only = on` est posé par le runner).
-- Une ligne JSON par source ACTIVE d'une famille sous contrat de portail (sourcePortal.ts), avec le domaine
-- officiel de la Maison tel que le registre le porte : `Company.domain` (source-careers | wikidata | manual) de la
-- Maison la plus représentée parmi les offres de la source. Rien n'est deviné ici : une Maison sans domaine sort
-- `domain: null`, et la campagne le dérive, en le consignant, du seul careersDomain quand ce n'est pas un hôte vendeur.
-- Le fichier produit est privé (configurations natives du registre) : backups/…, jamais versionné.
\pset format unaligned
\pset tuples_only on
WITH maison AS (
  SELECT js."sourceKey" AS source_key, c.domain, c."domainSource", count(*) AS offres,
         row_number() OVER (PARTITION BY js."sourceKey" ORDER BY count(*) DESC, c.id) AS rang
  FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" JOIN "Company" c ON c.id = j."companyId"
  GROUP BY js."sourceKey", c.id, c.domain, c."domainSource"
)
SELECT json_build_object(
  'key', s.key, 'maison', s.maison, 'kind', s.kind, 'config', s.config, 'careersDomain', s."careersDomain", 'tier', s.tier,
  'jobUrlPattern', s."jobUrlPattern", 'domain', m.domain, 'domainSource', m."domainSource",
  'lastRunJobs', s."lastRunJobs", 'lastRunStatus', s."lastRunStatus")
FROM "Source" s LEFT JOIN maison m ON m.source_key = s.key AND m.rang = 1
WHERE s.status = 'ACTIVE'
  AND s.kind IN ('teamtailor', 'ashby', 'recruitee', 'workday', 'greenhouse', 'smartrecruiters-whitelabel', 'smartrecruiters',
                 'successfactors', 'lever', 'personio', 'workable', 'talentsoft', 'digitalrecruiters', 'flatchr', 'talentview',
                 'phenom', 'jibe', 'generic-listing', 'generic-jsonld', 'lvmh_algolia')
ORDER BY s.kind, s.key;

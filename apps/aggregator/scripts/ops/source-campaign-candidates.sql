-- Export des candidats d'une campagne de qualification (lot F3), en LECTURE SEULE sur une copie du registre
-- (jamais la base de production vivante : `SET default_transaction_read_only = on` est posé par le runner).
-- Une ligne JSON par source ACTIVE d'une famille sous contrat de portail (sourcePortal.ts), avec le domaine
-- officiel de la Maison tel que le registre le porte : `Company.domain` (source-careers | wikidata | manual) de la
-- Maison la plus représentée parmi les offres de la source. Rien n'est deviné ici : une Maison sans domaine sort
-- `domain: null`, et la campagne le dérive, en le consignant, du seul careersDomain quand ce n'est pas un hôte vendeur.
-- Le fichier produit est privé (configurations natives du registre) : backups/…, jamais versionné.
\pset format unaligned
\pset tuples_only on
-- Le domaine officiel par les OFFRES : la Maison la plus représentée parmi les offres de la source.
-- C'est la voie de référence — elle s'appuie sur ce que la collecte a réellement observé.
WITH maison AS (
  SELECT js."sourceKey" AS source_key, c.domain, c."domainSource", count(*) AS offres,
         row_number() OVER (PARTITION BY js."sourceKey" ORDER BY count(*) DESC, c.id) AS rang
  FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" JOIN "Company" c ON c.id = j."companyId"
  GROUP BY js."sourceKey", c.id, c.domain, c."domainSource"
),
-- REPLI PAR NOM, et la raison pour laquelle il existe (2026-09-18).
--
-- La voie ci-dessus passe par `JobSource` : sans offres, elle ne rend RIEN. Après le reset du
-- catalogue, les 407 candidats sont sortis avec `domain: null`, et la campagne a refusé chacun
-- d'eux sur DOMAINE_OFFICIEL_MANQUANT — alors que les 826 domaines officiels étaient bien en base,
-- sur `Company`. Ce n'était pas une donnée absente, c'était un CHEMIN cassé.
--
-- Le repli rapproche `Source.maison` et `Company.name` par égalité EXACTE. Pas de normalisation,
-- pas d'approximation : un rapprochement flou attribuerait le domaine d'une Maison à une autre, et
-- c'est précisément ce que la preuve d'identité existe pour empêcher. Mesuré : 353 sources sur 437.
--
-- Il ne s'applique QUE si la voie par les offres n'a rien rendu : l'observation prime toujours sur
-- l'homonymie.
maison_par_nom AS (
  SELECT s.key AS source_key, c.domain, c."domainSource",
         row_number() OVER (PARTITION BY s.key ORDER BY c.id) AS rang
  FROM "Source" s JOIN "Company" c ON c.name = s.maison
  WHERE c.domain IS NOT NULL
)
SELECT json_build_object(
  'key', s.key, 'maison', s.maison, 'kind', s.kind, 'config', s.config, 'careersDomain', s."careersDomain", 'tier', s.tier,
  'jobUrlPattern', s."jobUrlPattern",
  -- Périmètre relu du portail (lot F4). NULL tant qu'aucun humain ne l'a tranché : la campagne
  -- écrira alors NULL comme avant, et l'ingestion refusera une source sans employeur natif.
  'portalScope', s."portalScope",
  -- La note porte les décisions relues à la main, dont `domaine-accepte:<domaine>` (lot F8) : la
  -- campagne s'en sert pour reconnaître un domaine divergent qu'un humain a vérifié.
  'note', s.note,
  'domain', coalesce(m.domain, n.domain), 'domainSource', coalesce(m."domainSource", n."domainSource"),
  'lastRunJobs', s."lastRunJobs", 'lastRunStatus', s."lastRunStatus")
FROM "Source" s
  LEFT JOIN maison m ON m.source_key = s.key AND m.rang = 1
  LEFT JOIN maison_par_nom n ON n.source_key = s.key AND n.rang = 1
WHERE s.status = 'ACTIVE'
  AND s.kind IN ('teamtailor', 'ashby', 'recruitee', 'workday', 'greenhouse', 'smartrecruiters-whitelabel', 'smartrecruiters',
                 'successfactors', 'lever', 'personio', 'workable', 'talentsoft', 'digitalrecruiters', 'flatchr', 'talentview',
                 'phenom', 'jibe', 'generic-listing', 'generic-jsonld', 'lvmh_algolia',
                 -- Lot F7 (18/09/2026) : les familles dont le contrat de portail vient d'être écrit.
                 -- Sans elles, 30 sources ACTIVE restaient hors campagne — L'Oréal, Kering, Estée
                 -- Lauder, Tiffany, Ralph Lauren, Zegna, URBN, Dr. Martens, GANNI, Acne Studios,
                 -- Swatch Group. Leurs adaptateurs existaient et fonctionnaient ; seule la
                 -- déclaration qui permet de reconnaître leur portail manquait.
                 -- `wttj-sector` reste volontairement dehors : agrégateur sectoriel sans Maison
                 -- propre, il n'a pas de portail d'employeur à prouver.
                 'altamira', 'avature', 'bashtalents', 'easycruit', 'eightfold', 'eqwa',
                 'geodirectory', 'harri', 'icims', 'jobaffinity-wordpress', 'jobylon', 'magnet',
                 'oraclehcm', 'radancy', 'rituals', 'swatchgroup', 'talentfunnel',
                 'talentrecruiter', 'taleo', 'typesense', 'volcanic', 'wordpress', 'wttj')
ORDER BY s.kind, s.key;

-- Lot F4 (2026-09-18) : le périmètre du portail, relu par un humain, devient une donnée du registre.
--
-- POURQUOI. `SourceIdentityReview.portalScope` porte déjà ce périmètre, mais il est écrit PAR la
-- campagne, qui le fixe à NULL en dur (`source-campaign.mts:142`) avec cette raison : « le rôle exact
-- du portail n'est pas déduit du nom de la Maison ». La campagne a raison de ne pas deviner — mais
-- elle n'avait aucun moyen de LIRE une décision humaine. Résultat mesuré le 18/09/2026 : les 50
-- sources Greenhouse ACTIVE sont qualifiables mais aucune ne peut écrire d'offre
-- (`PORTAL_OWNER_NOT_CERTIFIED`, `resolve.ts:41-43`), parce que Greenhouse ne rend aucun employeur
-- natif (11 offres sur 11 en SOURCE_CATALOGUE_LABEL).
--
-- CE QUE CETTE COLONNE EST, ET N'EST PAS. Elle est une DÉCISION DE PÉRIMÈTRE relue et tracée : « ce
-- portail ne publie que pour cette Maison ». Elle n'est PAS une preuve d'identité et ne peut pas s'y
-- substituer : la revue continue d'exiger sa capture archivée, son lien inspecté et son hash. La
-- campagne lira cette valeur pour RENSEIGNER la revue qu'elle écrit — jamais pour la dispenser de
-- prouver quoi que ce soit.
--
-- SÛRETÉ. Colonne nullable, aucune valeur par défaut, aucune donnée réécrite : NULL = non relu,
-- exactement l'état d'aujourd'hui. La contrainte n'admet que les deux valeurs du domaine métier.
--
-- DÉCLENCHEURS. `Source_record_revision` (BEFORE INSERT OR UPDATE) ne calcule sa révision que sur
-- key, maison, kind, config, careersDomain, jobUrlPattern, tier et tenantKey
-- (`source_revision_payload`, migration 20260916040000). `portalScope` n'en fait pas partie : écrire
-- ce champ ne crée AUCUNE révision et n'invalide donc aucune revue d'identité déjà acquise — ce qui
-- serait arrivé si la colonne avait été ajoutée à la charge utile de révision.
BEGIN;

ALTER TABLE "Source" ADD COLUMN "portalScope" TEXT;

ALTER TABLE "Source" ADD CONSTRAINT "Source_portalScope_check"
  CHECK ("portalScope" IS NULL OR "portalScope" IN ('SINGLE_BRAND', 'MULTI_BRAND'));

COMMENT ON COLUMN "Source"."portalScope" IS
  'Périmètre relu du portail : SINGLE_BRAND (ne publie que pour cette Maison) ou MULTI_BRAND. NULL = non relu. Décision humaine tracée, jamais une preuve d''identité : la revue exige toujours sa capture archivée.';

COMMIT;

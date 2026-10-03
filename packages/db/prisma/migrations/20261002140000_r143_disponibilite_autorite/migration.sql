-- R-143 §2 et §3 (D-513, 02/10/2026) — la disponibilité servie et l'autorité de la source officielle.
--
-- Additif : aucune donnée n'est supprimée, aucune colonne existante n'est modifiée.
--  1. Une représentation peut porter une RETENUE DE DISPONIBILITÉ : elle reste active (le cycle de vie n'en dit
--     rien), mais elle ne suffit plus à servir l'offre au candidat. Deux motifs : NOT_RECONFIRMED (une collecte
--     crédible de sa source, commencée à `availabilityHoldAt`, ne l'a pas vue) et APPLY_LINK_DEAD (la sonde a lu,
--     à `availabilityHoldAt`, une page de candidature morte). La retenue s'éteint d'elle-même dès que la source
--     la revoit : `lastSeenAt >= availabilityHoldAt` (packages/db/availability.ts).
--  2. `publisherClosedAt` : l'instant où la SOURCE ELLE-MÊME a prouvé la fin de cette représentation (absence
--     d'une énumération prouvée, échéance déclarée, retrait natif « fermée »). Effacé quand elle la republie.
--     Une fermeture par une source officielle de rang supérieur ferme l'offre (packages/db/publications.ts).
--  3. Rattrapage du stock de `publisherClosedAt` : les représentations inactives que le refresh a désactivées
--     sur preuve (DataCorrection REFRESH_LIFECYCLE, issue APPLIED) et que leur source n'a pas revues depuis.
--     Écrit une colonne nouvelle, rien d'autre ; rejouable (même résultat).
-- Ordre de livraison : cette migration AVANT le code. L'ancien code ne lit ni n'écrit ces colonnes.
-- Verrou (release r6, 02/10/2026) : les ALTER et les CHECK prennent un verrou exclusif sur "JobSource" (98 869 lignes,
-- 1,4 Go), tenu jusqu'au COMMIT. Sans borne, l'attente derrière une lecture longue mettrait en file toutes les requêtes
-- de l'API derrière elle. `lock_timeout` borne cette ATTENTE (pas le travail une fois le verrou pris) : au-delà de 10 s,
-- la transaction échoue sans rien écrire ; marquer la migration `prisma migrate resolve --rolled-back` puis relancer.
-- Posé avant toute application en production (vérifié dans _prisma_migrations le 02/10 à 19:37 UTC).
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE "JobSource" ADD COLUMN "availabilityHold" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "availabilityHoldAt" TIMESTAMP(3);
ALTER TABLE "JobSource" ADD COLUMN "availabilityEvidence" JSONB;
ALTER TABLE "JobSource" ADD COLUMN "publisherClosedAt" TIMESTAMP(3);
-- NOT VALID (release r6) : la contrainte vaut pour toute écriture dès le COMMIT, sans parcourir les 98 869 lignes
-- sous le verrou exclusif ; la validation du stock (colonnes neuves, toutes NULL) est faite par la migration suivante,
-- 20261002140100, sous un verrou qui laisse lire et écrire.
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_availabilityHold_check"
  CHECK ("availabilityHold" IS NULL OR "availabilityHold" IN ('NOT_RECONFIRMED','APPLY_LINK_DEAD')) NOT VALID;
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_availabilityHold_instant_check"
  CHECK (("availabilityHold" IS NULL) = ("availabilityHoldAt" IS NULL)) NOT VALID;

UPDATE "JobSource" js SET "publisherClosedAt" = proof.at
FROM (
  SELECT DISTINCT ON (deactivated.id) deactivated.id, dc."createdAt" AS at
  FROM "DataCorrection" dc
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(dc.evidence->'deactivatedIds') = 'array'
    THEN dc.evidence->'deactivatedIds' ELSE '[]'::jsonb END) AS deactivated(id)
  WHERE dc.finding = 'REFRESH_LIFECYCLE' AND dc.evidence->>'outcome' = 'APPLIED'
  ORDER BY deactivated.id, dc."createdAt" DESC
) proof
WHERE js.id = proof.id AND NOT js."isActive" AND js."publisherClosedAt" IS NULL AND js."lastSeenAt" < proof.at;
COMMIT;

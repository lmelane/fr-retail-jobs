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
BEGIN;
ALTER TABLE "JobSource" ADD COLUMN "availabilityHold" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "availabilityHoldAt" TIMESTAMP(3);
ALTER TABLE "JobSource" ADD COLUMN "availabilityEvidence" JSONB;
ALTER TABLE "JobSource" ADD COLUMN "publisherClosedAt" TIMESTAMP(3);
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_availabilityHold_check"
  CHECK ("availabilityHold" IS NULL OR "availabilityHold" IN ('NOT_RECONFIRMED','APPLY_LINK_DEAD'));
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_availabilityHold_instant_check"
  CHECK (("availabilityHold" IS NULL) = ("availabilityHoldAt" IS NULL));

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

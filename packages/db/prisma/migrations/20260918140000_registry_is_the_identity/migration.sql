-- Lot F5 (2026-09-18) : LE REGISTRE DIT QUI RECRUTE. La revue d'identité par capture cesse d'être
-- une condition de collecte.
--
-- ── LA DÉCISION ────────────────────────────────────────────────────────────────────────────────
--
-- Décision du CEO, réaffirmée trois fois le 18/09/2026 : « nous avons TOUTES les maisons, l'ATS
-- cible, le palier, le domaine officiel — ça ne sert à rien ». Le registre a été relu ligne à ligne
-- (536 lignes, 45 corrections, 20 boards usurpés retirés) et cette relecture fait autorité.
--
-- ── CE QUE LA MESURE A MONTRÉ ──────────────────────────────────────────────────────────────────
--
-- La revue d'identité n'apportait AUCUNE information que le registre ne porte déjà :
--   · `ownerName` venait de `Source.maison`            (sourceIdentity.ts:180)
--   · `ownerKey`  était dérivé de `Source.maison`      (sourceIdentity.ts:45)
--   · `portalScope` vient désormais de `Source.portalScope` (lot F4, colonne relue par le CEO)
-- Elle ne faisait que recopier le registre dans une table, au prix d'une capture réseau par source.
--
-- Son coût réel, mesuré sur le lot Railway du 18/09 (20 sources) : 12 IDENTITE_NON_PROUVEE, dont
-- au moins 3 FAUX REFUS — `club-monaco` (apex en 403, `www` en 200, chemins non dépliés sur le
-- `www`), `bellroy` et `figs` (lien exact présent mais à l'intérieur d'un <script>, écarté par
-- principe). Pendant ce temps, les 50 boards Greenhouse relus par le CEO concordent à 49/50 avec
-- l'API Greenhouse elle-même, l'unique écart étant une maison mère qu'il avait documentée.
-- La vérification automatique était donc à la fois redondante ET moins fiable que la relecture.
--
-- ── CE QUI DISPARAÎT, ET CE QUI RESTE ──────────────────────────────────────────────────────────
--
-- DISPARAÎT : l'obligation d'une `SourceIdentityReview` pour promouvoir, admettre ou publier.
--
-- RESTE, inchangé :
--   · la décision d'accès robots.txt (`SourceAccessDecision`) — indépendante de l'identité,
--     vérifiée : elle protège juridiquement et n'a jamais dépendu de cette revue ;
--   · la validation de collecte hors réseau (`SourceValidation`) ;
--   · la règle « une offre doit savoir qui recrute » : l'employeur vient du registre
--     (maison + portalScope SINGLE_BRAND) ou de l'offre elle-même ; à défaut l'offre est REFUSÉE.
--     Ce n'est pas une revue d'identité, c'est une règle de cohérence — sans elle on publierait
--     des offres sans Maison.
--
-- L'historique est CONSERVÉ : les revues déjà écrites restent lisibles, leur table et leur
-- déclencheur d'intégrité ne bougent pas. Seul le CARACTÈRE OBLIGATOIRE du lien disparaît.
BEGIN;

-- `identityReviewId` devient facultatif : une admission peut désormais s'appuyer sur le registre
-- seul. La clé étrangère et son index restent, pour que les admissions historiques gardent leur
-- lien et restent vérifiables.
ALTER TABLE "SourceIngestionAdmission" ALTER COLUMN "identityReviewId" DROP NOT NULL;

COMMENT ON COLUMN "SourceIngestionAdmission"."identityReviewId" IS
  'Revue d''identité historique, facultative depuis le lot F5 (18/09/2026) : le registre relu fait autorité sur l''identité d''une source. NULL = admission fondée sur le registre.';

COMMIT;

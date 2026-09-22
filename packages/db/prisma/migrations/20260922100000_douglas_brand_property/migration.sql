-- DOUGLAS — LA PROPRIÉTÉ DE MARQUE, LIVRÉE AVEC LE CODE QUI LA LIT.
--
-- ── POURQUOI UNE MIGRATION, ET PAS UN GESTE MANUEL ───────────────────────────────────────────
--
-- `be586ec` apprend à l'adaptateur SuccessFactors à lire un champ de marque servi au niveau
-- liste (`normalizeRmkItem`, opt-in par `brandProperty`). Mais ce champ se déclare dans
-- `Source.config`, une colonne de la base — pas dans le code. Constat du 2026-09-22 :
-- `data/seeds/sources.csv` a été supprimé, et `reimporter-registre-sources.mts` l'assume —
-- « la table EST devenue la source de vérité ». Déployer le code seul n'aurait donc JAMAIS
-- ajouté Douglas : le pipeline sait lire la marque, rien ne la déclare.
--
-- Cette migration fait voyager la configuration AVEC le code qui l'exploite.
--
-- ── CE QUE LA SOURCE SERT RÉELLEMENT ─────────────────────────────────────────────────────────
--
-- Mesuré sur le RAW archivé du 2026-09-21 : l'API de liste
-- `POST /services/recruiting/v1/jobs` sert `sfstd_marketingBrand_obj` sur ses offres —
-- `["DOUGLAS"]` et `["NOCIBE"]` — dans 150 réponses du lot. Sans cette déclaration, l'étiquette
-- d'employeur vient du registre (`SOURCE_CATALOGUE_LABEL`) et la règle d'identité la refuse sur
-- un portail non certifié : 315 offres bloquées en `PORTAL_OWNER_NOT_CERTIFIED`.
--
-- ── RÉVERSIBILITÉ : CE QUI EST VRAI, ET CE QUI NE L'EST PAS ──────────────────────────────────
--
-- Prisma n'exécute aucun rollback automatique. Ce qui est vrai ici est plus modeste et plus
-- utile : la modification est IDEMPOTENTE (la rejouer ne change rien), la valeur précédente est
-- CONNUE (`brandProperty` absent), et une migration compensatoire est donc possible —
-- `config = config - 'brandProperty'` sur cette seule clé. Le reste de `config` n'est jamais
-- touché : on FUSIONNE (`||`) au lieu de remplacer.
--
-- ── LE GARDE-FOU : ON N'ÉCRASE PAS UNE CONFIGURATION DIVERGENTE ──────────────────────────────
--
-- La migration échoue plutôt que d'écrire si la source n'est pas exactement celle attendue, ou
-- si `brandProperty` y porte déjà une AUTRE valeur — laquelle serait le fruit d'une décision que
-- cette migration ignore.

DO $$
DECLARE
  attendu    CONSTANT text := 'sfstd_marketingBrand_obj';
  origine    CONSTANT text := 'https://jobs.douglas.group';
  trouvees   integer;
  actuel     text;
BEGIN
  -- 1. La source existe EXACTEMENT une fois, avec le bon connecteur et la bonne origine.
  SELECT count(*) INTO trouvees
    FROM "Source"
   WHERE key = 'douglas-sf' AND kind = 'successfactors' AND config->>'origin' = origine;

  IF trouvees <> 1 THEN
    RAISE EXCEPTION
      'Douglas brandProperty: attendu 1 source (key=douglas-sf, kind=successfactors, origin=%), trouvé %',
      origine, trouvees;
  END IF;

  -- 2. `brandProperty` est absent, ou porte DÉJÀ la valeur cible. Toute autre valeur est une
  --    configuration divergente : on refuse de l'écraser en silence.
  SELECT config->>'brandProperty' INTO actuel FROM "Source" WHERE key = 'douglas-sf';

  IF actuel IS NOT NULL AND actuel <> attendu THEN
    RAISE EXCEPTION
      'Douglas brandProperty: configuration divergente (attendu % ou absent, trouvé %) — écriture refusée',
      attendu, actuel;
  END IF;

  IF actuel = attendu THEN
    RAISE NOTICE 'Douglas brandProperty: déjà posé, aucune écriture (migration idempotente)';
    RETURN;
  END IF;

  -- 3. Fusion CIBLÉE : `||` ajoute la clé et préserve tout le reste de `config`.
  --    L'écriture déclenche `Source_record_revision`, qui crée la nouvelle révision — c'est le
  --    comportement voulu : la configuration change, donc la révision change, et la campagne
  --    reconstruira normalement la décision d'accès qui s'y adosse. Aucune preuve ancienne n'est
  --    rattachée artificiellement à cette nouvelle révision.
  UPDATE "Source"
     SET config = config || jsonb_build_object('brandProperty', attendu)
   WHERE key = 'douglas-sf';

  RAISE NOTICE 'Douglas brandProperty: posé (%)', attendu;
END $$;

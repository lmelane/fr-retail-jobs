-- Lot 7 — la recherche texte devient un vecteur plein texte pondéré, maintenu dans la base.
--
-- Mesuré sur le clone du stock (87 607 offres, 16/09/2026) : l'index trigramme de `searchText`
-- (479 Mo) n'est jamais choisi pour des termes courants, et chaque terme rebalaye les descriptions
-- (206 Mo de texte pour le seul marché américain) : « store manager » sur le marché US coûtait
-- 5,3 s après la normalisation, 9 s avant. Un index inversé sur les MOTS répond sans relire le texte.
--
-- Deux colonnes par offre, agrégée (`Job`) comme directe (`DirectOffer`) :
--   - `searchVector` : les mots de tout le texte indexé, sans positions — c'est lui qui FILTRE (GIN) ;
--   - `titleVector`  : les mots du titre (poids A) et de la Maison et de son groupe (poids B) — c'est
--                      lui qui CLASSE (le terme dans le titre : 2, porté par la Maison : 1, ailleurs : 0).
-- Un mot = une suite de lettres ou de chiffres du texte NORMALISÉ (minuscules, sans accents, apostrophes
-- unifiées — `catwalks_normaliser_texte`, migration 20260916200000) ; tout le reste sépare.
-- Un terme de requête s'apparie au DÉBUT d'un mot (`mot:*`) ; les écritures sans espaces (chinois…)
-- restent appariées n'importe où par `LIKE` sur `searchText` (apps/api/lib/job-search-query.ts).
BEGIN;
SET LOCAL lock_timeout = '2s';

-- Les mots d'un texte : normalisé, puis tout ce qui n'est pas lettre ou chiffre devient un espace.
CREATE OR REPLACE FUNCTION catwalks_mots(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT regexp_replace(catwalks_normaliser_texte(t), '[^[:alnum:]]+', ' ', 'g');
$$;

-- Le vecteur qui filtre : les mots de tout le texte indexé, sans positions.
CREATE OR REPLACE FUNCTION catwalks_vecteur_texte(texte text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT strip(to_tsvector('simple', catwalks_mots(coalesce(texte, ''))));
$$;

-- Le vecteur qui classe : le titre (A), la Maison et son groupe (B).
CREATE OR REPLACE FUNCTION catwalks_vecteur_titre(titre text, maison text, groupe text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT setweight(to_tsvector('simple', catwalks_mots(coalesce(titre, ''))), 'A')
      || setweight(to_tsvector('simple', catwalks_mots(coalesce(maison, '') || ' ' || coalesce(groupe, ''))), 'B');
$$;

-- La requête d'un terme : chacun de ses mots en préfixe, ET entre les mots, restreinte à un poids
-- (`'A'`, `'B'`, `'AB'`) ou non (`''`). NULL quand le terme n'a aucun mot : il ne trouve rien.
CREATE OR REPLACE FUNCTION catwalks_requete(terme text, poids text DEFAULT '') RETURNS tsquery
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT to_tsquery('simple', string_agg(mot || ':*' || poids, ' & '))
  FROM regexp_split_to_table(catwalks_mots(terme), ' ') AS mot WHERE mot <> '';
$$;

ALTER TABLE "Job" ADD COLUMN "searchVector" tsvector, ADD COLUMN "titleVector" tsvector;
ALTER TABLE "DirectOffer" ADD COLUMN "searchVector" tsvector, ADD COLUMN "titleVector" tsvector;

-- Offre agrégée : le déclencheur qui maintient `searchText` maintient les deux vecteurs.
CREATE OR REPLACE FUNCTION catwalks_refresh_job_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT catwalks_job_search_text(NEW.title, NEW.description, NEW.city, NEW.location, NEW.department,
           NEW."employmentTerm", c.name, c."parentGroup"),
         catwalks_vecteur_titre(NEW.title, c.name, c."parentGroup")
    INTO NEW."searchText", NEW."titleVector"
  FROM "Company" c WHERE c.id = NEW."companyId";
  NEW."searchVector" := catwalks_vecteur_texte(NEW."searchText");
  RETURN NEW;
END;
$$;

-- Une Maison renommée (ou rattachée à un autre groupe) : ses offres suivent, texte et vecteurs.
CREATE OR REPLACE FUNCTION catwalks_refresh_company_job_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Job" j
     SET "searchText" = t.texte,
         "searchVector" = catwalks_vecteur_texte(t.texte),
         "titleVector" = catwalks_vecteur_titre(j.title, NEW.name, NEW."parentGroup")
    FROM (SELECT id, catwalks_job_search_text(title, description, city, location, department,
                  "employmentTerm", NEW.name, NEW."parentGroup") AS texte
            FROM "Job" WHERE "companyId" = NEW.id) t
   WHERE t.id = j.id;
  RETURN NULL;
END;
$$;

-- Offre directe : le texte brut de la projection est normalisé, puis vectorisé, dans la base.
CREATE OR REPLACE FUNCTION catwalks_normaliser_offre_directe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := catwalks_normaliser_texte(NEW."searchText");
  NEW."searchVector" := catwalks_vecteur_texte(NEW."searchText");
  NEW."titleVector" := catwalks_vecteur_titre(NEW.title, NEW.company, NULL);
  RETURN NEW;
END;
$$;
DROP TRIGGER "DirectOffer_search_before_write" ON "DirectOffer";
CREATE TRIGGER "DirectOffer_search_before_write"
  BEFORE INSERT OR UPDATE OF "searchText", title, company ON "DirectOffer" FOR EACH ROW
  EXECUTE FUNCTION catwalks_normaliser_offre_directe();

COMMIT;

-- Lot 7 — la normalisation du texte de recherche vit dans la base, en un seul endroit.
--
-- `Job.searchText` et `DirectOffer.searchText` sont des colonnes d'INDEX : le texte original
-- (titre, description, noms) n'est jamais modifié. Elles deviennent normalisées : minuscules,
-- accents retirés (`unaccent`), apostrophes typographiques unifiées. La même fonction normalise
-- le terme de chaque requête (apps/api/lib/job-search-query.ts), donc « école » et « ecole »
-- désignent les mêmes offres (mesuré avant : 1 574 contre 400 offres FR).
--
-- `unaccent()` est STABLE (dictionnaire) ; l'enveloppe IMMUTABLE nomme le dictionnaire explicitement,
-- ce qui l'autorise dans un index et une colonne maintenue par déclencheur (pratique documentée).
BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION catwalks_normaliser_texte(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, translate(t, '’‘‛`´ʼ', repeat('''', 6))));
$$;

-- Le texte indexé d'une offre agrégée : la même concaténation qu'avant, normalisée.
CREATE OR REPLACE FUNCTION catwalks_job_search_text(
  title text, description text, city text, location text, department text,
  employment_term text, company_name text, parent_group text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT catwalks_normaliser_texte(coalesce(title,'') || ' ' || coalesce(description,'') || ' ' ||
    coalesce(city,'') || ' ' || coalesce(location,'') || ' ' || coalesce(department,'') || ' ' ||
    coalesce(employment_term,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(parent_group,''));
$$;

-- Une offre directe arrive avec son texte brut (projection de l'agrégateur) : la base le normalise.
CREATE FUNCTION catwalks_normaliser_offre_directe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := catwalks_normaliser_texte(NEW."searchText");
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DirectOffer_search_before_write"
  BEFORE INSERT OR UPDATE OF "searchText" ON "DirectOffer" FOR EACH ROW
  EXECUTE FUNCTION catwalks_normaliser_offre_directe();

COMMIT;

-- Lot 7 — les identités (Maison résolue, code métier) entrent dans le vecteur qui filtre.
--
-- Mesuré sur le clone du stock : la condition « (texte OU Maison) ET (texte OU Maison) OU métier » faisait
-- choisir au planificateur un balayage de `Job` avec `@@` par ligne (635 à 828 ms sur « store manager »,
-- marché US), l'index GIN n'étant retenu que pour une condition plein texte SEULE (28 ms). Les identités
-- deviennent des mots du vecteur (`maison<id>`, `metier<code>`) : toute la condition — texte OU Maison
-- pour chaque terme, ET entre les termes, OU les métiers de la taxonomie — est UNE requête plein texte,
-- servie par l'index (`catwalks_requete_terme`, `catwalks_requete_metiers`, apps/api/lib/job-search-query.ts).
-- La reprise ajoute les deux mots aux vecteurs existants sans les recalculer.
BEGIN;
SET LOCAL lock_timeout = '2s';

-- Une identité en un mot : préfixe + valeur réduite à ses lettres et chiffres (identifiant, code métier).
CREATE OR REPLACE FUNCTION catwalks_identite(prefixe text, valeur text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT prefixe || lower(regexp_replace(valeur, '[^[:alnum:]]', '', 'g'));
$$;

-- Le vecteur qui filtre : les mots du texte indexé, plus l'identité de la Maison et celle du métier.
DROP FUNCTION catwalks_vecteur_texte(text);
CREATE FUNCTION catwalks_vecteur_texte(texte text, maison text, metier text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT strip(to_tsvector('simple', catwalks_mots(coalesce(texte, '')) || ' '
    || coalesce(catwalks_identite('maison', maison), '') || ' ' || coalesce(catwalks_identite('metier', metier), '')));
$$;

-- La requête d'un terme : ses mots en préfixe, OU l'une des Maisons résolues pour lui (l'un des deux peut manquer).
CREATE FUNCTION catwalks_requete_terme(terme text, maisons text[]) RETURNS tsquery
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN m.q IS NULL THEN catwalks_requete(terme)
              WHEN catwalks_requete(terme) IS NULL THEN m.q
              ELSE catwalks_requete(terme) || m.q END
  FROM (SELECT to_tsquery('simple', string_agg(catwalks_identite('maison', id), ' | ')) AS q FROM unnest(maisons) AS id) m;
$$;

-- Les métiers de la taxonomie reconnus sur la requête entière : l'un d'eux.
CREATE FUNCTION catwalks_requete_metiers(codes text[]) RETURNS tsquery
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT to_tsquery('simple', string_agg(catwalks_identite('metier', code), ' | ')) FROM unnest(codes) AS code;
$$;

-- Offre agrégée : le déclencheur suit aussi le code métier, dont l'identité vit dans le vecteur.
CREATE OR REPLACE FUNCTION catwalks_refresh_job_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT catwalks_job_search_text(NEW.title, NEW.description, NEW.city, NEW.location, NEW.department,
           NEW."employmentTerm", c.name, c."parentGroup"),
         catwalks_vecteur_titre(NEW.title, c.name, c."parentGroup")
    INTO NEW."searchText", NEW."titleVector"
  FROM "Company" c WHERE c.id = NEW."companyId";
  NEW."searchVector" := catwalks_vecteur_texte(NEW."searchText", NEW."companyId", NEW."occupationCode");
  RETURN NEW;
END;
$$;
DROP TRIGGER catwalks_job_search_before_write ON "Job";
CREATE TRIGGER catwalks_job_search_before_write
  BEFORE INSERT OR UPDATE OF title, description, city, location, department, "employmentTerm", "companyId", "occupationCode" ON "Job"
  FOR EACH ROW EXECUTE FUNCTION catwalks_refresh_job_search();

-- Une Maison renommée : ses offres suivent, texte et vecteurs, identités comprises.
CREATE OR REPLACE FUNCTION catwalks_refresh_company_job_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Job" j
     SET "searchText" = t.texte,
         "searchVector" = catwalks_vecteur_texte(t.texte, j."companyId", j."occupationCode"),
         "titleVector" = catwalks_vecteur_titre(j.title, NEW.name, NEW."parentGroup")
    FROM (SELECT id, catwalks_job_search_text(title, description, city, location, department,
                  "employmentTerm", NEW.name, NEW."parentGroup") AS texte
            FROM "Job" WHERE "companyId" = NEW.id) t
   WHERE t.id = j.id;
  RETURN NULL;
END;
$$;

-- Offre directe : ni Maison du registre ni code métier ; le texte seul.
CREATE OR REPLACE FUNCTION catwalks_normaliser_offre_directe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := catwalks_normaliser_texte(NEW."searchText");
  NEW."searchVector" := catwalks_vecteur_texte(NEW."searchText", NULL, NULL);
  NEW."titleVector" := catwalks_vecteur_titre(NEW.title, NEW.company, NULL);
  RETURN NEW;
END;
$$;

-- Reprise : les deux identités s'ajoutent aux vecteurs existants (aucun recalcul du texte).
UPDATE "Job"
   SET "searchVector" = strip("searchVector" || to_tsvector('simple',
         coalesce(catwalks_identite('maison', "companyId"), '') || ' ' || coalesce(catwalks_identite('metier', "occupationCode"), '')));

COMMIT;

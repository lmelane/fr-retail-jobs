-- D-496 (01/10/2026) : la recherche par lieu devient une recherche de proximité. ADDITIVE.
--
-- 1. Une base mondiale de villes (GeoNames `cities500`, CC BY 4.0, chargée par
--    apps/aggregator/scripts/geo/villes.py) : trois tables neuves, vides à la migration.
-- 2. Le point de recherche d'une offre (`geo*`) : ses coordonnées natives si elle en porte, sinon le centre de sa
--    ville. Quatre colonnes nullables, sans défaut (ajout instantané, aucune ligne réécrite). Un déclencheur les tient
--    à jour à l'insertion et quand la ville, le pays, la subdivision ou les coordonnées changent : l'ingestion des
--    nouvelles offres n'a rien à appeler. Le stock se rattrape par `catwalks_geo_rattrapage()` (scripts/geo/rattrapage-*.sql),
--    ensembliste, lancé à part, sur GO.
-- 3. Les index du point et de la ville sont créés sans verrou long par les deux migrations suivantes (CONCURRENTLY).
--
-- Aucune donnée existante n'est modifiée par cette migration. Le déclencheur n'agit que sur les écritures suivantes ;
-- tant que la base de villes est vide, il écrit le point natif ou rien.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "GeoCity" (
  "id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "admin1Code" TEXT,
  "admin2Code" TEXT,
  "admin1Name" TEXT,
  -- Ce que la suggestion écrit entre parenthèses (« Paris (75) ») : le département en France, l'État aux États-Unis,
  -- ailleurs la première subdivision seulement quand le nom existe deux fois dans le pays. Calculé au chargement.
  "subdivision" TEXT,
  -- Les formes qui désignent la subdivision dans une saisie (« 94 », « TX », « Texas », « Pennsylvania ») :
  -- `catwalks_subdivision_cles(admin1Name, admin1Code, admin2Code, subdivision)`, calculé au chargement.
  "subdivisionKeys" TEXT[] NOT NULL DEFAULT '{}',
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "population" BIGINT NOT NULL DEFAULT 0,
  "featureCode" TEXT NOT NULL,
  -- Proposable en suggestion. Faux pour un doublon (le 13e de Paris existe deux fois dans GeoNames : « Paris 13 Gobelins »
  -- et « Paris 13e Arrondissement ») et pour une entité administrative (« London Borough of Bexley ») ; un tel lieu reste
  -- résolu pour les offres et les saisies qui le nomment. D-499 : un arrondissement est un lieu proposé, avec son point.
  "suggestible" BOOLEAN NOT NULL DEFAULT true,
  "releaseId" INTEGER NOT NULL,
  CONSTRAINT "GeoCity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT geo_city_country CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT geo_city_coordinates CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);

-- Chaque nom (nom principal, forme ASCII, variantes de toutes langues), sous sa clé de lieu. La collation "C" rend la
-- clé primaire utilisable par l'égalité ET par le préfixe (`LIKE 'chenn%'`) des suggestions.
CREATE TABLE "GeoCityName" (
  "countryCode" TEXT NOT NULL,
  "nameKey" TEXT COLLATE "C" NOT NULL,
  "cityId" INTEGER NOT NULL,
  "primary" BOOLEAN NOT NULL,
  CONSTRAINT "GeoCityName_pkey" PRIMARY KEY ("countryCode", "nameKey", "cityId"),
  CONSTRAINT "GeoCityName_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "GeoCity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GeoCityName_cityId_idx" ON "GeoCityName"("cityId");

-- Le nom d'une ville dans une langue de l'interface, quand il diffère du nom principal (« München », « Londres »).
CREATE TABLE "GeoCityLabel" (
  "cityId" INTEGER NOT NULL,
  "language" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  CONSTRAINT "GeoCityLabel_pkey" PRIMARY KEY ("cityId", "language"),
  CONSTRAINT "GeoCityLabel_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "GeoCity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Chaque chargement : la source, ses fichiers et leurs empreintes, la licence et l'attribution qu'elle exige.
CREATE TABLE "GeoCityRelease" (
  "id" SERIAL NOT NULL,
  "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL,
  "licence" TEXT NOT NULL,
  "attribution" TEXT NOT NULL,
  "files" JSONB NOT NULL,
  "cities" INTEGER NOT NULL,
  "names" INTEGER NOT NULL,
  "labels" INTEGER NOT NULL,
  "postalCodes" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "GeoCityRelease_pkey" PRIMARY KEY ("id")
);
-- Une saisie qui nomme une région du marché (« Texas », « Bayern ») garde sa recherche par subdivision (apps/api/lib/geo.ts).
CREATE INDEX "GeoCity_subdivisionKeys_idx" ON "GeoCity" USING gin ("subdivisionKeys");
ALTER TABLE "GeoCity" ADD CONSTRAINT "GeoCity_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "GeoCityRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Le point de recherche des deux origines. `geoSource` : NATIVE (coordonnées de la publication) ou CITY (centre de la ville).
ALTER TABLE "Job"
  ADD COLUMN "geoCityId" INTEGER,
  ADD COLUMN "geoLatitude" DOUBLE PRECISION,
  ADD COLUMN "geoLongitude" DOUBLE PRECISION,
  ADD COLUMN "geoSource" TEXT;
ALTER TABLE "DirectOffer"
  ADD COLUMN "geoCityId" INTEGER,
  ADD COLUMN "geoLatitude" DOUBLE PRECISION,
  ADD COLUMN "geoLongitude" DOUBLE PRECISION,
  ADD COLUMN "geoSource" TEXT;

-- LA CLÉ D'UN LIEU : la même forme pour un nom de la base de villes, la ville d'une offre et la saisie d'une personne.
-- Minuscules sans accents (`catwalks_normaliser_texte`), la partie avant la première virgule (« New York, NY »), la
-- ponctuation en espaces (« Saint-Tropez » = « Saint Tropez »), « St » et « Ste » écrits en entier, sans code postal
-- (« 75008 Paris », « Paris 75008 » → « paris »), et le numéro d'un arrondissement sous une seule forme (D-499 : un
-- arrondissement est son propre lieu ; « Paris 9e Arrondissement », « Paris 09 », « Paris 9ème » → « paris 9 »).
CREATE FUNCTION catwalks_lieu_cle(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    ' ' || regexp_replace(catwalks_normaliser_texte(split_part(t, ',', 1)), '[^[:alnum:]]+', ' ', 'g') || ' ',
    ' (st|saint) ', ' saint ', 'g'), ' (ste|sainte) ', ' sainte ', 'g'),
    ' [0-9]{4,5} $', ' '),
    ' 0*([1-9][0-9]?) ?(e|er|eme|re|o)? ?(arrondissement)? $', ' \1 '),
    '^ [0-9]{4,5} ', ' ')), '')
$$;

-- LA CLÉ D'UN CODE POSTAL : majuscules, sans espace ni tiret (« sw1a 1aa » = « SW1A1AA », « 59-700 » = « 59700 »).
CREATE FUNCTION catwalks_code_postal_cle(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT nullif(upper(regexp_replace(t, '[^[:alnum:]]+', '', 'g')), '')
$$;

-- D-499 — LES CODES POSTAUX, lieux reconnus comme les villes (GeoNames `export/zip/allCountries.zip`, CC BY 4.0, chargé
-- par villes.py) : un code, le lieu qu'il dessert, sa subdivision affichée, son point. Un code peut desservir plusieurs
-- lieux (une ligne chacun).
CREATE TABLE "GeoPostalCode" (
  "countryCode" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "postalKey" TEXT COLLATE "C" NOT NULL,
  "placeName" TEXT NOT NULL,
  "placeKey" TEXT COLLATE "C" NOT NULL,
  "subdivision" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "releaseId" INTEGER NOT NULL,
  CONSTRAINT "GeoPostalCode_pkey" PRIMARY KEY ("countryCode", "postalKey", "placeName"),
  CONSTRAINT "GeoPostalCode_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "GeoCityRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT geo_postal_coordinates CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);

-- LES FORMES D'UNE SUBDIVISION, telles qu'une saisie ou une offre peut l'écrire : la clé de lieu de chaque forme
-- (« Île-de-France » → « ile de france ») et la forme brute en minuscules, qui garde les codes numériques que la clé
-- retire (« 94 », « 2A », « TX »). Une seule définition pour le chargement et la résolution.
CREATE FUNCTION catwalks_subdivision_cles(VARIADIC formes TEXT[]) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}'::text[])
    FROM unnest(formes) f, LATERAL unnest(ARRAY[catwalks_lieu_cle(f), lower(btrim(f))]) x
   WHERE x IS NOT NULL AND x <> ''
$$;

-- LA VILLE D'UN NOM, par la seule base de villes, dans des pays donnés : la subdivision indiquée d'abord (« Paris (75) »,
-- « Austin, TX », la subdivision d'une offre), exigée quand le pays la connaît, puis une ville avant un quartier (PPLX : « Saint-Louis » est une commune
-- d'Alsace avant d'être un quartier de Marseille), puis le nom principal avant une variante, puis la plus peuplée. Le nom
-- principal passe avant la population : mesuré sur les villes des offres actives le 01/10/2026 (audits/2026-10-01/
-- localisation), la population d'abord plaçait 1 782 offres sans coordonnées à plus de 30 km de leurs voisines qui en
-- ont (« Frisco » à San Francisco, « Central Valley » à Santa Maria), le nom principal d'abord 1 505.
CREATE FUNCTION catwalks_ville_par_nom(pays TEXT[], ville TEXT, indice TEXT) RETURNS INTEGER
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH h AS (SELECT CASE WHEN indice IS NOT NULL THEN catwalks_subdivision_cles(indice) END AS cles),
  -- Une subdivision indiquée que le pays connaît (« Washington », « 94 ») est exigée : « Lynwood, Washington » n'est pas
  -- Lynwood en Californie. Une indication que le pays ne connaît pas (« Paris, France ») ne fait que départager.
  exigee AS (SELECT h.cles, h.cles IS NOT NULL AND EXISTS (SELECT 1 FROM "GeoCity" r WHERE r."countryCode" = ANY(pays)
    AND r."subdivisionKeys" && h.cles) AS oui FROM h)
  SELECT n."cityId" FROM "GeoCityName" n JOIN "GeoCity" c ON c."id" = n."cityId", exigee e
   WHERE n."countryCode" = ANY(pays) AND n."nameKey" = catwalks_lieu_cle(ville)
     AND (NOT e.oui OR c."subdivisionKeys" && e.cles)
   ORDER BY (e.cles IS NOT NULL AND c."subdivisionKeys" && e.cles) DESC,
            (c."featureCode" <> 'PPLX') DESC, n."primary" DESC, c."population" DESC, c."id"
   LIMIT 1
$$;

-- CE QUE LE CATALOGUE A APPRIS D'UN NOM AMBIGU : « Beverly Hills », « Garden City », « Glendale » sans État désignent
-- plusieurs villes ; quand les offres de ce nom qui portent des coordonnées natives sont groupées (point médian à 30 km
-- au plus d'une des villes de ce nom), c'est cette ville, même si la règle par nom en désigne une autre. Calculé par
-- `catwalks_geo_apprentissage()`, écrit par le rattrapage (scripts/geo/rattrapage-ecriture.sql) ; ne porte que les
-- exceptions à la règle par nom.
CREATE TABLE "GeoCityLearned" (
  "countryCode" TEXT NOT NULL,
  "nameKey" TEXT COLLATE "C" NOT NULL,
  "cityId" INTEGER NOT NULL,
  "offers" INTEGER NOT NULL,
  "learnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeoCityLearned_pkey" PRIMARY KEY ("countryCode", "nameKey"),
  CONSTRAINT "GeoCityLearned_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "GeoCity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- LA VILLE D'UN NOM : sans subdivision indiquée, ce que le catalogue a appris de ce nom ; sinon la règle par nom. Une seule
-- règle pour les offres (déclencheur, rattrapage), les saisies et les filtres (apps/api/lib/geo.ts).
CREATE FUNCTION catwalks_ville_resolue(pays TEXT[], ville TEXT, indice TEXT) RETURNS INTEGER
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    (SELECT l."cityId" FROM "GeoCityLearned" l
      WHERE indice IS NULL AND l."countryCode" = ANY(pays) AND l."nameKey" = catwalks_lieu_cle(ville)
      ORDER BY l."offers" DESC, l."countryCode" LIMIT 1),
    catwalks_ville_par_nom(pays, ville, indice))
$$;

CREATE FUNCTION catwalks_coordonnees_valides(lat DOUBLE PRECISION, lon DOUBLE PRECISION) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lat IS NOT NULL AND lon IS NOT NULL AND lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0)
$$;

-- LE POINT D'UNE OFFRE : ses coordonnées natives si elles sont valides, sinon le centre de sa ville, sinon rien.
-- La ville est rattachée dans les deux cas (elle range l'offre sous sa ville dans les suggestions).
CREATE FUNCTION catwalks_point_offre(pays TEXT, ville TEXT, indice TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
  OUT "cityId" INTEGER, OUT "latitude" DOUBLE PRECISION, OUT "longitude" DOUBLE PRECISION, OUT "source" TEXT)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF pays IS NOT NULL AND ville IS NOT NULL THEN
    "cityId" := catwalks_ville_resolue(ARRAY[pays], ville, indice);
  END IF;
  IF catwalks_coordonnees_valides(lat, lon) THEN
    "latitude" := lat; "longitude" := lon; "source" := 'NATIVE';
  ELSIF "cityId" IS NOT NULL THEN
    SELECT c."latitude", c."longitude" INTO "latitude", "longitude" FROM "GeoCity" c WHERE c."id" = "cityId";
    "source" := 'CITY';
  END IF;
END;
$$;

CREATE FUNCTION catwalks_geo_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
  p := catwalks_point_offre(NEW."countryCode", NEW."city", NEW."adminArea1", NEW."latitude", NEW."longitude");
  NEW."geoCityId" := p."cityId"; NEW."geoLatitude" := p."latitude"; NEW."geoLongitude" := p."longitude"; NEW."geoSource" := p."source";
  RETURN NEW;
END;
$$;
-- À l'insertion, et à la mise à jour seulement quand une entrée CHANGE : le pipeline réécrit la ville à chaque
-- observation ; recalculer un point inchangé coûtait 0,5 à 1,3 ms par offre (mesuré sur la répétition, 01/10/2026).
CREATE TRIGGER catwalks_geo_job BEFORE INSERT ON "Job" FOR EACH ROW EXECUTE FUNCTION catwalks_geo_job();
CREATE TRIGGER catwalks_geo_job_update BEFORE UPDATE OF "city", "countryCode", "adminArea1", "latitude", "longitude"
  ON "Job" FOR EACH ROW WHEN (NEW."city" IS DISTINCT FROM OLD."city" OR NEW."countryCode" IS DISTINCT FROM OLD."countryCode"
    OR NEW."adminArea1" IS DISTINCT FROM OLD."adminArea1" OR NEW."latitude" IS DISTINCT FROM OLD."latitude"
    OR NEW."longitude" IS DISTINCT FROM OLD."longitude")
  EXECUTE FUNCTION catwalks_geo_job();

CREATE FUNCTION catwalks_geo_offre_directe() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
  p := catwalks_point_offre(NEW."countryCode", NEW."city", NULL, NEW."latitude", NEW."longitude");
  NEW."geoCityId" := p."cityId"; NEW."geoLatitude" := p."latitude"; NEW."geoLongitude" := p."longitude"; NEW."geoSource" := p."source";
  RETURN NEW;
END;
$$;
CREATE TRIGGER catwalks_geo_offre_directe BEFORE INSERT ON "DirectOffer" FOR EACH ROW EXECUTE FUNCTION catwalks_geo_offre_directe();
CREATE TRIGGER catwalks_geo_offre_directe_update BEFORE UPDATE OF "city", "countryCode", "latitude", "longitude"
  ON "DirectOffer" FOR EACH ROW WHEN (NEW."city" IS DISTINCT FROM OLD."city" OR NEW."countryCode" IS DISTINCT FROM OLD."countryCode"
    OR NEW."latitude" IS DISTINCT FROM OLD."latitude" OR NEW."longitude" IS DISTINCT FROM OLD."longitude")
  EXECUTE FUNCTION catwalks_geo_offre_directe();

-- L'APPRENTISSAGE (voir `GeoCityLearned`) : pour chaque nom de ville d'offres actives SANS subdivision dont au moins
-- une porte des coordonnées natives, quand la ville de la règle par nom est à plus de 30 km de leur point médian, la
-- ville de ce nom la plus proche de ce point, si elle en est à 30 km au plus (jamais un doublon non proposable). Lecture
-- seule ; le rattrapage l'écrit.
CREATE FUNCTION catwalks_geo_apprentissage() RETURNS TABLE ("countryCode" TEXT, "nameKey" TEXT, "cityId" INTEGER, offers INTEGER)
LANGUAGE sql STABLE AS $$
  WITH natives AS (
    SELECT j."countryCode" AS pays, catwalks_lieu_cle(j."city") AS k, j."latitude" AS lat, j."longitude" AS lon
      FROM "Job" j
     WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."adminArea1" IS NULL AND j."city" IS NOT NULL
       AND j."countryCode" IS NOT NULL AND catwalks_coordonnees_valides(j."latitude", j."longitude")
  ),
  centres AS (
    SELECT pays, k, count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS lat, percentile_cont(0.5) WITHIN GROUP (ORDER BY lon) AS lon
      FROM natives WHERE k IS NOT NULL GROUP BY pays, k
  ),
  proche AS (
    SELECT c.pays, c.k, c.n, c.lat, c.lon, v."id", v.d FROM centres c
    CROSS JOIN LATERAL (
      SELECT x."id", 6371.0088 * 2 * asin(least(1::float8, sqrt(power(sin(radians(x."latitude" - c.lat) / 2), 2)
               + cos(radians(c.lat)) * cos(radians(x."latitude")) * power(sin(radians(x."longitude" - c.lon) / 2), 2)))) AS d
        FROM "GeoCityName" nm JOIN "GeoCity" x ON x."id" = nm."cityId"
       WHERE nm."countryCode" = c.pays AND nm."nameKey" = c.k AND x."suggestible"
       ORDER BY d LIMIT 1) v
  ),
  regle AS (
    SELECT p.*, r."latitude" AS rlat, r."longitude" AS rlon
      FROM proche p LEFT JOIN "GeoCity" r ON r."id" = catwalks_ville_par_nom(ARRAY[p.pays], p.k, NULL)
  )
  SELECT g.pays, g.k, g."id", g.n FROM regle g
   WHERE g.d <= 30 AND (g.rlat IS NULL OR 6371.0088 * 2 * asin(least(1::float8, sqrt(power(sin(radians(g.rlat - g.lat) / 2), 2)
           + cos(radians(g.lat)) * cos(radians(g.rlat)) * power(sin(radians(g.rlon - g.lon) / 2), 2)))) > 30)
$$;

-- LE RATTRAPAGE DU STOCK, une seule définition pour le passage à blanc et l'écriture : chaque offre dont le point
-- enregistré diffère de celui que le déclencheur écrirait une fois l'apprentissage du jour écrit. Ensembliste : la ville est résolue une fois par
-- clé distincte (pays, ville, subdivision), jamais offre par offre. Les offres absorbées (`mergedIntoId`) ne sont jamais
-- servies : elles sont laissées telles quelles. Les entrées (ville, pays, subdivision, coordonnées) sont rendues avec le
-- résultat : l'écriture ne touche une offre que si elles n'ont pas changé entre-temps (scripts/geo/rattrapage-ecriture.sql).
CREATE FUNCTION catwalks_geo_rattrapage() RETURNS TABLE (
  origine TEXT, id TEXT, actif BOOLEAN, pays TEXT, ville TEXT, indice TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
  "cityId" INTEGER, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, source TEXT)
LANGUAGE sql STABLE AS $$
  WITH offres AS (
    SELECT 'job'::text AS origine, j."id", j."isActive" AS actif, j."countryCode" AS pays, j."city" AS ville,
           j."adminArea1" AS indice, j."latitude" AS lat, j."longitude" AS lon,
           j."geoCityId", j."geoLatitude", j."geoLongitude", j."geoSource"
      FROM "Job" j WHERE j."mergedIntoId" IS NULL
    UNION ALL
    SELECT 'direct', d."id", d."eligible", d."countryCode", d."city", NULL, d."latitude", d."longitude",
           d."geoCityId", d."geoLatitude", d."geoLongitude", d."geoSource"
      FROM "DirectOffer" d
  ),
  cles AS (
    SELECT DISTINCT o.pays, o.ville, o.indice FROM offres o WHERE o.pays IS NOT NULL AND o.ville IS NOT NULL
  ),
  -- L'apprentissage du jour, et non la table : l'écriture remplace la table par lui dans la même transaction.
  appris AS MATERIALIZED (SELECT * FROM catwalks_geo_apprentissage()),
  villes AS (
    SELECT k.pays, k.ville, k.indice, coalesce(
             CASE WHEN k.indice IS NULL THEN (SELECT a."cityId" FROM appris a WHERE a."countryCode" = k.pays AND a."nameKey" = catwalks_lieu_cle(k.ville)) END,
             catwalks_ville_par_nom(ARRAY[k.pays], k.ville, k.indice)) AS "cityId"
      FROM cles k
  ),
  calcul AS (
    SELECT o.*, v."cityId" AS cible, catwalks_coordonnees_valides(o.lat, o.lon) AS native
      FROM offres o
      LEFT JOIN villes v ON v.pays = o.pays AND v.ville = o.ville AND v.indice IS NOT DISTINCT FROM o.indice
  ),
  points AS (
    SELECT t.*,
           CASE WHEN t.native THEN t.lat ELSE c."latitude" END AS nouvelle_lat,
           CASE WHEN t.native THEN t.lon ELSE c."longitude" END AS nouvelle_lon,
           CASE WHEN t.native THEN 'NATIVE' WHEN c."id" IS NOT NULL THEN 'CITY' END AS nouvelle_source
      FROM calcul t LEFT JOIN "GeoCity" c ON c."id" = t.cible AND NOT t.native
  )
  SELECT p.origine, p."id", p.actif, p.pays, p.ville, p.indice, p.lat, p.lon, p.cible, p.nouvelle_lat, p.nouvelle_lon, p.nouvelle_source
    FROM points p
   WHERE (p.cible, p.nouvelle_lat, p.nouvelle_lon, p.nouvelle_source)
         IS DISTINCT FROM (p."geoCityId", p."geoLatitude", p."geoLongitude", p."geoSource")
$$;

COMMIT;

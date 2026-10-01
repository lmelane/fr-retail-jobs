-- D-496 — CE QUE LES CERCLES RETIENDRAIENT APRÈS LE RATTRAPAGE, par marché, sur une base JETABLE de répétition (lieux
-- des offres de production importés, base de villes chargée, rattrapage écrit : README de ce dossier). Offres actives,
-- sans mot-clé ni filtre ; la comparaison texte d'avant en regard (ville égale ou préfixe, libellé, subdivision).
\pset footer off
CREATE TEMP TABLE cas (marche text, pays text[], saisie text);
INSERT INTO cas VALUES
 ('FR', '{FR,MC}', 'Chennevières-sur-Marne'), ('FR', '{FR,MC}', 'Paris'), ('FR', '{FR,MC}', 'Paris 15e'), ('FR', '{FR,MC}', 'Paris 9e Arrondissement'), ('FR', '{FR,MC}', 'Lyon'), ('FR', '{FR,MC}', 'Annecy'),
 ('US', '{US}', 'New York'), ('US', '{US}', 'Beverly Hills'), ('US', '{US}', 'Austin'), ('GB', '{GB,IE}', 'London'),
 ('GB', '{GB,IE}', 'Londres'), ('DE', '{DE,AT}', 'München'), ('IT', '{IT}', 'Milano'), ('ES', '{ES}', 'Madrid'),
 ('CN', '{CN}', 'Shanghai'), ('JP', '{JP}', 'Tokyo'), ('CH', '{CH}', 'Genève');
WITH v AS (SELECT c.*, g.id, g.name, g.latitude AS vlat, g.longitude AS vlon
             FROM cas c LEFT JOIN "GeoCity" g ON g.id = catwalks_ville_resolue(c.pays, c.saisie, NULL)),
d AS (SELECT v.marche, v.saisie, v.name, 6371.0088 * 2 * asin(least(1::float8, sqrt(power(sin(radians(j."geoLatitude" - v.vlat) / 2), 2)
        + cos(radians(v.vlat)) * cos(radians(j."geoLatitude")) * power(sin(radians(j."geoLongitude" - v.vlon) / 2), 2)))) AS km
        FROM v JOIN "Job" j ON j."countryCode" = ANY(v.pays) AND j."isActive" AND j."geoLatitude" IS NOT NULL),
n AS (SELECT marche, saisie, name, count(*) FILTER (WHERE km <= 15) n15, count(*) FILTER (WHERE km <= 30) n30,
        count(*) FILTER (WHERE km <= 50) n50, count(*) FILTER (WHERE km <= 100) n100 FROM d GROUP BY 1, 2, 3),
t AS (SELECT c.marche, c.saisie, count(*) AS texte FROM cas c JOIN "Job" j ON j."countryCode" = ANY(c.pays) AND j."isActive"
        AND (catwalks_normaliser_texte(j.city) LIKE catwalks_normaliser_texte(c.saisie) || '%'
          OR catwalks_normaliser_texte(j.location) LIKE '%' || catwalks_normaliser_texte(c.saisie) || '%'
          OR catwalks_normaliser_texte(j."adminArea1") LIKE catwalks_normaliser_texte(c.saisie)) GROUP BY 1, 2)
SELECT n.marche, n.saisie, n.name AS ville, coalesce(t.texte, 0) AS avant_texte, n.n15, n.n30, n.n50, n.n100,
       CASE WHEN n.n15 >= 20 THEN n.n15 WHEN n.n30 >= 20 THEN n.n30 WHEN n.n50 >= 20 THEN n.n50 ELSE n.n100 END AS apres,
       CASE WHEN n.n15 >= 20 THEN 15 WHEN n.n30 >= 20 THEN 30 WHEN n.n50 >= 20 THEN 50 ELSE 100 END AS cercle_km
  FROM n LEFT JOIN t USING (marche, saisie) ORDER BY n.marche, n.saisie;

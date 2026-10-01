-- D-496 — L'EXPORT EN LECTURE SEULE des colonnes de lieu des offres (aucune donnée personnelle : ville, pays,
-- subdivision, coordonnées, état), pour mesurer le rattrapage sur une base jetable chargée de la base de villes.
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'cd <dossier de sortie> && psql "$DATABASE_URL" -X -f <ce fichier>'
\copy (SELECT j.id, j."countryCode", j.city, j."adminArea1", j.latitude, j.longitude, j."isActive" AND j."mergedIntoId" IS NULL FROM "Job" j WHERE j."mergedIntoId" IS NULL) TO 'offres-geo.tsv'

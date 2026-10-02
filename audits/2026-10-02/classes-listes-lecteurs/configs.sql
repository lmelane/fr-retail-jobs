-- D-520 : la configuration des sources des trois classes (famille, adresse de liste, paramètres du lecteur).
-- LECTURE SEULE, hors fenêtre du RUN.
\pset footer off
\pset format csv
SET statement_timeout = '60s';
SET default_transaction_read_only = on;
SELECT key, kind, status, left(config::text, 1500) config FROM "Source"
WHERE key IN ('attaquer','kastner-ohler','lumentee','picard','marc-o-polo','gemmyo','pandora-talenthub','tapestry','knitwell-us-retail',
  'mango','nordstrom','hugo-boss-phenom','skechers-phenom','foot-locker-france','swatch-group','crocs','douglas-sf','sephora-france',
  'ulta-jibe','urbn-hub','on-running','aigle','indiska','ganni-talentrecruiter','estee-lauder-companies','kering','pvh','zegna-altamira','groupe-chantelle')
ORDER BY kind, key;

-- D-510 — combien des 25 premières offres portent les mots de la requête dans leur intitulé, avant (contrat 2 d'avant :
-- distance, puis pertinence) et après (fraîcheur) ? Texte des requêtes capturé par capture-servie.mts ; lecture seule.
\pset footer off
\pset tuples_only on
SELECT 'avant US Sales advisor', count(*) FILTER (WHERE t ~* 'sales|advisor|associate') || ' / ' || count(*) FROM (SELECT coalesce(j.title, d.title) AS t FROM (
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        round(((CASE WHEN s.vector @@ (to_tsquery('simple', '(''sales'':A <-> ''advisor'':A) | (''asesor'':A <-> ''de'':A <-> ''ventas'':A) | (''sales'':A <-> ''assistant'':A) | (''client'':A <-> ''advisor'':A) | (''luxury'':A <-> ''sales'':A <-> ''advisor'':A) | (''conseillere'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vente'':A) | (''conseillere'':A <-> ''vente'':A) | (''fashion'':A <-> ''advisor'':A) | (''sales'':A <-> ''associate'':A) | (''selling'':A <-> ''associate'':A) | (''vendeur'':A) | (''vendeuse'':A) | (''conseillers'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vendeur'':A) | (''conseillere'':A <-> ''vendeuse'':A) | (''associe'':A <-> ''aux'':A <-> ''ventes'':A) | (''associee'':A <-> ''aux'':A <-> ''ventes'':A) | (''addetto'':A <-> ''vendite'':A) | (''addetta'':A <-> ''vendite'':A) | (''addetti'':A <-> ''vendite'':A) | (''addett'':A <-> ''vendite'':A) | (''vendedor'':A) | (''vendedora'':A) | (''verkaufer'':A) | (''verkauferin'':A) | (''verkaufsberaterin'':A) | (''asesora'':A <-> ''de'':A <-> ''ventas'':A) | (''consultora'':A <-> ''de'':A <-> ''vendas'':A) | (''prodejni'':A <-> ''poradkyne'':A) | (''butiksassistent'':A) | (''lucrator'':A <-> ''comercial'':A) | (''lucratoare'':A <-> ''comerciala'':A) | (''addetto'':A <-> ''alle'':A <-> ''vendite'':A) | (''addetta'':A <-> ''alle'':A <-> ''vendite'':A) | (''dependiente'':A) | (''dependienta'':A) | (''winkelmedewerker'':A) | (''assistente'':A <-> ''de'':A <-> ''loja'':A) | (''vendedor'':A <-> ''de'':A <-> ''loja'':A) | (''vendedora'':A <-> ''de'':A <-> ''loja'':A) | (''sprzedawca'':A) | (''sprzedawczyni'':A) | (''butikssaljare'':A) | (''satıs'':A <-> ''elemanı'':A) | (''pembantu'':A <-> ''kedai'':A) | (''butikkmedarbeider'':A) | (''nhan'':A <-> ''vien'':A <-> ''ban'':A <-> ''hang'':A) | (''prodavac'':A) | (''prodavacka'':A) | (''bolti'':A <-> ''elado'':A)')) THEN 1000 WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 500 ELSE 0 END) + (ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''asesor'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')),32) + CASE WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 1.0 ELSE 0 END))::numeric * 1000000)::int AS score 
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "SearchDocument" s ON s.id=j.id AND s.version='search-5-20260924-v2' AND s.country IN ('US')
      WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = j.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ('2026-10-02T07:24:28.159Z'::timestamptz AT TIME ZONE 'UTC'))) AND j."countryCode" IN ('US') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''asesor'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))
      UNION ALL
      SELECT 'cw_' || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        round(((CASE WHEN s.vector @@ (to_tsquery('simple', '(''sales'':A <-> ''advisor'':A) | (''asesor'':A <-> ''de'':A <-> ''ventas'':A) | (''sales'':A <-> ''assistant'':A) | (''client'':A <-> ''advisor'':A) | (''luxury'':A <-> ''sales'':A <-> ''advisor'':A) | (''conseillere'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vente'':A) | (''conseillere'':A <-> ''vente'':A) | (''fashion'':A <-> ''advisor'':A) | (''sales'':A <-> ''associate'':A) | (''selling'':A <-> ''associate'':A) | (''vendeur'':A) | (''vendeuse'':A) | (''conseillers'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vendeur'':A) | (''conseillere'':A <-> ''vendeuse'':A) | (''associe'':A <-> ''aux'':A <-> ''ventes'':A) | (''associee'':A <-> ''aux'':A <-> ''ventes'':A) | (''addetto'':A <-> ''vendite'':A) | (''addetta'':A <-> ''vendite'':A) | (''addetti'':A <-> ''vendite'':A) | (''addett'':A <-> ''vendite'':A) | (''vendedor'':A) | (''vendedora'':A) | (''verkaufer'':A) | (''verkauferin'':A) | (''verkaufsberaterin'':A) | (''asesora'':A <-> ''de'':A <-> ''ventas'':A) | (''consultora'':A <-> ''de'':A <-> ''vendas'':A) | (''prodejni'':A <-> ''poradkyne'':A) | (''butiksassistent'':A) | (''lucrator'':A <-> ''comercial'':A) | (''lucratoare'':A <-> ''comerciala'':A) | (''addetto'':A <-> ''alle'':A <-> ''vendite'':A) | (''addetta'':A <-> ''alle'':A <-> ''vendite'':A) | (''dependiente'':A) | (''dependienta'':A) | (''winkelmedewerker'':A) | (''assistente'':A <-> ''de'':A <-> ''loja'':A) | (''vendedor'':A <-> ''de'':A <-> ''loja'':A) | (''vendedora'':A <-> ''de'':A <-> ''loja'':A) | (''sprzedawca'':A) | (''sprzedawczyni'':A) | (''butikssaljare'':A) | (''satıs'':A <-> ''elemanı'':A) | (''pembantu'':A <-> ''kedai'':A) | (''butikkmedarbeider'':A) | (''nhan'':A <-> ''vien'':A <-> ''ban'':A <-> ''hang'':A) | (''prodavac'':A) | (''prodavacka'':A) | (''bolti'':A <-> ''elado'':A)')) THEN 1000 WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 500 ELSE 0 END) + (ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''asesor'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')),32) + CASE WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 1.0 ELSE 0 END))::numeric * 1000000)::int 
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version='search-5-20260924-v2' AND s.country IN ('US')
      WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ('2026-10-02T07:24:28.159Z'::timestamptz AT TIME ZONE 'UTC')) AND d."countryCode" IN ('US') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''asesor'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, 0 AS pri, b.score
        
      FROM base b WHERE true
    ), 
    cles AS (
      SELECT id, origine, (NOT confirme)::int AS nc, pri AS pri, -score AS ns,
        coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np, (-extract(epoch FROM "firstSeenAt"))::float8 AS nf, confirme
      FROM scoped
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nc, pri, ns, np, nf, id)) ORDER BY origine, nc, pri, ns, np, nf, id)
         FROM (SELECT * FROM cles  ORDER BY origine, nc, pri, ns, np, nf, id LIMIT 26) p) AS page,
      jsonb_build_object(
        'pays', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."countryCode"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."countryCode" IS NOT NULL AND b."countryCode"::text <> '' GROUP BY b."countryCode"
     ORDER BY n DESC, value ) f),
        'metier', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END) code
            WHERE true GROUP BY code) f),
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE true GROUP BY code) f),
        'contrat', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]) value
     WHERE true GROUP BY value) f),
        'temps', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."workTime"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."workTime" IS NOT NULL AND b."workTime"::text <> '' GROUP BY b."workTime"
     ORDER BY n DESC, value ) f),
        'programme', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."programType"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."programType" IS NOT NULL AND b."programType"::text <> '' GROUP BY b."programType"
     ORDER BY n DESC, value ) f),
        'ville', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.ville::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.ville IS NOT NULL AND b.ville::text <> '' GROUP BY b.ville
     ORDER BY n DESC, value LIMIT 60) f),
        'maison', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.maison::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.maison IS NOT NULL AND b.maison::text <> '' GROUP BY b.maison
     ORDER BY n DESC, value ) f),
        'groupe', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.groupe::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.groupe IS NOT NULL AND b.groupe::text <> '' GROUP BY b.groupe
     ORDER BY n DESC, value ) f),
        'langue', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.language::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.language IS NOT NULL AND b.language::text <> '' GROUP BY b.language
     ORDER BY n DESC, value ) f)
      ) AS facettes
  ) r CROSS JOIN LATERAL jsonb_array_elements(r.page) WITH ORDINALITY x(e, n) LEFT JOIN "Job" j ON j.id = x.e->>'id' LEFT JOIN "DirectOffer" d ON 'cw_' || d.id = x.e->>'id' WHERE n <= 25) p;
SELECT 'avant FR Conseiller de vente', count(*) FILTER (WHERE t ~* 'conseill.*vent|vend|sales') || ' / ' || count(*) FROM (SELECT coalesce(j.title, d.title) AS t FROM (
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        round(((CASE WHEN s.vector @@ (to_tsquery('simple', '(''sales'':A <-> ''advisor'':A) | (''conseiller'':A <-> ''de'':A <-> ''vente'':A) | (''sales'':A <-> ''assistant'':A) | (''client'':A <-> ''advisor'':A) | (''luxury'':A <-> ''sales'':A <-> ''advisor'':A) | (''conseillere'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vente'':A) | (''conseillere'':A <-> ''vente'':A) | (''fashion'':A <-> ''advisor'':A) | (''sales'':A <-> ''associate'':A) | (''selling'':A <-> ''associate'':A) | (''vendeur'':A) | (''vendeuse'':A) | (''conseillers'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vendeur'':A) | (''conseillere'':A <-> ''vendeuse'':A) | (''associe'':A <-> ''aux'':A <-> ''ventes'':A) | (''associee'':A <-> ''aux'':A <-> ''ventes'':A) | (''addetto'':A <-> ''vendite'':A) | (''addetta'':A <-> ''vendite'':A) | (''addetti'':A <-> ''vendite'':A) | (''addett'':A <-> ''vendite'':A) | (''vendedor'':A) | (''vendedora'':A) | (''verkaufer'':A) | (''verkauferin'':A) | (''verkaufsberaterin'':A) | (''asesora'':A <-> ''de'':A <-> ''ventas'':A) | (''consultora'':A <-> ''de'':A <-> ''vendas'':A) | (''prodejni'':A <-> ''poradkyne'':A) | (''butiksassistent'':A) | (''lucrator'':A <-> ''comercial'':A) | (''lucratoare'':A <-> ''comerciala'':A) | (''addetto'':A <-> ''alle'':A <-> ''vendite'':A) | (''addetta'':A <-> ''alle'':A <-> ''vendite'':A) | (''dependiente'':A) | (''dependienta'':A) | (''winkelmedewerker'':A) | (''assistente'':A <-> ''de'':A <-> ''loja'':A) | (''vendedor'':A <-> ''de'':A <-> ''loja'':A) | (''vendedora'':A <-> ''de'':A <-> ''loja'':A) | (''sprzedawca'':A) | (''sprzedawczyni'':A) | (''butikssaljare'':A) | (''satıs'':A <-> ''elemanı'':A) | (''pembantu'':A <-> ''kedai'':A) | (''butikkmedarbeider'':A) | (''nhan'':A <-> ''vien'':A <-> ''ban'':A <-> ''hang'':A) | (''prodavac'':A) | (''prodavacka'':A) | (''bolti'':A <-> ''elado'':A)')) THEN 1000 WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 500 ELSE 0 END) + (ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''conseiller'':AC <-> ''de'':AC <-> ''vente'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')),32) + CASE WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 1.0 ELSE 0 END))::numeric * 1000000)::int AS score 
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "SearchDocument" s ON s.id=j.id AND s.version='search-5-20260924-v2' AND s.country IN ('FR','MC')
      WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = j.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ('2026-10-02T07:24:30.346Z'::timestamptz AT TIME ZONE 'UTC'))) AND j."countryCode" IN ('FR','MC') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''conseiller'':AC <-> ''de'':AC <-> ''vente'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))
      UNION ALL
      SELECT 'cw_' || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        round(((CASE WHEN s.vector @@ (to_tsquery('simple', '(''sales'':A <-> ''advisor'':A) | (''conseiller'':A <-> ''de'':A <-> ''vente'':A) | (''sales'':A <-> ''assistant'':A) | (''client'':A <-> ''advisor'':A) | (''luxury'':A <-> ''sales'':A <-> ''advisor'':A) | (''conseillere'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vente'':A) | (''conseillere'':A <-> ''vente'':A) | (''fashion'':A <-> ''advisor'':A) | (''sales'':A <-> ''associate'':A) | (''selling'':A <-> ''associate'':A) | (''vendeur'':A) | (''vendeuse'':A) | (''conseillers'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vendeur'':A) | (''conseillere'':A <-> ''vendeuse'':A) | (''associe'':A <-> ''aux'':A <-> ''ventes'':A) | (''associee'':A <-> ''aux'':A <-> ''ventes'':A) | (''addetto'':A <-> ''vendite'':A) | (''addetta'':A <-> ''vendite'':A) | (''addetti'':A <-> ''vendite'':A) | (''addett'':A <-> ''vendite'':A) | (''vendedor'':A) | (''vendedora'':A) | (''verkaufer'':A) | (''verkauferin'':A) | (''verkaufsberaterin'':A) | (''asesora'':A <-> ''de'':A <-> ''ventas'':A) | (''consultora'':A <-> ''de'':A <-> ''vendas'':A) | (''prodejni'':A <-> ''poradkyne'':A) | (''butiksassistent'':A) | (''lucrator'':A <-> ''comercial'':A) | (''lucratoare'':A <-> ''comerciala'':A) | (''addetto'':A <-> ''alle'':A <-> ''vendite'':A) | (''addetta'':A <-> ''alle'':A <-> ''vendite'':A) | (''dependiente'':A) | (''dependienta'':A) | (''winkelmedewerker'':A) | (''assistente'':A <-> ''de'':A <-> ''loja'':A) | (''vendedor'':A <-> ''de'':A <-> ''loja'':A) | (''vendedora'':A <-> ''de'':A <-> ''loja'':A) | (''sprzedawca'':A) | (''sprzedawczyni'':A) | (''butikssaljare'':A) | (''satıs'':A <-> ''elemanı'':A) | (''pembantu'':A <-> ''kedai'':A) | (''butikkmedarbeider'':A) | (''nhan'':A <-> ''vien'':A <-> ''ban'':A <-> ''hang'':A) | (''prodavac'':A) | (''prodavacka'':A) | (''bolti'':A <-> ''elado'':A)')) THEN 1000 WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 500 ELSE 0 END) + (ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''conseiller'':AC <-> ''de'':AC <-> ''vente'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')),32) + CASE WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 1.0 ELSE 0 END))::numeric * 1000000)::int 
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version='search-5-20260924-v2' AND s.country IN ('FR','MC')
      WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ('2026-10-02T07:24:30.346Z'::timestamptz AT TIME ZONE 'UTC')) AND d."countryCode" IN ('FR','MC') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''conseiller'':AC <-> ''de'':AC <-> ''vente'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, 0 AS pri, b.score
        
      FROM base b WHERE true
    ), 
    cles AS (
      SELECT id, origine, (NOT confirme)::int AS nc, pri AS pri, -score AS ns,
        coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np, (-extract(epoch FROM "firstSeenAt"))::float8 AS nf, confirme
      FROM scoped
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nc, pri, ns, np, nf, id)) ORDER BY origine, nc, pri, ns, np, nf, id)
         FROM (SELECT * FROM cles  ORDER BY origine, nc, pri, ns, np, nf, id LIMIT 26) p) AS page,
      jsonb_build_object(
        'pays', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."countryCode"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."countryCode" IS NOT NULL AND b."countryCode"::text <> '' GROUP BY b."countryCode"
     ORDER BY n DESC, value ) f),
        'metier', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END) code
            WHERE true GROUP BY code) f),
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE true GROUP BY code) f),
        'contrat', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]) value
     WHERE true GROUP BY value) f),
        'temps', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."workTime"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."workTime" IS NOT NULL AND b."workTime"::text <> '' GROUP BY b."workTime"
     ORDER BY n DESC, value ) f),
        'programme', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."programType"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."programType" IS NOT NULL AND b."programType"::text <> '' GROUP BY b."programType"
     ORDER BY n DESC, value ) f),
        'ville', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.ville::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.ville IS NOT NULL AND b.ville::text <> '' GROUP BY b.ville
     ORDER BY n DESC, value LIMIT 60) f),
        'maison', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.maison::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.maison IS NOT NULL AND b.maison::text <> '' GROUP BY b.maison
     ORDER BY n DESC, value ) f),
        'groupe', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.groupe::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.groupe IS NOT NULL AND b.groupe::text <> '' GROUP BY b.groupe
     ORDER BY n DESC, value ) f),
        'langue', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.language::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.language IS NOT NULL AND b.language::text <> '' GROUP BY b.language
     ORDER BY n DESC, value ) f)
      ) AS facettes
  ) r CROSS JOIN LATERAL jsonb_array_elements(r.page) WITH ORDINALITY x(e, n) LEFT JOIN "Job" j ON j.id = x.e->>'id' LEFT JOIN "DirectOffer" d ON 'cw_' || d.id = x.e->>'id' WHERE n <= 25) p;
SELECT 'avant FR Responsable de boutique', count(*) FILTER (WHERE t ~* 'responsable.*(boutique|magasin)|store manager|directeur.*(boutique|magasin)') || ' / ' || count(*) FROM (SELECT coalesce(j.title, d.title) AS t FROM (
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        round(((CASE WHEN s.vector @@ (to_tsquery('simple', '(''store'':A <-> ''manager'':A) | (''responsable'':A <-> ''de'':A <-> ''boutique'':A) | (''storemanager'':A) | (''shop'':A <-> ''manager'':A) | (''shopmanager'':A) | (''boutique'':A <-> ''manager'':A) | (''responsable'':A <-> ''de'':A <-> ''magasin'':A) | (''directeur'':A <-> ''de'':A <-> ''magasin'':A) | (''directrice'':A <-> ''de'':A <-> ''magasin'':A) | (''directeur'':A <-> ''de'':A <-> ''boutique'':A) | (''directrice'':A <-> ''de'':A <-> ''boutique'':A) | (''store'':A <-> ''director'':A) | (''manager'':A <-> ''di'':A <-> ''store'':A) | (''filialleiter'':A) | (''filialleiterin'':A)')) THEN 1000 WHEN s.vector @@ to_tsquery('simple', 'cwifd14f2280528ede02898e9dd1dd76bc0') THEN 500 ELSE 0 END) + (ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(to_tsquery('simple', '(''store'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''storemanager'':AC) | (''shop'':AC <-> ''manager'':AC) | (''shopmanager'':AC) | (''boutique'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''store'':AC <-> ''director'':AC) | (''manager'':AC <-> ''di'':AC <-> ''store'':AC) | (''filialleiter'':AC) | (''filialleiterin'':AC)')),32) + CASE WHEN s.vector @@ to_tsquery('simple', 'cwifd14f2280528ede02898e9dd1dd76bc0') THEN 1.0 ELSE 0 END))::numeric * 1000000)::int AS score 
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "SearchDocument" s ON s.id=j.id AND s.version='search-5-20260924-v2' AND s.country IN ('FR','MC')
      WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = j.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ('2026-10-02T07:24:30.587Z'::timestamptz AT TIME ZONE 'UTC'))) AND j."countryCode" IN ('FR','MC') AND s.vector @@ ((((to_tsquery('simple', '(''store'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''storemanager'':AC) | (''shop'':AC <-> ''manager'':AC) | (''shopmanager'':AC) | (''boutique'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''store'':AC <-> ''director'':AC) | (''manager'':AC <-> ''di'':AC <-> ''store'':AC) | (''filialleiter'':AC) | (''filialleiterin'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwifd14f2280528ede02898e9dd1dd76bc0')))
      UNION ALL
      SELECT 'cw_' || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        round(((CASE WHEN s.vector @@ (to_tsquery('simple', '(''store'':A <-> ''manager'':A) | (''responsable'':A <-> ''de'':A <-> ''boutique'':A) | (''storemanager'':A) | (''shop'':A <-> ''manager'':A) | (''shopmanager'':A) | (''boutique'':A <-> ''manager'':A) | (''responsable'':A <-> ''de'':A <-> ''magasin'':A) | (''directeur'':A <-> ''de'':A <-> ''magasin'':A) | (''directrice'':A <-> ''de'':A <-> ''magasin'':A) | (''directeur'':A <-> ''de'':A <-> ''boutique'':A) | (''directrice'':A <-> ''de'':A <-> ''boutique'':A) | (''store'':A <-> ''director'':A) | (''manager'':A <-> ''di'':A <-> ''store'':A) | (''filialleiter'':A) | (''filialleiterin'':A)')) THEN 1000 WHEN s.vector @@ to_tsquery('simple', 'cwifd14f2280528ede02898e9dd1dd76bc0') THEN 500 ELSE 0 END) + (ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(to_tsquery('simple', '(''store'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''storemanager'':AC) | (''shop'':AC <-> ''manager'':AC) | (''shopmanager'':AC) | (''boutique'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''store'':AC <-> ''director'':AC) | (''manager'':AC <-> ''di'':AC <-> ''store'':AC) | (''filialleiter'':AC) | (''filialleiterin'':AC)')),32) + CASE WHEN s.vector @@ to_tsquery('simple', 'cwifd14f2280528ede02898e9dd1dd76bc0') THEN 1.0 ELSE 0 END))::numeric * 1000000)::int 
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version='search-5-20260924-v2' AND s.country IN ('FR','MC')
      WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ('2026-10-02T07:24:30.587Z'::timestamptz AT TIME ZONE 'UTC')) AND d."countryCode" IN ('FR','MC') AND s.vector @@ ((((to_tsquery('simple', '(''store'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''storemanager'':AC) | (''shop'':AC <-> ''manager'':AC) | (''shopmanager'':AC) | (''boutique'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''store'':AC <-> ''director'':AC) | (''manager'':AC <-> ''di'':AC <-> ''store'':AC) | (''filialleiter'':AC) | (''filialleiterin'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwifd14f2280528ede02898e9dd1dd76bc0')))), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, 0 AS pri, b.score
        
      FROM base b WHERE true
    ), 
    cles AS (
      SELECT id, origine, (NOT confirme)::int AS nc, pri AS pri, -score AS ns,
        coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np, (-extract(epoch FROM "firstSeenAt"))::float8 AS nf, confirme
      FROM scoped
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nc, pri, ns, np, nf, id)) ORDER BY origine, nc, pri, ns, np, nf, id)
         FROM (SELECT * FROM cles  ORDER BY origine, nc, pri, ns, np, nf, id LIMIT 26) p) AS page,
      jsonb_build_object(
        'pays', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."countryCode"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."countryCode" IS NOT NULL AND b."countryCode"::text <> '' GROUP BY b."countryCode"
     ORDER BY n DESC, value ) f),
        'metier', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END) code
            WHERE true GROUP BY code) f),
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE true GROUP BY code) f),
        'contrat', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]) value
     WHERE true GROUP BY value) f),
        'temps', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."workTime"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."workTime" IS NOT NULL AND b."workTime"::text <> '' GROUP BY b."workTime"
     ORDER BY n DESC, value ) f),
        'programme', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."programType"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."programType" IS NOT NULL AND b."programType"::text <> '' GROUP BY b."programType"
     ORDER BY n DESC, value ) f),
        'ville', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.ville::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.ville IS NOT NULL AND b.ville::text <> '' GROUP BY b.ville
     ORDER BY n DESC, value LIMIT 60) f),
        'maison', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.maison::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.maison IS NOT NULL AND b.maison::text <> '' GROUP BY b.maison
     ORDER BY n DESC, value ) f),
        'groupe', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.groupe::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.groupe IS NOT NULL AND b.groupe::text <> '' GROUP BY b.groupe
     ORDER BY n DESC, value ) f),
        'langue', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.language::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.language IS NOT NULL AND b.language::text <> '' GROUP BY b.language
     ORDER BY n DESC, value ) f)
      ) AS facettes
  ) r CROSS JOIN LATERAL jsonb_array_elements(r.page) WITH ORDINALITY x(e, n) LEFT JOIN "Job" j ON j.id = x.e->>'id' LEFT JOIN "DirectOffer" d ON 'cw_' || d.id = x.e->>'id' WHERE n <= 25) p;
SELECT 'avant DE Verkaufsberater', count(*) FILTER (WHERE t ~* 'verkauf|sales') || ' / ' || count(*) FROM (SELECT coalesce(j.title, d.title) AS t FROM (
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        round(((CASE WHEN s.vector @@ (to_tsquery('simple', '(''verkaufsberater'':A) | (''sales'':A <-> ''advisor'':A) | (''sales'':A <-> ''assistant'':A) | (''client'':A <-> ''advisor'':A) | (''luxury'':A <-> ''sales'':A <-> ''advisor'':A) | (''conseillere'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vente'':A) | (''conseillere'':A <-> ''vente'':A) | (''fashion'':A <-> ''advisor'':A) | (''sales'':A <-> ''associate'':A) | (''selling'':A <-> ''associate'':A) | (''vendeur'':A) | (''vendeuse'':A) | (''conseillers'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vendeur'':A) | (''conseillere'':A <-> ''vendeuse'':A) | (''associe'':A <-> ''aux'':A <-> ''ventes'':A) | (''associee'':A <-> ''aux'':A <-> ''ventes'':A) | (''addetto'':A <-> ''vendite'':A) | (''addetta'':A <-> ''vendite'':A) | (''addetti'':A <-> ''vendite'':A) | (''addett'':A <-> ''vendite'':A) | (''vendedor'':A) | (''vendedora'':A) | (''verkaufer'':A) | (''verkauferin'':A) | (''verkaufsberaterin'':A) | (''asesora'':A <-> ''de'':A <-> ''ventas'':A) | (''consultora'':A <-> ''de'':A <-> ''vendas'':A) | (''prodejni'':A <-> ''poradkyne'':A) | (''butiksassistent'':A) | (''lucrator'':A <-> ''comercial'':A) | (''lucratoare'':A <-> ''comerciala'':A) | (''addetto'':A <-> ''alle'':A <-> ''vendite'':A) | (''addetta'':A <-> ''alle'':A <-> ''vendite'':A) | (''dependiente'':A) | (''dependienta'':A) | (''winkelmedewerker'':A) | (''assistente'':A <-> ''de'':A <-> ''loja'':A) | (''vendedor'':A <-> ''de'':A <-> ''loja'':A) | (''vendedora'':A <-> ''de'':A <-> ''loja'':A) | (''sprzedawca'':A) | (''sprzedawczyni'':A) | (''butikssaljare'':A) | (''satıs'':A <-> ''elemanı'':A) | (''pembantu'':A <-> ''kedai'':A) | (''butikkmedarbeider'':A) | (''nhan'':A <-> ''vien'':A <-> ''ban'':A <-> ''hang'':A) | (''prodavac'':A) | (''prodavacka'':A) | (''bolti'':A <-> ''elado'':A)')) THEN 1000 WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 500 ELSE 0 END) + (ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(to_tsquery('simple', '(''verkaufsberater'':AC) | (''sales'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')),32) + CASE WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 1.0 ELSE 0 END))::numeric * 1000000)::int AS score 
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "SearchDocument" s ON s.id=j.id AND s.version='search-5-20260924-v2' AND s.country IN ('DE','AT')
      WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = j.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ('2026-10-02T07:24:32.208Z'::timestamptz AT TIME ZONE 'UTC'))) AND j."countryCode" IN ('DE','AT') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''verkaufsberater'':AC) | (''sales'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))
      UNION ALL
      SELECT 'cw_' || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        round(((CASE WHEN s.vector @@ (to_tsquery('simple', '(''verkaufsberater'':A) | (''sales'':A <-> ''advisor'':A) | (''sales'':A <-> ''assistant'':A) | (''client'':A <-> ''advisor'':A) | (''luxury'':A <-> ''sales'':A <-> ''advisor'':A) | (''conseillere'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vente'':A) | (''conseillere'':A <-> ''vente'':A) | (''fashion'':A <-> ''advisor'':A) | (''sales'':A <-> ''associate'':A) | (''selling'':A <-> ''associate'':A) | (''vendeur'':A) | (''vendeuse'':A) | (''conseillers'':A <-> ''de'':A <-> ''vente'':A) | (''conseiller'':A <-> ''vendeur'':A) | (''conseillere'':A <-> ''vendeuse'':A) | (''associe'':A <-> ''aux'':A <-> ''ventes'':A) | (''associee'':A <-> ''aux'':A <-> ''ventes'':A) | (''addetto'':A <-> ''vendite'':A) | (''addetta'':A <-> ''vendite'':A) | (''addetti'':A <-> ''vendite'':A) | (''addett'':A <-> ''vendite'':A) | (''vendedor'':A) | (''vendedora'':A) | (''verkaufer'':A) | (''verkauferin'':A) | (''verkaufsberaterin'':A) | (''asesora'':A <-> ''de'':A <-> ''ventas'':A) | (''consultora'':A <-> ''de'':A <-> ''vendas'':A) | (''prodejni'':A <-> ''poradkyne'':A) | (''butiksassistent'':A) | (''lucrator'':A <-> ''comercial'':A) | (''lucratoare'':A <-> ''comerciala'':A) | (''addetto'':A <-> ''alle'':A <-> ''vendite'':A) | (''addetta'':A <-> ''alle'':A <-> ''vendite'':A) | (''dependiente'':A) | (''dependienta'':A) | (''winkelmedewerker'':A) | (''assistente'':A <-> ''de'':A <-> ''loja'':A) | (''vendedor'':A <-> ''de'':A <-> ''loja'':A) | (''vendedora'':A <-> ''de'':A <-> ''loja'':A) | (''sprzedawca'':A) | (''sprzedawczyni'':A) | (''butikssaljare'':A) | (''satıs'':A <-> ''elemanı'':A) | (''pembantu'':A <-> ''kedai'':A) | (''butikkmedarbeider'':A) | (''nhan'':A <-> ''vien'':A <-> ''ban'':A <-> ''hang'':A) | (''prodavac'':A) | (''prodavacka'':A) | (''bolti'':A <-> ''elado'':A)')) THEN 1000 WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 500 ELSE 0 END) + (ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(to_tsquery('simple', '(''verkaufsberater'':AC) | (''sales'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')),32) + CASE WHEN s.vector @@ to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5') THEN 1.0 ELSE 0 END))::numeric * 1000000)::int 
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version='search-5-20260924-v2' AND s.country IN ('DE','AT')
      WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ('2026-10-02T07:24:32.208Z'::timestamptz AT TIME ZONE 'UTC')) AND d."countryCode" IN ('DE','AT') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''verkaufsberater'':AC) | (''sales'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, 0 AS pri, b.score
        
      FROM base b WHERE true
    ), 
    cles AS (
      SELECT id, origine, (NOT confirme)::int AS nc, pri AS pri, -score AS ns,
        coalesce(-extract(epoch FROM "postedAt"), 1e15)::float8 AS np, (-extract(epoch FROM "firstSeenAt"))::float8 AS nf, confirme
      FROM scoped
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nc, pri, ns, np, nf, id)) ORDER BY origine, nc, pri, ns, np, nf, id)
         FROM (SELECT * FROM cles  ORDER BY origine, nc, pri, ns, np, nf, id LIMIT 26) p) AS page,
      jsonb_build_object(
        'pays', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."countryCode"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."countryCode" IS NOT NULL AND b."countryCode"::text <> '' GROUP BY b."countryCode"
     ORDER BY n DESC, value ) f),
        'metier', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END) code
            WHERE true GROUP BY code) f),
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE true GROUP BY code) f),
        'contrat', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]) value
     WHERE true GROUP BY value) f),
        'temps', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."workTime"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."workTime" IS NOT NULL AND b."workTime"::text <> '' GROUP BY b."workTime"
     ORDER BY n DESC, value ) f),
        'programme', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."programType"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."programType" IS NOT NULL AND b."programType"::text <> '' GROUP BY b."programType"
     ORDER BY n DESC, value ) f),
        'ville', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.ville::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.ville IS NOT NULL AND b.ville::text <> '' GROUP BY b.ville
     ORDER BY n DESC, value LIMIT 60) f),
        'maison', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.maison::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.maison IS NOT NULL AND b.maison::text <> '' GROUP BY b.maison
     ORDER BY n DESC, value ) f),
        'groupe', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.groupe::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.groupe IS NOT NULL AND b.groupe::text <> '' GROUP BY b.groupe
     ORDER BY n DESC, value ) f),
        'langue', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.language::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.language IS NOT NULL AND b.language::text <> '' GROUP BY b.language
     ORDER BY n DESC, value ) f)
      ) AS facettes
  ) r CROSS JOIN LATERAL jsonb_array_elements(r.page) WITH ORDINALITY x(e, n) LEFT JOIN "Job" j ON j.id = x.e->>'id' LEFT JOIN "DirectOffer" d ON 'cw_' || d.id = x.e->>'id' WHERE n <= 25) p;
SELECT 'apres US Sales advisor', count(*) FILTER (WHERE t ~* 'sales|advisor|associate') || ' / ' || count(*) FROM (SELECT coalesce(j.title, d.title) AS t FROM (
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        0 AS score 
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "SearchDocument" s ON s.id=j.id AND s.version='search-5-20260924-v2' AND s.country IN ('US')
      WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = j.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ('2026-10-02T07:24:41.910Z'::timestamptz AT TIME ZONE 'UTC'))) AND j."countryCode" IN ('US') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''asesor'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))
      UNION ALL
      SELECT 'cw_' || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        0 
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version='search-5-20260924-v2' AND s.country IN ('US')
      WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ('2026-10-02T07:24:41.910Z'::timestamptz AT TIME ZONE 'UTC')) AND d."countryCode" IN ('US') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''asesor'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, 0 AS pri, b.score
        
      FROM base b WHERE true
    ), 
    cles AS (SELECT id, origine, (-extract(epoch FROM LEAST("postedAt", "firstSeenAt")))::float8 AS nf, confirme FROM scoped)
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nf, id)) ORDER BY origine, nf, id)
         FROM (SELECT * FROM cles  ORDER BY origine, nf, id LIMIT 26) p) AS page,
      jsonb_build_object(
        'pays', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."countryCode"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."countryCode" IS NOT NULL AND b."countryCode"::text <> '' GROUP BY b."countryCode"
     ORDER BY n DESC, value ) f),
        'metier', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END) code
            WHERE true GROUP BY code) f),
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE true GROUP BY code) f),
        'contrat', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]) value
     WHERE true GROUP BY value) f),
        'temps', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."workTime"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."workTime" IS NOT NULL AND b."workTime"::text <> '' GROUP BY b."workTime"
     ORDER BY n DESC, value ) f),
        'programme', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."programType"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."programType" IS NOT NULL AND b."programType"::text <> '' GROUP BY b."programType"
     ORDER BY n DESC, value ) f),
        'ville', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.ville::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.ville IS NOT NULL AND b.ville::text <> '' GROUP BY b.ville
     ORDER BY n DESC, value LIMIT 60) f),
        'maison', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.maison::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.maison IS NOT NULL AND b.maison::text <> '' GROUP BY b.maison
     ORDER BY n DESC, value ) f),
        'groupe', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.groupe::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.groupe IS NOT NULL AND b.groupe::text <> '' GROUP BY b.groupe
     ORDER BY n DESC, value ) f),
        'langue', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.language::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.language IS NOT NULL AND b.language::text <> '' GROUP BY b.language
     ORDER BY n DESC, value ) f)
      ) AS facettes
  ) r CROSS JOIN LATERAL jsonb_array_elements(r.page) WITH ORDINALITY x(e, n) LEFT JOIN "Job" j ON j.id = x.e->>'id' LEFT JOIN "DirectOffer" d ON 'cw_' || d.id = x.e->>'id' WHERE n <= 25) p;
SELECT 'apres FR Conseiller de vente', count(*) FILTER (WHERE t ~* 'conseill.*vent|vend|sales') || ' / ' || count(*) FROM (SELECT coalesce(j.title, d.title) AS t FROM (
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        0 AS score 
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "SearchDocument" s ON s.id=j.id AND s.version='search-5-20260924-v2' AND s.country IN ('FR','MC')
      WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = j.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ('2026-10-02T07:24:44.168Z'::timestamptz AT TIME ZONE 'UTC'))) AND j."countryCode" IN ('FR','MC') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''conseiller'':AC <-> ''de'':AC <-> ''vente'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))
      UNION ALL
      SELECT 'cw_' || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        0 
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version='search-5-20260924-v2' AND s.country IN ('FR','MC')
      WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ('2026-10-02T07:24:44.168Z'::timestamptz AT TIME ZONE 'UTC')) AND d."countryCode" IN ('FR','MC') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''sales'':AC <-> ''advisor'':AC) | (''conseiller'':AC <-> ''de'':AC <-> ''vente'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, 0 AS pri, b.score
        
      FROM base b WHERE true
    ), 
    cles AS (SELECT id, origine, (-extract(epoch FROM LEAST("postedAt", "firstSeenAt")))::float8 AS nf, confirme FROM scoped)
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nf, id)) ORDER BY origine, nf, id)
         FROM (SELECT * FROM cles  ORDER BY origine, nf, id LIMIT 26) p) AS page,
      jsonb_build_object(
        'pays', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."countryCode"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."countryCode" IS NOT NULL AND b."countryCode"::text <> '' GROUP BY b."countryCode"
     ORDER BY n DESC, value ) f),
        'metier', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END) code
            WHERE true GROUP BY code) f),
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE true GROUP BY code) f),
        'contrat', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]) value
     WHERE true GROUP BY value) f),
        'temps', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."workTime"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."workTime" IS NOT NULL AND b."workTime"::text <> '' GROUP BY b."workTime"
     ORDER BY n DESC, value ) f),
        'programme', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."programType"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."programType" IS NOT NULL AND b."programType"::text <> '' GROUP BY b."programType"
     ORDER BY n DESC, value ) f),
        'ville', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.ville::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.ville IS NOT NULL AND b.ville::text <> '' GROUP BY b.ville
     ORDER BY n DESC, value LIMIT 60) f),
        'maison', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.maison::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.maison IS NOT NULL AND b.maison::text <> '' GROUP BY b.maison
     ORDER BY n DESC, value ) f),
        'groupe', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.groupe::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.groupe IS NOT NULL AND b.groupe::text <> '' GROUP BY b.groupe
     ORDER BY n DESC, value ) f),
        'langue', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.language::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.language IS NOT NULL AND b.language::text <> '' GROUP BY b.language
     ORDER BY n DESC, value ) f)
      ) AS facettes
  ) r CROSS JOIN LATERAL jsonb_array_elements(r.page) WITH ORDINALITY x(e, n) LEFT JOIN "Job" j ON j.id = x.e->>'id' LEFT JOIN "DirectOffer" d ON 'cw_' || d.id = x.e->>'id' WHERE n <= 25) p;
SELECT 'apres FR Responsable de boutique', count(*) FILTER (WHERE t ~* 'responsable.*(boutique|magasin)|store manager|directeur.*(boutique|magasin)') || ' / ' || count(*) FROM (SELECT coalesce(j.title, d.title) AS t FROM (
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        0 AS score 
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "SearchDocument" s ON s.id=j.id AND s.version='search-5-20260924-v2' AND s.country IN ('FR','MC')
      WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = j.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ('2026-10-02T07:24:44.517Z'::timestamptz AT TIME ZONE 'UTC'))) AND j."countryCode" IN ('FR','MC') AND s.vector @@ ((((to_tsquery('simple', '(''store'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''storemanager'':AC) | (''shop'':AC <-> ''manager'':AC) | (''shopmanager'':AC) | (''boutique'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''store'':AC <-> ''director'':AC) | (''manager'':AC <-> ''di'':AC <-> ''store'':AC) | (''filialleiter'':AC) | (''filialleiterin'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwifd14f2280528ede02898e9dd1dd76bc0')))
      UNION ALL
      SELECT 'cw_' || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        0 
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version='search-5-20260924-v2' AND s.country IN ('FR','MC')
      WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ('2026-10-02T07:24:44.517Z'::timestamptz AT TIME ZONE 'UTC')) AND d."countryCode" IN ('FR','MC') AND s.vector @@ ((((to_tsquery('simple', '(''store'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''storemanager'':AC) | (''shop'':AC <-> ''manager'':AC) | (''shopmanager'':AC) | (''boutique'':AC <-> ''manager'':AC) | (''responsable'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''magasin'':AC) | (''directeur'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''directrice'':AC <-> ''de'':AC <-> ''boutique'':AC) | (''store'':AC <-> ''director'':AC) | (''manager'':AC <-> ''di'':AC <-> ''store'':AC) | (''filialleiter'':AC) | (''filialleiterin'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwifd14f2280528ede02898e9dd1dd76bc0')))), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, 0 AS pri, b.score
        
      FROM base b WHERE true
    ), 
    cles AS (SELECT id, origine, (-extract(epoch FROM LEAST("postedAt", "firstSeenAt")))::float8 AS nf, confirme FROM scoped)
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nf, id)) ORDER BY origine, nf, id)
         FROM (SELECT * FROM cles  ORDER BY origine, nf, id LIMIT 26) p) AS page,
      jsonb_build_object(
        'pays', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."countryCode"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."countryCode" IS NOT NULL AND b."countryCode"::text <> '' GROUP BY b."countryCode"
     ORDER BY n DESC, value ) f),
        'metier', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END) code
            WHERE true GROUP BY code) f),
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE true GROUP BY code) f),
        'contrat', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]) value
     WHERE true GROUP BY value) f),
        'temps', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."workTime"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."workTime" IS NOT NULL AND b."workTime"::text <> '' GROUP BY b."workTime"
     ORDER BY n DESC, value ) f),
        'programme', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."programType"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."programType" IS NOT NULL AND b."programType"::text <> '' GROUP BY b."programType"
     ORDER BY n DESC, value ) f),
        'ville', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.ville::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.ville IS NOT NULL AND b.ville::text <> '' GROUP BY b.ville
     ORDER BY n DESC, value LIMIT 60) f),
        'maison', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.maison::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.maison IS NOT NULL AND b.maison::text <> '' GROUP BY b.maison
     ORDER BY n DESC, value ) f),
        'groupe', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.groupe::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.groupe IS NOT NULL AND b.groupe::text <> '' GROUP BY b.groupe
     ORDER BY n DESC, value ) f),
        'langue', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.language::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.language IS NOT NULL AND b.language::text <> '' GROUP BY b.language
     ORDER BY n DESC, value ) f)
      ) AS facettes
  ) r CROSS JOIN LATERAL jsonb_array_elements(r.page) WITH ORDINALITY x(e, n) LEFT JOIN "Job" j ON j.id = x.e->>'id' LEFT JOIN "DirectOffer" d ON 'cw_' || d.id = x.e->>'id' WHERE n <= 25) p;
SELECT 'apres DE Verkaufsberater', count(*) FILTER (WHERE t ~* 'verkauf|sales') || ' / ' || count(*) FROM (SELECT coalesce(j.title, d.title) AS t FROM (
    WITH base AS MATERIALIZED (
      SELECT j.id, 1 AS origine, j."occupationCode", j."titleRoles", j."countryCode", lower(trim(j.city)) AS ville, j."employmentTerm", j."workTime",
        j."programType", j."engagementType", j."postedAt", j."firstSeenAt", j.language, c.id AS "companyId", c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe,
        0 AS score 
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "SearchDocument" s ON s.id=j.id AND s.version='search-5-20260924-v2' AND s.country IN ('DE','AT')
      WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = j.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ('2026-10-02T07:24:46.036Z'::timestamptz AT TIME ZONE 'UTC'))) AND j."countryCode" IN ('DE','AT') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''verkaufsberater'':AC) | (''sales'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))
      UNION ALL
      SELECT 'cw_' || d.id, 0 AS origine, d."occupationCode", d."titleRoles", d."countryCode", lower(trim(d.city)), d."employmentTerm", d."workTime",
        d."programType", d."engagementType", d."postedAt", d."receivedAt", d.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",
        0 
      FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId" JOIN "SearchDocument" s ON s.id='cw_'||d.id AND s.version='search-5-20260924-v2' AND s.country IN ('DE','AT')
      WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > ('2026-10-02T07:24:46.036Z'::timestamptz AT TIME ZONE 'UTC')) AND d."countryCode" IN ('DE','AT') AND coalesce(s.vector, ''::tsvector) @@ (((to_tsquery('simple', '(''verkaufsberater'':AC) | (''sales'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''assistant'':AC) | (''client'':AC <-> ''advisor'':AC) | (''luxury'':AC <-> ''sales'':AC <-> ''advisor'':AC) | (''conseillere'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vente'':AC) | (''conseillere'':AC <-> ''vente'':AC) | (''fashion'':AC <-> ''advisor'':AC) | (''sales'':AC <-> ''associate'':AC) | (''selling'':AC <-> ''associate'':AC) | (''vendeur'':AC) | (''vendeuse'':AC) | (''conseillers'':AC <-> ''de'':AC <-> ''vente'':AC) | (''conseiller'':AC <-> ''vendeur'':AC) | (''conseillere'':AC <-> ''vendeuse'':AC) | (''associe'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''associee'':AC <-> ''aux'':AC <-> ''ventes'':AC) | (''addetto'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''vendite'':AC) | (''addetti'':AC <-> ''vendite'':AC) | (''addett'':AC <-> ''vendite'':AC) | (''vendedor'':AC) | (''vendedora'':AC) | (''verkaufer'':AC) | (''verkauferin'':AC) | (''verkaufsberaterin'':AC) | (''asesora'':AC <-> ''de'':AC <-> ''ventas'':AC) | (''consultora'':AC <-> ''de'':AC <-> ''vendas'':AC) | (''prodejni'':AC <-> ''poradkyne'':AC) | (''butiksassistent'':AC) | (''lucrator'':AC <-> ''comercial'':AC) | (''lucratoare'':AC <-> ''comerciala'':AC) | (''addetto'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''addetta'':AC <-> ''alle'':AC <-> ''vendite'':AC) | (''dependiente'':AC) | (''dependienta'':AC) | (''winkelmedewerker'':AC) | (''assistente'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedor'':AC <-> ''de'':AC <-> ''loja'':AC) | (''vendedora'':AC <-> ''de'':AC <-> ''loja'':AC) | (''sprzedawca'':AC) | (''sprzedawczyni'':AC) | (''butikssaljare'':AC) | (''satıs'':AC <-> ''elemanı'':AC) | (''pembantu'':AC <-> ''kedai'':AC) | (''butikkmedarbeider'':AC) | (''nhan'':AC <-> ''vien'':AC <-> ''ban'':AC <-> ''hang'':AC) | (''prodavac'':AC) | (''prodavacka'':AC) | (''bolti'':AC <-> ''elado'':AC)')) && !!to_tsquery('simple','cwhastitlerole')) || to_tsquery('simple', 'cwif71763319951812f7b29027c793b48d5'))), scoped AS MATERIALIZED (
      SELECT b.id, b.origine, b."countryCode", b."postedAt", b."firstSeenAt", true AS confirme, 0 AS pri, b.score
        
      FROM base b WHERE true
    ), 
    cles AS (SELECT id, origine, (-extract(epoch FROM LEAST("postedAt", "firstSeenAt")))::float8 AS nf, confirme FROM scoped)
    SELECT
      (SELECT count(*)::int FROM scoped) AS total,
      (SELECT count(*)::int FROM scoped WHERE confirme) AS "totalConfirmes",
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'k', jsonb_build_array(origine, nf, id)) ORDER BY origine, nf, id)
         FROM (SELECT * FROM cles  ORDER BY origine, nf, id LIMIT 26) p) AS page,
      jsonb_build_object(
        'pays', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."countryCode"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."countryCode" IS NOT NULL AND b."countryCode"::text <> '' GROUP BY b."countryCode"
     ORDER BY n DESC, value ) f),
        'metier', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN b."occupationCode" IS NULL AND cardinality(b."titleRoles") = 0 THEN ARRAY['unclassified']
  ELSE ARRAY(SELECT DISTINCT r FROM unnest(array_append(b."titleRoles", b."occupationCode")) r WHERE r IS NOT NULL) END) code
            WHERE true GROUP BY code) f),
        'secteur', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', code, 'count', n) ORDER BY n DESC, code), '[]'::jsonb)
          FROM (SELECT code, count(*)::int AS n FROM base b CROSS JOIN LATERAL unnest(CASE WHEN cardinality(b."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE b."sectorCodes" END) code WHERE true GROUP BY code) f),
        'contrat', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, count(DISTINCT b.id)::int AS n FROM base b
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[b."employmentTerm", b."programType",
  CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN b."engagementType" END], NULL)::text[]) value
     WHERE true GROUP BY value) f),
        'temps', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."workTime"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."workTime" IS NOT NULL AND b."workTime"::text <> '' GROUP BY b."workTime"
     ORDER BY n DESC, value ) f),
        'programme', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b."programType"::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b."programType" IS NOT NULL AND b."programType"::text <> '' GROUP BY b."programType"
     ORDER BY n DESC, value ) f),
        'ville', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.ville::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.ville IS NOT NULL AND b.ville::text <> '' GROUP BY b.ville
     ORDER BY n DESC, value LIMIT 60) f),
        'maison', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.maison::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.maison IS NOT NULL AND b.maison::text <> '' GROUP BY b.maison
     ORDER BY n DESC, value ) f),
        'groupe', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.groupe::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.groupe IS NOT NULL AND b.groupe::text <> '' GROUP BY b.groupe
     ORDER BY n DESC, value ) f),
        'langue', 
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT b.language::text AS value, count(*)::int AS n FROM base b WHERE true
     AND b.language IS NOT NULL AND b.language::text <> '' GROUP BY b.language
     ORDER BY n DESC, value ) f)
      ) AS facettes
  ) r CROSS JOIN LATERAL jsonb_array_elements(r.page) WITH ORDINALITY x(e, n) LEFT JOIN "Job" j ON j.id = x.e->>'id' LEFT JOIN "DirectOffer" d ON 'cw_' || d.id = x.e->>'id' WHERE n <= 25) p;

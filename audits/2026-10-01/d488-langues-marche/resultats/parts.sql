\pset footer off
SELECT m.code, j."occupationCode", count(*) AS n
FROM "Job" j JOIN (VALUES ('FR','{FR,MC}'::text[]),('US','{US}'),('GB','{GB,IE}'),('DE','{DE,AT}'),('IT','{IT}'),('ES','{ES}'),('CH','{CH}'),('BE','{BE}'),
  ('NL','{NL}'),('JP','{JP}'),('CN','{CN}')) AS m(code, pays) ON j."countryCode" = ANY(m.pays)
WHERE j."isActive" AND j."occupationCode" IN ('sales-advisor','beauty-consultant','hairdresser','store-manager','assistant-store-manager','stock-associate','cashier','visual-merchandiser','watchmaker','pharmacist','recruiter','financial-controller')
GROUP BY 1, 2 ORDER BY 1, 3 DESC;

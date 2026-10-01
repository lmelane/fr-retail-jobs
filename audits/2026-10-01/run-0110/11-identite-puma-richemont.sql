-- Identité d'employeur : historique des deux offres refusées le 01/10/2026 et attribution des mêmes libellés sur leur source (lecture seule).
\pset pager off
SELECT o."sourceKey", o."externalId", to_char(o."observedAt",'MM-DD HH24:MI') vu, o."labelOrigin", o."rawEmployerName", o."normalizedEmployerName", o.rule, c.name canonique
FROM "EmployerObservation" o LEFT JOIN "Company" c ON c.id=o."canonicalEmployerId"
WHERE (o."sourceKey",o."externalId") IN (('puma','Entertainment-Marketing-Manager_R43416'),('richemont','Security-Specialist_JR132200'))
ORDER BY 1,2,o."observedAt";
SELECT o."sourceKey", o."rawEmployerName", c.name canonique, o.rule, count(DISTINCT o."externalId") offres, to_char(max(o."observedAt"),'MM-DD HH24:MI') dernier
FROM "EmployerObservation" o LEFT JOIN "Company" c ON c.id=o."canonicalEmployerId"
WHERE o."sourceKey" IN ('puma','richemont') AND o."observedAt" > now() - interval '2 days'
GROUP BY 1,2,3,4 ORDER BY 1,5 DESC;

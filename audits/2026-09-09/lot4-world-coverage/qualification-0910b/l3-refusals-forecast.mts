import {PrismaClient} from '@prisma/client';const p=new PrismaClient({log:[]});
try{
 // How the cleaned labels already resolve on the same sources (any date): rule + canonical employer.
 const r:any=await p.$queryRaw`SELECT o."sourceKey", o."rawEmployerName", o.rule, c.name AS canonical, COUNT(*)::int n, MAX(o."observedAt")::text AS last
  FROM "EmployerObservation" o LEFT JOIN "Company" c ON c.id=o."canonicalEmployerId"
  WHERE o."sourceKey" IN ('deckers','richemont','richemont-workday','a-derma-4') AND o."rawEmployerName" IN ('HOKA','UGG','Deckers','Richemont','Jaeger LeCoultre','Chloe','Cartier','Alaia','Pierre Fabre','Chloé','Alaïa','Jaeger-LeCoultre')
  GROUP BY 1,2,3,4 ORDER BY 1,2,5 DESC`;
 console.log('CLEANED', JSON.stringify(r));
 const l3:any=await p.$queryRaw`SELECT o."sourceKey", o."rawEmployerName", o.rule, c.name AS canonical, COUNT(*)::int n
  FROM "EmployerObservation" o LEFT JOIN "Company" c ON c.id=o."canonicalEmployerId"
  WHERE o."sourceKey" IN ('richemont-workday','deckers') AND o."observedAt" >= '2026-09-10T08:18:00Z' GROUP BY 1,2,3,4 ORDER BY 1,5 DESC LIMIT 30`;
 console.log('L3', JSON.stringify(l3));
 const tap:any=await p.$queryRaw`SELECT o."rawEmployerName", o.rule, c.name AS canonical, COUNT(*)::int n
  FROM "EmployerObservation" o LEFT JOIN "Company" c ON c.id=o."canonicalEmployerId"
  WHERE o."sourceKey"='tapestry' AND o."observedAt" >= '2026-09-10T08:18:00Z' GROUP BY 1,2,3 ORDER BY 4 DESC`;
 console.log('TAPESTRY', JSON.stringify(tap));
 const titles:any=await p.$queryRaw`SELECT j.title, j.city, j."countryCode" FROM "EmployerObservation" o JOIN "Job" j ON j."externalId"=o."externalId" AND j."companyId"=o."canonicalEmployerId"
  WHERE o."sourceKey"='tapestry' AND o."rawEmployerName"='Tapestry, Inc.' AND o."observedAt" >= '2026-09-10T08:18:00Z' ORDER BY random() LIMIT 25`;
 console.log('TITLES', JSON.stringify(titles));
 const kw:any=await p.$queryRaw`SELECT CASE WHEN j.title ILIKE '%coach%' THEN 'coach' WHEN j.title ILIKE '%kate spade%' THEN 'kate spade' WHEN j.title ILIKE '%stuart%' THEN 'stuart weitzman' ELSE 'none' END AS brand_in_title, COUNT(DISTINCT j.id)::int n
  FROM "EmployerObservation" o JOIN "Job" j ON j."externalId"=o."externalId" AND j."companyId"=o."canonicalEmployerId"
  WHERE o."sourceKey"='tapestry' AND o."rawEmployerName"='Tapestry, Inc.' AND o."observedAt" >= '2026-09-10T08:18:00Z' GROUP BY 1 ORDER BY 2 DESC`;
 console.log('BRAND_IN_TITLE', JSON.stringify(kw));
}finally{await p.$disconnect()}

-- État AVANT, en production (lecture seule) : les collectes du RUN du 02/10 (release r5) des huit sources du groupe.
-- python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-03/stock-exceptions/_familles/sourceruns-0210.sql'
select "sourceKey", status, jobs, fetched, "declaredTotal", complete, "canAttestAbsence", left(note, 160) note
from "SourceRun" where "runId" = '9022fc4b-1b96-431d-bee9-86ed244ef4f1'
  and "sourceKey" in ('knitwell-us-retail','tapestry','lvmh','wttj-sector','hm-group','marella','b-s-international','funky-buddha')
order by "sourceKey";

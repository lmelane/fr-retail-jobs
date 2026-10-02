-- D-508 §6 — le dénominateur de la garde de masse du RUN (LECTURE SEULE, db.py readonly).
-- Le RUN appelle runRefresh avec onlyKeys = toutes les sources ACTIVE (cli.ts, ingest-all) ; la garde refuse si
-- fermetures >= minCloseForGuard (50) ET fermetures / offres vivantes du périmètre > maxCloseRatio (5 %).
-- swatch-group est compté comme il le sera après sa réouverture (ACTIVE).
select (select count(*) from "Source" where status = 'ACTIVE') as "sourcesActives",
       count(*) as "offresVivantesPerimetreRun"
from "Job" j
where j."isActive" and j."mergedIntoId" is null
  and exists (select 1 from "JobSource" js join "Source" s on s.key = js."sourceKey"
              where js."jobId" = j.id and (s.status = 'ACTIVE' or s.key = 'swatch-group'));

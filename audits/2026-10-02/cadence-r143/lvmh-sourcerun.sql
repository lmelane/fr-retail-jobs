-- R-143 §1 — pourquoi LVMH est DEGRADED (production, lecture seule, 02/10 11:30 UTC) : sortie dans lvmh-sourcerun.out.
SELECT to_char("ranAt",'MM-DD HH24:MI') r, status, jobs, fetched, accepted, errors, truncated, complete, left(note,200) FROM "SourceRun" WHERE "sourceKey"='lvmh' ORDER BY "ranAt" DESC LIMIT 4;

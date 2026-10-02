-- D-516 §1 : en-têtes complets des réponses autour du refus, et enveloppe de requête (en-têtes envoyés, sans valeur de
-- cookie). LECTURE SEULE. Même invocation que collectes.sql.
\pset footer off
select left(r."batchId", 8) lot, r.sequence, r.status, r.headers::text entetes_reponse
  from "RawCapture" r
 where (r."batchId" = 'c81e14a5-2156-4828-bd0d-0cc51144baae' and r.sequence in (0, 5, 6, 7, 8))
    or (r."batchId" = 'da424ede-87b3-4130-9b09-3b77ec75bfd6' and r.sequence in (5, 6, 7))
 order by 1, 2;

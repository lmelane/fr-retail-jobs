-- Separate from DDL: backfill must not hold an ACCESS EXCLUSIVE table lock.
UPDATE "Job" j SET "searchText"=catwalks_job_search_text(j.title,j.description,j.city,j.location,j.department,
  j."employmentTerm",c.name,c."parentGroup") FROM "Company" c WHERE c.id=j."companyId";
